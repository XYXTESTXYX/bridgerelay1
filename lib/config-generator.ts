import {
  BridgeFeedSource,
  FilterRulesConfig,
  FormattingConfig,
} from './pipeline-engine';

export type HostingTarget = 'docker_vps' | 'raspberry_pi_systemd' | 'cloudflare_cron' | 'local_cli';
export type RuntimeLanguage = 'python' | 'typescript' | 'go';
export type StateBackend = 'sqlite' | 'json_file' | 'redis';

export interface ArchitectureStackChoices {
  hosting: HostingTarget;
  language: RuntimeLanguage;
  stateBackend: StateBackend;
  threadsTokenMode: 'long_lived_60d_refresh' | 'manual_env_token';
}

export function generateYamlConfig(
  feeds: BridgeFeedSource[],
  filters: FilterRulesConfig,
  formatting: FormattingConfig,
  stack: ArchitectureStackChoices
): string {
  const feedBlocks = feeds
    .map(
      (f) => `  - id: "${f.id}"
    name: "${f.name}"
    bridge_url: "${f.bridgeUrl}"
    format: "${f.format}"
    poll_interval_minutes: ${f.pollIntervalMinutes}
    initial_run_policy: "${f.initialRunPolicy}"
    enabled: ${f.enabled}`
    )
    .join('\n\n');

  const whitelistYaml =
    filters.keywordWhitelist.length > 0
      ? filters.keywordWhitelist.map((k) => `    - "${k}"`).join('\n')
      : '    []';

  const blacklistYaml =
    filters.keywordBlacklist.length > 0
      ? filters.keywordBlacklist.map((k) => `    - "${k}"`).join('\n')
      : '    []';

  const tagsYaml =
    formatting.defaultHashtags.length > 0
      ? formatting.defaultHashtags.map((t) => `    - "${t}"`).join('\n')
      : '    []';

  return `# BridgeRelay Pipeline Configuration
# Generated for: ${stack.hosting} (${stack.language} runtime)

state_management:
  backend: "${stack.stateBackend}"
  sqlite_path: "./data/bridgerelay_state.db"
  deduplication_key: "guid_or_sha256"

feeds:
${feedBlocks}

filtering:
  strip_html_preserve_breaks: ${filters.stripHtmlPreserveBreaks}
  extract_inline_images: ${filters.extractInlineImages}
  require_media_attachment: ${filters.requireMediaAttachment}
  min_content_length: ${filters.minContentLength}
  max_content_length: ${filters.maxContentLength}
  regex_pattern: "${filters.regexPattern.replace(/"/g, '\\"')}"
  regex_invert: ${filters.regexInvert}
  keyword_whitelist:
${whitelistYaml}
  keyword_blacklist:
${blacklistYaml}

formatting:
  template: |
${formatting.template
  .split('\n')
  .map((line) => `    ${line}`)
  .join('\n')}
  truncation_strategy: "${formatting.truncationStrategy}"
  include_media_attachment: ${formatting.includeMediaAttachment}
  default_hashtags:
${tagsYaml}

destinations:
  mastodon:
    enabled: true
    instance_url_env: "MASTODON_INSTANCE_URL"
    access_token_env: "MASTODON_ACCESS_TOKEN"
    max_chars: ${formatting.mastodonMaxChars}
    count_url_as_23_chars: ${formatting.mastodonCountUrlAs23Chars}
    visibility: "${formatting.mastodonVisibility}"

  threads:
    enabled: true
    api_base: "https://graph.threads.net/v1.0"
    user_id_env: "THREADS_USER_ID"
    access_token_env: "THREADS_ACCESS_TOKEN"
    token_refresh_policy: "${stack.threadsTokenMode}"
    max_chars: ${formatting.threadsMaxChars}
    container_poll_interval_seconds: 3
`;
}

export function generateJsonConfig(
  feeds: BridgeFeedSource[],
  filters: FilterRulesConfig,
  formatting: FormattingConfig,
  stack: ArchitectureStackChoices
): string {
  return JSON.stringify(
    {
      architecture: stack,
      stateManagement: {
        backend: stack.stateBackend,
        sqlitePath: './data/bridgerelay_state.db',
        deduplicationKey: 'guid_or_sha256',
      },
      feeds,
      filtering: filters,
      formatting,
      destinations: {
        mastodon: {
          enabled: true,
          instanceUrlEnv: 'MASTODON_INSTANCE_URL',
          accessTokenEnv: 'MASTODON_ACCESS_TOKEN',
          maxChars: formatting.mastodonMaxChars,
          countUrlAs23Chars: formatting.mastodonCountUrlAs23Chars,
          visibility: formatting.mastodonVisibility,
        },
        threads: {
          enabled: true,
          apiBase: 'https://graph.threads.net/v1.0',
          userIdEnv: 'THREADS_USER_ID',
          accessTokenEnv: 'THREADS_ACCESS_TOKEN',
          tokenRefreshPolicy: stack.threadsTokenMode,
          maxChars: formatting.threadsMaxChars,
        },
      },
    },
    null,
    2
  );
}

export function generateWorkerCode(
  feeds: BridgeFeedSource[],
  filters: FilterRulesConfig,
  formatting: FormattingConfig,
  stack: ArchitectureStackChoices
): string {
  if (stack.language === 'python') {
    return `#!/usr/bin/env python3
"""
BridgeRelay Autonomous Worker (Python 3.11+ / SQLite WAL / Mastodon & Meta Threads)
Dependencies: pip install feedparser requests beautifulsoup4 pyyaml
"""
import os
import re
import time
import hashlib
import sqlite3
import requests
import feedparser
from bs4 import BeautifulSoup

DB_PATH = os.getenv("STATE_DB_PATH", "./bridgerelay_state.db")
MASTODON_URL = os.getenv("MASTODON_INSTANCE_URL", "https://mastodon.social").rstrip("/")
MASTODON_TOKEN = os.getenv("MASTODON_ACCESS_TOKEN", "")
THREADS_USER_ID = os.getenv("THREADS_USER_ID", "")
THREADS_TOKEN = os.getenv("THREADS_ACCESS_TOKEN", "")

BLACKLIST = ${JSON.stringify(filters.keywordBlacklist)}
WHITELIST = ${JSON.stringify(filters.keywordWhitelist)}
REGEX_PATTERN = ${JSON.stringify(filters.regexPattern)}
TEMPLATE = ${JSON.stringify(formatting.template)}

def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS seen_entries (
            guid_hash TEXT PRIMARY KEY,
            feed_id TEXT NOT NULL,
            status TEXT NOT NULL,
            processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    return conn

def clean_html(raw_html: str) -> str:
    soup = BeautifulSoup(raw_html or "", "html.parser")
    for br in soup.find_all(["br", "p"]):
        br.append("\\n")
    return re.sub(r"\\n{3,}", "\\n\\n", soup.get_text()).strip()

def publish_to_mastodon(status_text: str) -> dict:
    if not MASTODON_TOKEN:
        return {"dry_run": True, "platform": "mastodon"}
    resp = requests.post(
        f"{MASTODON_URL}/api/v1/statuses",
        headers={"Authorization": f"Bearer {MASTODON_TOKEN}"},
        json={"status": status_text, "visibility": "${formatting.mastodonVisibility}"},
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()

def publish_to_threads(status_text: str) -> dict:
    if not THREADS_TOKEN or not THREADS_USER_ID:
        return {"dry_run": True, "platform": "threads"}
    # Step 1: Create media container
    create_resp = requests.post(
        f"https://graph.threads.net/v1.0/{THREADS_USER_ID}/threads",
        data={
            "media_type": "TEXT",
            "text": status_text,
            "access_token": THREADS_TOKEN,
        },
        timeout=20,
    )
    create_resp.raise_for_status()
    creation_id = create_resp.json()["id"]

    # Step 2: Wait for container readiness & publish
    time.sleep(2.5)
    pub_resp = requests.post(
        f"https://graph.threads.net/v1.0/{THREADS_USER_ID}/threads_publish",
        data={"creation_id": creation_id, "access_token": THREADS_TOKEN},
        timeout=20,
    )
    pub_resp.raise_for_status()
    return pub_resp.json()

if __name__ == "__main__":
    conn = init_db()
    print("BridgeRelay worker initialized with SQLite WAL state tracking.")
`;
  }

  if (stack.language === 'go') {
    return `// BridgeRelay Worker (Go 1.22+)
// Build: go build -o bridgerelay main.go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

type MastodonPayload struct {
	Status     string \`json:"status"\`
	Visibility string \`json:"visibility"\`
}

func publishMastodon(instanceURL, token, text string) error {
	body, _ := json.Marshal(MastodonPayload{
		Status:     text,
		Visibility: "${formatting.mastodonVisibility}",
	})
	req, err := http.NewRequest("POST", instanceURL+"/api/v1/statuses", bytes.NewBuffer(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("mastodon HTTP %d", resp.StatusCode)
	}
	return nil
}

func main() {
	fmt.Println("BridgeRelay Go worker started — polling ${feeds.length} RSS-Bridge feeds.")
	_ = os.Getenv("THREADS_ACCESS_TOKEN")
}
`;
  }

  return `// BridgeRelay Autonomous Worker (Node.js 20+ / TypeScript)
// Run via cron or PM2: npx tsx relay-worker.ts

const MASTODON_INSTANCE = process.env.MASTODON_INSTANCE_URL || 'https://mastodon.social';
const MASTODON_TOKEN = process.env.MASTODON_ACCESS_TOKEN || '';
const THREADS_USER_ID = process.env.THREADS_USER_ID || '';
const THREADS_TOKEN = process.env.THREADS_ACCESS_TOKEN || '';

export async function publishMastodonStatus(text: string): Promise<{ id: string }> {
  const res = await fetch(\`\${MASTODON_INSTANCE.replace(/\\/$/, '')}/api/v1/statuses\`, {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${MASTODON_TOKEN}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      status: text,
      visibility: '${formatting.mastodonVisibility}',
    }),
  });
  if (!res.ok) throw new Error(\`Mastodon error: \${res.status}\`);
  return res.json();
}

export async function publishThreadsTwoStep(text: string): Promise<{ id: string }> {
  // Step 1: Create container
  const containerParams = new URLSearchParams({
    media_type: 'TEXT',
    text,
    access_token: THREADS_TOKEN,
  });
  const step1 = await fetch(
    \`https://graph.threads.net/v1.0/\${THREADS_USER_ID}/threads?\${containerParams.toString()}\`,
    { method: 'POST' }
  );
  if (!step1.ok) throw new Error(\`Threads container error: \${step1.status}\`);
  const { id: creationId } = await step1.json();

  // Step 2: Publish container
  await new Promise((r) => setTimeout(r, 2000));
  const publishParams = new URLSearchParams({
    creation_id: creationId,
    access_token: THREADS_TOKEN,
  });
  const step2 = await fetch(
    \`https://graph.threads.net/v1.0/\${THREADS_USER_ID}/threads_publish?\${publishParams.toString()}\`,
    { method: 'POST' }
  );
  if (!step2.ok) throw new Error(\`Threads publish error: \${step2.status}\`);
  return step2.json();
}
`;
}
