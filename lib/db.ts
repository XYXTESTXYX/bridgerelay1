import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface PersistentSeenRecord {
  guidHash: string;
  guid: string;
  feedId: string;
  title: string;
  status: 'published' | 'seeded' | 'filtered_out';
  publishedAt: string;
  mastodonStatusId?: string;
  threadsPostId?: string;
}

// In serverless/Vercel environments, root fs is read-only. We safely use os.tmpdir().
const DATA_DIR =
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join(os.tmpdir(), 'bridgerelay')
    : path.join(process.cwd(), 'data');

const DB_FILE = path.join(DATA_DIR, 'seen_ledger.json');

function ensureStore(): Record<string, PersistentSeenRecord> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify({}), 'utf-8');
      return {};
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function isItemSeen(guidHash: string): boolean {
  const store = ensureStore();
  return Boolean(store[guidHash]);
}

export function markItemSeen(record: PersistentSeenRecord): void {
  try {
    const store = ensureStore();
    store[record.guidHash] = record;
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write to seen_ledger:', err);
  }
}

export function getSeenRecords(): PersistentSeenRecord[] {
  const store = ensureStore();
  return Object.values(store).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}