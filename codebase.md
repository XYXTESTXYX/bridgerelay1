# .ai_backups\20261027_013634_package.json

```json
{
  "name": "bridgerelay",
  "version": "0.2.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint ."
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "fast-xml-parser": "^4.5.3",
    "lucide-react": "^0.553.0",
    "next": "^15.4.9",
    "react": "^19.2.1",
    "react-dom": "^19.2.1",
    "tailwind-merge": "^3.3.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.11",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9.20.0",
    "eslint-config-next": "^15.4.9",
    "postcss": "^8.5.6",
    "tailwindcss": "^4.1.11",
    "typescript": "^5.9.3"
  }
}
```

# .ai_backups\20261027_013641_package.json

```json
{
  "name": "bridgerelay",
  "version": "0.2.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint ."
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "fast-xml-parser": "^4.5.3",
    "lucide-react": "^0.553.0",
    "next": "^15.4.9",
    "react": "^19.2.1",
    "react-dom": "^19.2.1",
    "tailwind-merge": "^3.3.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.11",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "autoprefixer": "^10.4.21",
    "eslint": "^9.20.0",
    "eslint-config-next": "^15.4.9",
    "postcss": "^8.5.6",
    "tailwindcss": "^4.1.11",
    "typescript": "^5.9.3"
  }
}
```

# .ai_backups\20261027_013642_package.json

```json
{
  "name": "bridgerelay",
  "version": "0.2.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint ."
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "fast-xml-parser": "^4.5.3",
    "lucide-react": "^0.553.0",
    "next": "^15.4.9",
    "react": "^19.2.1",
    "react-dom": "^19.2.1",
    "tailwind-merge": "^3.3.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.11",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "autoprefixer": "^10.4.21",
    "eslint": "^9.20.0",
    "eslint-config-next": "^15.4.9",
    "postcss": "^8.5.6",
    "tailwindcss": "^4.1.11",
    "typescript": "^5.9.3"
  }
}
```

# .ai_backups\20261027_014211_app_api_pipeline_poll_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isItemSeen } from '@/lib/db';
import {
  evaluateFilterRules,
  renderFormattedPreview,
  INITIAL_BRIDGE_FEEDS,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${host}`;

  const results = [];

  for (const feed of INITIAL_BRIDGE_FEEDS.filter((f) => f.enabled)) {
    try {
      const pollRes = await fetch(`${baseUrl}/api/pipeline/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedId: feed.id,
          feedName: feed.name,
          bridgeUrl: feed.bridgeUrl.replace(
            '{RSS_BRIDGE_BASE_URL}',
            process.env.RSS_BRIDGE_BASE_URL || 'https://rss-bridge.org/bridge01'
          ),
        }),
      });

      if (!pollRes.ok) continue;
      const { items } = await pollRes.json();

      for (const item of items) {
        if (isItemSeen(item.hashId)) continue;

        const filterCheck = evaluateFilterRules(item, {
          keywordWhitelist: [],
          keywordBlacklist: ['sponsored', 'ad'],
          regexPattern: '',
          regexInvert: false,
          authorWhitelist: [],
          minContentLength: 10,
          maxContentLength: 4000,
          requireMediaAttachment: false,
          stripHtmlPreserveBreaks: true,
          extractInlineImages: true,
        });

        if (!filterCheck.passed) continue;

        const mastoPreview = renderFormattedPreview(
          item,
          {
            template: '{title}\n\n{summary}\n\n{link}\n{tags}',
            mastodonMaxChars: 500,
            threadsMaxChars: 500,
            mastodonCountUrlAs23Chars: true,
            truncationStrategy: 'ellipsis',
            includeMediaAttachment: true,
            defaultHashtags: ['RSSBridge'],
            mastodonVisibility: 'public',
          },
          'mastodon'
        );

        const threadsPreview = renderFormattedPreview(
          item,
          {
            template: '{title}\n\n{summary}\n\n{link}\n{tags}',
            mastodonMaxChars: 500,
            threadsMaxChars: 500,
            mastodonCountUrlAs23Chars: true,
            truncationStrategy: 'ellipsis',
            includeMediaAttachment: true,
            defaultHashtags: ['RSSBridge'],
            mastodonVisibility: 'public',
          },
          'threads'
        );

        const pubRes = await fetch(`${baseUrl}/api/pipeline/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemGuid: item.guid,
            itemTitle: item.title,
            feedId: feed.id,
            platforms: ['mastodon', 'threads'],
            actionType: item.enclosures.length > 0 ? 'image' : 'text',
            mastodonPosts: mastoPreview.posts,
            threadsPosts: threadsPreview.posts,
            mediaUrls: item.enclosures.map((e) => e.url),
          }),
        });

        results.push({ item: item.title, published: pubRes.ok });
        break;
      }
    } catch (e) {
      console.error(`Cron error on feed ${feed.id}:`, e);
    }
  }

  return NextResponse.json({
    status: 'cron_completed',
    processedAt: new Date().toISOString(),
    results,
  });
}
```

# .ai_backups\20261027_014211_app_api_pipeline_publish_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { markItemSeen } from '@/lib/db';
import { computeDeterministicHash } from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

export interface PublishStepTrace {
  step: number;
  platform: 'mastodon' | 'threads';
  actionType?: string;
  endpoint: string;
  method: 'POST' | 'GET';
  status: 'success' | 'error';
  httpStatus: number;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  durationMs: number;
}

async function uploadMediaToMastodon(
  mediaUrl: string,
  mastodonInstance: string,
  token: string
): Promise<string> {
  const mediaRes = await fetch(mediaUrl);
  if (!mediaRes.ok) throw new Error(`Failed to download media enclosure: ${mediaUrl}`);
  const blob = await mediaRes.blob();

  const formData = new FormData();
  formData.append('file', blob, 'media.jpg');
  formData.append('description', 'Syndicated via BridgeRelay');

  const uploadRes = await fetch(`${mastodonInstance}/api/v2/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Mastodon media upload failed (HTTP ${uploadRes.status}): ${errText}`);
  }

  const uploadData = await uploadRes.json();
  return uploadData.id;
}

async function pollThreadsContainerReady(
  containerId: string,
  threadsToken: string,
  maxAttempts = 6
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusRes = await fetch(
      `https://graph.threads.net/v1.0/${containerId}?fields=status,error_message&access_token=${threadsToken}`
    );
    if (statusRes.ok) {
      const data = await statusRes.json();
      if (data.status === 'FINISHED') return;
      if (data.status === 'ERROR') {
        throw new Error(`Threads container error: ${data.error_message || 'Container failed'}`);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      itemGuid,
      itemTitle = 'Feed Item',
      feedId = 'feed-default',
      platforms,
      actionType = 'text',
      mastodonPosts,
      threadsPosts,
      linkUrl = '',
      mediaUrls = [],
      visibility = 'public',
      credentials,
    } = body as {
      itemGuid?: string;
      itemTitle?: string;
      feedId?: string;
      platforms: ('mastodon' | 'threads')[];
      actionType?: 'text' | 'link' | 'image' | 'video' | 'carousel';
      mastodonPosts: string[];
      threadsPosts: string[];
      linkUrl?: string;
      mediaUrls?: string[];
      visibility?: 'public' | 'unlisted' | 'private';
      credentials?: {
        mastodonInstanceUrl?: string;
        mastodonAccessToken?: string;
        threadsUserId?: string;
        threadsAccessToken?: string;
      };
    };

    const traces: PublishStepTrace[] = [];
    let stepCounter = 1;

    const mastodonInstance = (
      credentials?.mastodonInstanceUrl ||
      process.env.MASTODON_INSTANCE_URL ||
      'https://mastodon.social'
    ).replace(/\/$/, '');
    const mastodonToken = (
      credentials?.mastodonAccessToken ||
      process.env.MASTODON_ACCESS_TOKEN ||
      ''
    ).trim();

    const threadsUserId = (
      credentials?.threadsUserId ||
      process.env.THREADS_USER_ID ||
      ''
    ).trim();
    const threadsToken = (
      credentials?.threadsAccessToken ||
      process.env.THREADS_ACCESS_TOKEN ||
      ''
    ).trim();

    let publishedMastodonId: string | undefined;
    let publishedThreadsId: string | undefined;

    // 1. Mastodon
    if (platforms.includes('mastodon') && mastodonPosts?.length > 0) {
      if (!mastodonToken) throw new Error('Mastodon access token is missing');

      const uploadedMediaIds: string[] = [];
      if (
        (actionType === 'image' || actionType === 'video' || actionType === 'carousel') &&
        mediaUrls.length > 0
      ) {
        const mediaToUpload = actionType === 'carousel' ? mediaUrls.slice(0, 4) : [mediaUrls[0]];
        for (const url of mediaToUpload) {
          const t0 = Date.now();
          const mediaId = await uploadMediaToMastodon(url, mastodonInstance, mastodonToken);
          uploadedMediaIds.push(mediaId);
          traces.push({
            step: stepCounter++,
            platform: 'mastodon',
            actionType,
            endpoint: `${mastodonInstance}/api/v2/media`,
            method: 'POST',
            status: 'success',
            httpStatus: 200,
            requestPayload: { file_url: url },
            responsePayload: { id: mediaId },
            durationMs: Date.now() - t0,
          });
        }
      }

      let inReplyToId: string | undefined;
      for (let i = 0; i < mastodonPosts.length; i++) {
        const postText = mastodonPosts[i];
        const statusEndpoint = `${mastodonInstance}/api/v1/statuses`;
        const reqPayload: Record<string, unknown> = {
          status: postText,
          visibility,
          ...(i === 0 && uploadedMediaIds.length > 0 ? { media_ids: uploadedMediaIds } : {}),
          ...(inReplyToId ? { in_reply_to_id: inReplyToId } : {}),
        };

        const t0 = Date.now();
        const res = await fetch(statusEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${mastodonToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(reqPayload),
        });
        const resData = await res.json();

        if (!res.ok) {
          throw new Error(`Mastodon status error (HTTP ${res.status}): ${JSON.stringify(resData)}`);
        }

        inReplyToId = String(resData.id);
        if (i === 0) publishedMastodonId = inReplyToId;

        traces.push({
          step: stepCounter++,
          platform: 'mastodon',
          actionType,
          endpoint: statusEndpoint,
          method: 'POST',
          status: 'success',
          httpStatus: res.status,
          requestPayload: reqPayload,
          responsePayload: resData,
          durationMs: Date.now() - t0,
        });
      }
    }

    // 2. Meta Threads
    if (platforms.includes('threads') && threadsPosts?.length > 0) {
      if (!threadsUserId || !threadsToken) {
        throw new Error('Meta Threads User ID or Access Token is missing');
      }

      const containerEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads`;
      const publishEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`;
      const postText = threadsPosts[0];

      let containerIdToPublish = '';

      if (actionType === 'carousel' && mediaUrls.length >= 2) {
        const childContainerIds: string[] = [];
        for (const mUrl of mediaUrls.slice(0, 5)) {
          const t0 = Date.now();
          const isVideo = mUrl.endsWith('.mp4');
          const childParams = new URLSearchParams({
            is_carousel_item: 'true',
            media_type: isVideo ? 'VIDEO' : 'IMAGE',
            [isVideo ? 'video_url' : 'image_url']: mUrl,
            access_token: threadsToken,
          });

          const childRes = await fetch(`${containerEndpoint}?${childParams.toString()}`, { method: 'POST' });
          const childData = await childRes.json();
          if (!childRes.ok) throw new Error(`Threads carousel child failed: ${JSON.stringify(childData)}`);
          childContainerIds.push(childData.id);

          traces.push({
            step: stepCounter++,
            platform: 'threads',
            actionType: 'carousel_item',
            endpoint: containerEndpoint,
            method: 'POST',
            status: 'success',
            httpStatus: childRes.status,
            requestPayload: { media_url: mUrl },
            responsePayload: childData,
            durationMs: Date.now() - t0,
          });
        }

        const parentParams = new URLSearchParams({
          media_type: 'CAROUSEL',
          children: childContainerIds.join(','),
          text: postText,
          access_token: threadsToken,
        });
        const parentRes = await fetch(`${containerEndpoint}?${parentParams.toString()}`, { method: 'POST' });
        const parentData = await parentRes.json();
        if (!parentRes.ok) throw new Error(`Threads parent carousel failed: ${JSON.stringify(parentData)}`);
        containerIdToPublish = parentData.id;
      } else {
        const isImage = actionType === 'image' && mediaUrls.length > 0;
        const isVideo = actionType === 'video' && mediaUrls.length > 0;
        const mediaType = isImage ? 'IMAGE' : isVideo ? 'VIDEO' : 'TEXT';

        const params = new URLSearchParams({
          media_type: mediaType,
          text: postText,
          access_token: threadsToken,
          ...(actionType === 'link' && linkUrl ? { link_attachment: linkUrl } : {}),
          ...(isImage ? { image_url: mediaUrls[0] } : {}),
          ...(isVideo ? { video_url: mediaUrls[0] } : {}),
        });

        const t0 = Date.now();
        const createRes = await fetch(`${containerEndpoint}?${params.toString()}`, { method: 'POST' });
        const createData = await createRes.json();
        if (!createRes.ok) throw new Error(`Threads container creation failed: ${JSON.stringify(createData)}`);
        containerIdToPublish = createData.id;

        traces.push({
          step: stepCounter++,
          platform: 'threads',
          actionType,
          endpoint: containerEndpoint,
          method: 'POST',
          status: 'success',
          httpStatus: createRes.status,
          requestPayload: { mediaType, textLength: postText.length },
          responsePayload: createData,
          durationMs: Date.now() - t0,
        });
      }

      await pollThreadsContainerReady(containerIdToPublish, threadsToken);

      const tPublish = Date.now();
      const pubParams = new URLSearchParams({
        creation_id: containerIdToPublish,
        access_token: threadsToken,
      });
      const pubRes = await fetch(`${publishEndpoint}?${pubParams.toString()}`, { method: 'POST' });
      const pubData = await pubRes.json();
      if (!pubRes.ok) throw new Error(`Threads publish failed: ${JSON.stringify(pubData)}`);
      publishedThreadsId = pubData.id;

      traces.push({
        step: stepCounter++,
        platform: 'threads',
        actionType,
        endpoint: publishEndpoint,
        method: 'POST',
        status: 'success',
        httpStatus: pubRes.status,
        requestPayload: { creation_id: containerIdToPublish },
        responsePayload: pubData,
        durationMs: Date.now() - tPublish,
      });
    }

    // Persist to server deduplication store
    if (itemGuid) {
      markItemSeen({
        guidHash: computeDeterministicHash(itemGuid),
        guid: itemGuid,
        feedId,
        title: itemTitle,
        status: 'published',
        publishedAt: new Date().toISOString(),
        mastodonStatusId: publishedMastodonId,
        threadsPostId: publishedThreadsId,
      });
    }

    return NextResponse.json({
      success: true,
      executedAt: new Date().toISOString(),
      traces,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Publish execution failed' },
      { status: 500 }
    );
  }
}
```

# .ai_backups\20261027_014211_lib_db.ts

```ts
import fs from 'node:fs';
import path from 'node:path';

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

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'seen_ledger.json');

function ensureStoreExists(): Record<string, PersistentSeenRecord> {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({}), 'utf-8');
    return {};
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function isItemSeen(guidHash: string): boolean {
  const store = ensureStoreExists();
  return Boolean(store[guidHash]);
}

export function markItemSeen(record: PersistentSeenRecord): void {
  const store = ensureStoreExists();
  store[record.guidHash] = record;
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export function getSeenRecords(): PersistentSeenRecord[] {
  const store = ensureStoreExists();
  return Object.values(store).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}
```

# .ai_backups\20261027_014211_package.json

```json
{
  "name": "ai-studio-applet",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "clean": "next clean"
  },
  "dependencies": {
    "@google/genai": "^2.4.0",
    "@hookform/resolvers": "^5.2.1",
    "autoprefixer": "^10.4.21",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "fast-xml-parser": "^4.5.3",
    "lucide-react": "^0.553.0",
    "motion": "^12.23.24",
    "next": "^15.4.9",
    "postcss": "^8.5.6",
    "react": "^19.2.1",
    "react-dom": "^19.2.1",
    "tailwind-merge": "^3.3.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "4.1.11",
    "@tailwindcss/typography": "^0.5.19",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "9.39.1",
    "eslint-config-next": "16.0.8",
    "firebase-tools": "^15.0.0",
    "tailwindcss": "4.1.11",
    "tw-animate-css": "^1.4.0",
    "typescript": "5.9.3"
  }
}
```

# .ai_backups\20261027_014211_Vercel_Next.js

```js
https://your-domain.vercel.app/api/cron
```

# .ai_backups\20261027_014212_app_api_pipeline_poll_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import {
  cleanHtmlToPlainText,
  computeDeterministicHash,
  extractImagesFromHtml,
  MediaEnclosure,
  NormalizedFeedItem,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  cdataPropName: '__cdata',
});

function getText(node: unknown): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj.__cdata) return String(obj.__cdata);
    if (obj['#text']) return String(obj['#text']);
  }
  return String(node);
}

export function parseXmlFeed(xmlText: string, feedId: string, feedName: string): NormalizedFeedItem[] {
  const items: NormalizedFeedItem[] = [];
  const parsed = xmlParser.parse(xmlText);

  // 1. RSS 2.0 / MRSS channel items
  let rawList = parsed?.rss?.channel?.item;
  // 2. Atom feed entries
  if (!rawList) {
    rawList = parsed?.feed?.entry;
  }

  if (!rawList) return [];
  const entries = Array.isArray(rawList) ? rawList : [rawList];

  for (const entry of entries.slice(0, 20)) {
    const rawTitle = getText(entry.title) || 'Untitled Feed Entry';
    const title = cleanHtmlToPlainText(rawTitle, false);

    let link = '';
    if (typeof entry.link === 'string') {
      link = entry.link;
    } else if (entry.link?.['@_href']) {
      link = entry.link['@_href'];
    } else if (Array.isArray(entry.link)) {
      const alt = entry.link.find((l: Record<string, string>) => l['@_rel'] === 'alternate');
      link = alt?.['@_href'] || entry.link[0]?.['@_href'] || getText(entry.link[0]);
    }

    const rawGuid = getText(entry.guid) || getText(entry.id) || link || `${feedId}-${title}`;
    const rawHtml =
      getText(entry['content:encoded']) ||
      getText(entry.content) ||
      getText(entry.description) ||
      getText(entry.summary) ||
      '';

    const author =
      cleanHtmlToPlainText(
        getText(entry.author?.name) || getText(entry.author) || getText(entry['dc:creator']),
        false
      ) || 'bridge-author';

    const pubDate =
      getText(entry.pubDate) ||
      getText(entry.published) ||
      getText(entry.updated) ||
      new Date().toISOString();

    const tags: string[] = [];
    const rawCats = entry.category;
    if (rawCats) {
      const catList = Array.isArray(rawCats) ? rawCats : [rawCats];
      for (const cat of catList) {
        const val = typeof cat === 'string' ? cat : cat['@_term'] || getText(cat);
        if (val && tags.length < 6) tags.push(val);
      }
    }

    const enclosures: MediaEnclosure[] = [];
    const rawEnc = entry.enclosure;
    if (rawEnc) {
      const encList = Array.isArray(rawEnc) ? rawEnc : [rawEnc];
      for (const enc of encList) {
        if (enc?.['@_url']) {
          enclosures.push({
            url: enc['@_url'],
            mimeType: enc['@_type'] || 'image/jpeg',
            source: 'enclosure',
          });
        }
      }
    }

    for (const img of extractImagesFromHtml(rawHtml)) {
      if (!enclosures.some((e) => e.url === img.url)) {
        enclosures.push(img);
      }
    }

    items.push({
      guid: rawGuid,
      hashId: computeDeterministicHash(rawGuid),
      feedId,
      feedName,
      title,
      rawHtml,
      cleanSummary: cleanHtmlToPlainText(rawHtml, true),
      link: link || 'https://rss-bridge.org',
      author,
      publishedAt: Number.isNaN(Date.parse(pubDate))
        ? new Date().toISOString()
        : new Date(pubDate).toISOString(),
      tags: tags.length > 0 ? tags : ['Syndicated'],
      enclosures,
    });
  }

  return items;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { feedId, feedName, bridgeUrl } = body as {
      feedId: string;
      feedName: string;
      bridgeUrl: string;
    };

    if (!bridgeUrl) {
      return NextResponse.json({ error: 'bridgeUrl is required' }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(bridgeUrl, {
      headers: {
        'User-Agent': 'BridgeRelay-Pipeline/2.0 (+https://rss-bridge.org)',
        Accept: 'application/json, application/atom+xml, application/rss+xml, text/xml, */*',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream bridge returned HTTP ${res.status}: ${res.statusText}` },
        { status: 502 }
      );
    }

    const text = await res.text();

    if (text.trim().startsWith('{')) {
      const parsed = JSON.parse(text);
      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
      const normalized: NormalizedFeedItem[] = rawItems.slice(0, 20).map((entry: Record<string, unknown>, idx: number) => {
        const guid = String(entry.id || entry.url || `${feedId}-${idx}`);
        const rawHtml = String(entry.content_html || entry.content_text || entry.summary || '');
        const enclosures: MediaEnclosure[] = [];

        if (Array.isArray(entry.attachments)) {
          for (const att of entry.attachments) {
            if (att && typeof att === 'object' && 'url' in att) {
              enclosures.push({
                url: String((att as { url: string }).url),
                mimeType: String((att as { mime_type?: string }).mime_type || 'image/jpeg'),
                source: 'enclosure',
              });
            }
          }
        }
        for (const img of extractImagesFromHtml(rawHtml)) {
          if (!enclosures.some((e) => e.url === img.url)) enclosures.push(img);
        }

        const authorObj = entry.author as { name?: string } | undefined;
        return {
          guid,
          hashId: computeDeterministicHash(guid),
          feedId,
          feedName,
          title: cleanHtmlToPlainText(String(entry.title || 'Untitled Entry'), false),
          rawHtml,
          cleanSummary: cleanHtmlToPlainText(rawHtml, true),
          link: String(entry.url || bridgeUrl),
          author: authorObj?.name || 'bridge-author',
          publishedAt: String(entry.date_modified || entry.date_published || new Date().toISOString()),
          tags: Array.isArray(entry.tags) ? entry.tags.map(String) : ['RSSBridge'],
          enclosures,
        };
      });

      return NextResponse.json({
        source: 'live_bridge',
        items: normalized,
        polledAt: new Date().toISOString(),
      });
    }

    const xmlItems = parseXmlFeed(text, feedId, feedName);
    return NextResponse.json({
      source: 'live_bridge',
      items: xmlItems,
      polledAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to poll feed' },
      { status: 500 }
    );
  }
}
```

# .ai_backups\20261027_014212_app_api_pipeline_publish_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { markItemSeen } from '@/lib/db';
import { computeDeterministicHash } from '@/lib/pipeline-engine';

export interface PublishStepTrace {
  step: number;
  platform: 'mastodon' | 'threads';
  actionType?: string;
  endpoint: string;
  method: 'POST' | 'GET';
  status: 'success' | 'error';
  httpStatus: number;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  durationMs: number;
}

// Download remote image buffer and upload as multipart/form-data to Mastodon
async function uploadMediaToMastodon(
  mediaUrl: string,
  mastodonInstance: string,
  token: string
): Promise<string> {
  const mediaRes = await fetch(mediaUrl);
  if (!mediaRes.ok) throw new Error(`Failed to fetch media from enclosure: ${mediaUrl}`);
  const blob = await mediaRes.blob();

  const formData = new FormData();
  formData.append('file', blob, 'attachment.jpg');
  formData.append('description', 'Syndicated via BridgeRelay');

  const uploadRes = await fetch(`${mastodonInstance}/api/v2/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Mastodon media upload failed (HTTP ${uploadRes.status}): ${errText}`);
  }

  const uploadData = await uploadRes.json();
  return uploadData.id;
}

// Poll Threads container status until FINISHED or ERROR
async function pollThreadsContainerReady(
  containerId: string,
  threadsToken: string,
  maxAttempts = 5
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusRes = await fetch(
      `https://graph.threads.net/v1.0/${containerId}?fields=status,error_message&access_token=${threadsToken}`
    );
    if (statusRes.ok) {
      const data = await statusRes.json();
      if (data.status === 'FINISHED') return;
      if (data.status === 'ERROR') {
        throw new Error(`Threads container processing failed: ${data.error_message || 'Unknown error'}`);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      itemGuid,
      itemTitle = 'Feed Item',
      feedId = 'feed-default',
      platforms,
      actionType = 'text',
      mastodonPosts,
      threadsPosts,
      linkUrl = '',
      mediaUrls = [],
      visibility = 'public',
      credentials,
    } = body as {
      itemGuid?: string;
      itemTitle?: string;
      feedId?: string;
      platforms: ('mastodon' | 'threads')[];
      actionType?: 'text' | 'link' | 'image' | 'video' | 'carousel';
      mastodonPosts: string[];
      threadsPosts: string[];
      linkUrl?: string;
      mediaUrls?: string[];
      visibility?: 'public' | 'unlisted' | 'private';
      credentials?: {
        mastodonInstanceUrl?: string;
        mastodonAccessToken?: string;
        threadsUserId?: string;
        threadsAccessToken?: string;
      };
    };

    const traces: PublishStepTrace[] = [];
    let stepCounter = 1;

    const mastodonInstance = (
      credentials?.mastodonInstanceUrl ||
      process.env.MASTODON_INSTANCE_URL ||
      'https://mastodon.social'
    ).replace(/\/$/, '');
    const mastodonToken = (
      credentials?.mastodonAccessToken ||
      process.env.MASTODON_ACCESS_TOKEN ||
      ''
    ).trim();

    const threadsUserId = (
      credentials?.threadsUserId ||
      process.env.THREADS_USER_ID ||
      ''
    ).trim();
    const threadsToken = (
      credentials?.threadsAccessToken ||
      process.env.THREADS_ACCESS_TOKEN ||
      ''
    ).trim();

    let publishedMastodonId: string | undefined;
    let publishedThreadsId: string | undefined;

    // 1. Mastodon Publishing
    if (platforms.includes('mastodon') && mastodonPosts.length > 0) {
      if (!mastodonToken) throw new Error('Mastodon access token is missing');

      const uploadedMediaIds: string[] = [];
      if (
        (actionType === 'image' || actionType === 'video' || actionType === 'carousel') &&
        mediaUrls.length > 0
      ) {
        const mediaToUpload = actionType === 'carousel' ? mediaUrls.slice(0, 4) : [mediaUrls[0]];
        for (const url of mediaToUpload) {
          const t0 = Date.now();
          const mediaId = await uploadMediaToMastodon(url, mastodonInstance, mastodonToken);
          uploadedMediaIds.push(mediaId);
          traces.push({
            step: stepCounter++,
            platform: 'mastodon',
            actionType,
            endpoint: `${mastodonInstance}/api/v2/media`,
            method: 'POST',
            status: 'success',
            httpStatus: 200,
            requestPayload: { file_url: url },
            responsePayload: { id: mediaId },
            durationMs: Date.now() - t0,
          });
        }
      }

      let inReplyToId: string | undefined;
      for (let i = 0; i < mastodonPosts.length; i++) {
        const postText = mastodonPosts[i];
        const statusEndpoint = `${mastodonInstance}/api/v1/statuses`;
        const reqPayload: Record<string, unknown> = {
          status: postText,
          visibility,
          ...(i === 0 && uploadedMediaIds.length > 0 ? { media_ids: uploadedMediaIds } : {}),
          ...(inReplyToId ? { in_reply_to_id: inReplyToId } : {}),
        };

        const t0 = Date.now();
        const res = await fetch(statusEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${mastodonToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(reqPayload),
        });
        const resData = await res.json();

        if (!res.ok) {
          throw new Error(`Mastodon status failed (HTTP ${res.status}): ${JSON.stringify(resData)}`);
        }

        inReplyToId = String(resData.id);
        if (i === 0) publishedMastodonId = inReplyToId;

        traces.push({
          step: stepCounter++,
          platform: 'mastodon',
          actionType,
          endpoint: statusEndpoint,
          method: 'POST',
          status: 'success',
          httpStatus: res.status,
          requestPayload: reqPayload,
          responsePayload: resData,
          durationMs: Date.now() - t0,
        });
      }
    }

    // 2. Meta Threads Publishing (Real Graph API)
    if (platforms.includes('threads') && threadsPosts.length > 0) {
      if (!threadsUserId || !threadsToken) {
        throw new Error('Meta Threads User ID or Access Token is missing');
      }

      const containerEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads`;
      const publishEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`;
      const postText = threadsPosts[0];

      let containerIdToPublish = '';

      if (actionType === 'carousel' && mediaUrls.length >= 2) {
        const childContainerIds: string[] = [];
        for (const mUrl of mediaUrls.slice(0, 5)) {
          const t0 = Date.now();
          const isVideo = mUrl.endsWith('.mp4');
          const childParams = new URLSearchParams({
            is_carousel_item: 'true',
            media_type: isVideo ? 'VIDEO' : 'IMAGE',
            [isVideo ? 'video_url' : 'image_url']: mUrl,
            access_token: threadsToken,
          });

          const childRes = await fetch(`${containerEndpoint}?${childParams.toString()}`, { method: 'POST' });
          const childData = await childRes.json();
          if (!childRes.ok) throw new Error(`Threads carousel child failed: ${JSON.stringify(childData)}`);
          childContainerIds.push(childData.id);

          traces.push({
            step: stepCounter++,
            platform: 'threads',
            actionType: 'carousel_item',
            endpoint: containerEndpoint,
            method: 'POST',
            status: 'success',
            httpStatus: childRes.status,
            requestPayload: { media_url: mUrl },
            responsePayload: childData,
            durationMs: Date.now() - t0,
          });
        }

        // Parent carousel container
        const parentParams = new URLSearchParams({
          media_type: 'CAROUSEL',
          children: childContainerIds.join(','),
          text: postText,
          access_token: threadsToken,
        });
        const parentRes = await fetch(`${containerEndpoint}?${parentParams.toString()}`, { method: 'POST' });
        const parentData = await parentRes.json();
        if (!parentRes.ok) throw new Error(`Threads parent carousel failed: ${JSON.stringify(parentData)}`);
        containerIdToPublish = parentData.id;
      } else {
        // Text, link, or single image/video
        const isImage = actionType === 'image' && mediaUrls.length > 0;
        const isVideo = actionType === 'video' && mediaUrls.length > 0;
        const mediaType = isImage ? 'IMAGE' : isVideo ? 'VIDEO' : 'TEXT';

        const params = new URLSearchParams({
          media_type: mediaType,
          text: postText,
          access_token: threadsToken,
          ...(actionType === 'link' && linkUrl ? { link_attachment: linkUrl } : {}),
          ...(isImage ? { image_url: mediaUrls[0] } : {}),
          ...(isVideo ? { video_url: mediaUrls[0] } : {}),
        });

        const t0 = Date.now();
        const createRes = await fetch(`${containerEndpoint}?${params.toString()}`, { method: 'POST' });
        const createData = await createRes.json();
        if (!createRes.ok) throw new Error(`Threads container creation failed: ${JSON.stringify(createData)}`);
        containerIdToPublish = createData.id;

        traces.push({
          step: stepCounter++,
          platform: 'threads',
          actionType,
          endpoint: containerEndpoint,
          method: 'POST',
          status: 'success',
          httpStatus: createRes.status,
          requestPayload: { mediaType, textLength: postText.length },
          responsePayload: createData,
          durationMs: Date.now() - t0,
        });
      }

      // Check container processing readiness
      await pollThreadsContainerReady(containerIdToPublish, threadsToken);

      // Publish container
      const tPublish = Date.now();
      const pubParams = new URLSearchParams({
        creation_id: containerIdToPublish,
        access_token: threadsToken,
      });
      const pubRes = await fetch(`${publishEndpoint}?${pubParams.toString()}`, { method: 'POST' });
      const pubData = await pubRes.json();
      if (!pubRes.ok) throw new Error(`Threads publish failed: ${JSON.stringify(pubData)}`);
      publishedThreadsId = pubData.id;

      traces.push({
        step: stepCounter++,
        platform: 'threads',
        actionType,
        endpoint: publishEndpoint,
        method: 'POST',
        status: 'success',
        httpStatus: pubRes.status,
        requestPayload: { creation_id: containerIdToPublish },
        responsePayload: pubData,
        durationMs: Date.now() - tPublish,
      });
    }

    // Persist to server deduplication database
    if (itemGuid) {
      markItemSeen({
        guidHash: computeDeterministicHash(itemGuid),
        guid: itemGuid,
        feedId,
        title: itemTitle,
        status: 'published',
        publishedAt: new Date().toISOString(),
        mastodonStatusId: publishedMastodonId,
        threadsPostId: publishedThreadsId,
      });
    }

    return NextResponse.json({
      success: true,
      executedAt: new Date().toISOString(),
      traces,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Publish execution failed' },
      { status: 500 }
    );
  }
}
```

# .ai_backups\20261027_014212_app_api_pipeline_verify_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { platform, mastodonInstanceUrl, mastodonAccessToken, threadsUserId, threadsAccessToken } = body;

    if (platform === 'mastodon') {
      const instance = (mastodonInstanceUrl || process.env.MASTODON_INSTANCE_URL || 'https://mastodon.social').replace(/\/$/, '');
      const token = (mastodonAccessToken || process.env.MASTODON_ACCESS_TOKEN || '').trim();

      if (!token) {
        return NextResponse.json({ verified: false, message: 'Missing Mastodon token' }, { status: 400 });
      }

      const res = await fetch(`${instance}/api/v1/accounts/verify_credentials`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const account = await res.json();
        return NextResponse.json({
          verified: true,
          handle: `@${account.username}@${new URL(instance).hostname}`,
          displayName: account.display_name || account.username,
        });
      }
      return NextResponse.json({ verified: false, message: 'Invalid Mastodon credentials' }, { status: 401 });
    }

    if (platform === 'threads') {
      const userId = (threadsUserId || process.env.THREADS_USER_ID || '').trim();
      const token = (threadsAccessToken || process.env.THREADS_ACCESS_TOKEN || '').trim();

      if (!userId || !token) {
        return NextResponse.json({ verified: false, message: 'Missing Threads User ID or Token' }, { status: 400 });
      }

      const res = await fetch(`https://graph.threads.net/v1.0/${userId}?fields=id,username&access_token=${token}`);
      if (res.ok) {
        const profile = await res.json();
        return NextResponse.json({
          verified: true,
          handle: `@${profile.username || userId}`,
        });
      }
      return NextResponse.json({ verified: false, message: 'Invalid Threads credentials' }, { status: 401 });
    }

    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Verification failed' }, { status: 500 });
  }
}
```

# .ai_backups\20261027_014212_components_BridgeRelayStudio.tsx

```tsx
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Plus,
  Rss,
  Send,
  Trash2,
} from 'lucide-react';
import {
  BridgeFeedSource,
  DashboardEnvVar,
  FilterRulesConfig,
  FormattingConfig,
  getEnvValue,
  INITIAL_BRIDGE_FEEDS,
  INITIAL_DASHBOARD_ENV_VARS,
  INITIAL_NORMALIZED_ITEMS,
  INITIAL_SEEN_STATE,
  InitialRunPolicy,
  NormalizedFeedItem,
  renderFormattedPreview,
  resolveEnvVariablesInString,
  SeenEntry,
  SocialActionType,
} from '@/lib/pipeline-engine';
import type { PublishStepTrace } from '@/app/api/pipeline/publish/route';

export type IftttViewMode =
  | 'edit_trigger'
  | 'choose_action'
  | 'edit_action'
  | 'applet_home'
  | 'connections';

interface ActionCardDefinition {
  id: SocialActionType;
  title: string;
  threadsDescription: string;
  mastodonDescription: string;
  defaultTemplate: string;
}

const ACTION_CARDS: ActionCardDefinition[] = [
  {
    id: 'text',
    title: 'Create a text post',
    threadsDescription: 'This action will create a text post on Threads.',
    mastodonDescription: 'This action will create a text post on Mastodon.',
    defaultTemplate: '{title}\n\n{summary}\n\n{tags}',
  },
  {
    id: 'link',
    title: 'Create a link post',
    threadsDescription: 'This action will create a link post on Threads.',
    mastodonDescription: 'This action will create a link post on Mastodon.',
    defaultTemplate: '{title}\n\n{summary}\n\n{link}{UTM_SUFFIX}',
  },
  {
    id: 'image',
    title: 'Create an image post',
    threadsDescription: 'This action will create an image post on Threads.',
    mastodonDescription: 'This action will create an image post on Mastodon.',
    defaultTemplate: '{title}\n\n{link}\n{tags}',
  },
  {
    id: 'video',
    title: 'Create a video post',
    threadsDescription: 'This action will create a video post on Threads.',
    mastodonDescription: 'This action will create a video post on Mastodon.',
    defaultTemplate: '{title} — Watch via {source}\n\n{link}\n{tags}',
  },
  {
    id: 'carousel',
    title: 'Create a carousel (multiple media) post',
    threadsDescription:
      'This action will create a carousel (multiple media) post on Threads. At least two items are required in the carousel.',
    mastodonDescription:
      'This action will create a multi-image carousel post on Mastodon (up to 4 media attachments).',
    defaultTemplate: '{title}\n\n{summary}\n\n{link}\n{tags}',
  },
];

const QUICK_BRIDGE_EXAMPLES = [
  {
    label: 'TikTok Bridge (By user)',
    url: 'https://rss-bridge.org/bridge01/?action=display&bridge=TikTokBridge&context=By+user&username=funnykittenstok&format=Atom',
  },
  {
    label: 'GitHub Releases Bridge',
    url: 'https://rss-bridge.org/bridge01/?action=display&bridge=GithubReleaseBridge&user=RSS-Bridge&repo=rss-bridge&format=Json',
  },
  {
    label: 'Instagram User Bridge',
    url: 'https://rss-bridge.org/bridge01/?action=display&bridge=InstagramBridge&context=Username&u=natgeo&media_type=all&format=Atom',
  },
  {
    label: 'YouTube Channel Bridge',
    url: 'https://rss-bridge.org/bridge01/?action=display&bridge=YoutubeBridge&context=By+username&u=fireship&format=Mrss',
  },
  {
    label: 'Hacker News Bridge',
    url: 'https://rss-bridge.org/bridge01/?action=display&bridge=HackerNewsBridge&area=newest&min_score=150&format=Atom',
  },
];

const STORAGE_KEY_ENV = 'bridgerelay_ifttt_env_v3';
const STORAGE_KEY_TRIGGER_URL = 'bridgerelay_ifttt_trigger_url_v3';

export default function BridgeRelayStudio() {
  const [viewMode, setViewMode] = useState<IftttViewMode>('choose_action');
  const [activeServiceTab, setActiveServiceTab] = useState<'threads' | 'mastodon' | 'both'>('threads');

  const [triggerFeedUrl, setTriggerFeedUrl] = useState<string>(
    'https://rss-bridge.org/bridge01/?action=display&bridge=TikTokBridge&context=By+user&username=funnykittenstok&format=Atom'
  );
  const [showUrlHelper, setShowUrlHelper] = useState<boolean>(false);
  const [initialRunPolicy, setInitialRunPolicy] = useState<InitialRunPolicy>('seed_only');
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState<number>(15);

  const [selectedActionType, setSelectedActionType] = useState<SocialActionType>('image');
  const [actionLinkUrl, setActionLinkUrl] = useState<string>('{link}');
  const [actionMediaUrl, setActionMediaUrl] = useState<string>(
    'https://rss-bridge.org/static/release-2026-10-arch.png'
  );
  const [actionCarouselUrls, setActionCarouselUrls] = useState<string>(
    'https://rss-bridge.org/static/slide-1.jpg, https://rss-bridge.org/static/slide-2.jpg'
  );

  const [envVars, setEnvVars] = useState<DashboardEnvVar[]>(INITIAL_DASHBOARD_ENV_VARS);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  const [newVarKey, setNewVarKey] = useState<string>('');
  const [newVarValue, setNewVarValue] = useState<string>('');
  const [statusBanner, setStatusBanner] = useState<string>('');

  const [items, setItems] = useState<NormalizedFeedItem[]>(INITIAL_NORMALIZED_ITEMS);
  const [selectedItemGuid, setSelectedItemGuid] = useState<string>(INITIAL_NORMALIZED_ITEMS[0].guid);
  const [seenLedger, setSeenLedger] = useState<SeenEntry[]>(INITIAL_SEEN_STATE);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);

  const [formatting, setFormatting] = useState<FormattingConfig>({
    template: '{title}\n\n{summary}\n\n{link}\n{tags}',
    mastodonMaxChars: 500,
    threadsMaxChars: 500,
    mastodonCountUrlAs23Chars: true,
    truncationStrategy: 'ellipsis',
    includeMediaAttachment: true,
    defaultHashtags: ['RSSBridge'],
    mastodonVisibility: 'public',
  });

  const [publishTraces, setPublishTraces] = useState<PublishStepTrace[]>([]);

  useEffect(() => {
    try {
      const savedEnv = localStorage.getItem(STORAGE_KEY_ENV);
      if (savedEnv) {
        const parsed = JSON.parse(savedEnv);
        if (Array.isArray(parsed) && parsed.length > 0) setEnvVars(parsed);
      }
      const savedUrl = localStorage.getItem(STORAGE_KEY_TRIGGER_URL);
      if (savedUrl) setTriggerFeedUrl(savedUrl);
    } catch {
      // ignore
    }
  }, []);

  const updateAndSaveEnvVars = (updater: (prev: DashboardEnvVar[]) => DashboardEnvVar[]) => {
    setEnvVars((prev) => {
      const next = updater(prev);
      try {
        localStorage.setItem(STORAGE_KEY_ENV, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    setStatusBanner('Saved credentials in dashboard');
    setTimeout(() => setStatusBanner(''), 2500);
  };

  const selectedItem = useMemo(() => {
    return items.find((i) => i.guid === selectedItemGuid) || items[0];
  }, [items, selectedItemGuid]);

  const mastodonPreview = useMemo(() => {
    if (!selectedItem) return null;
    return renderFormattedPreview(selectedItem, formatting, 'mastodon', envVars);
  }, [selectedItem, formatting, envVars]);

  const threadsPreview = useMemo(() => {
    if (!selectedItem) return null;
    return renderFormattedPreview(selectedItem, formatting, 'threads', envVars);
  }, [selectedItem, formatting, envVars]);

  const currentActionDefinition = useMemo(() => {
    return ACTION_CARDS.find((c) => c.id === selectedActionType) || ACTION_CARDS[0];
  }, [selectedActionType]);

  const handleUpdateTrigger = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem(STORAGE_KEY_TRIGGER_URL, triggerFeedUrl);
    } catch {
      // ignore
    }

    setIsPolling(true);
    const resolvedUrl = resolveEnvVariablesInString(triggerFeedUrl, envVars);
    setStatusBanner(`Updating trigger & polling ${resolvedUrl}...`);

    try {
      const res = await fetch('/api/pipeline/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedId: 'ifttt-active-trigger',
          feedName: 'RSS-Bridge Trigger',
          bridgeUrl: resolvedUrl,
        }),
      });
      const data = await res.json();
      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        const incoming: NormalizedFeedItem[] = data.items;
        setItems((prev) => {
          const existing = new Set(prev.map((i) => i.guid));
          const fresh = incoming.filter((i) => !existing.has(i.guid));
          return [...fresh, ...prev];
        });
        setSelectedItemGuid(incoming[0].guid);
      }
      setStatusBanner('Trigger updated! Choose your action below.');
      setViewMode('choose_action');
    } catch {
      setStatusBanner('Trigger URL saved.');
      setViewMode('choose_action');
    } finally {
      setIsPolling(false);
    }
  };

  const handleRunAppletNow = async () => {
    if (!selectedItem || !mastodonPreview || !threadsPreview) return;
    setIsPublishing(true);

    const platforms: ('mastodon' | 'threads')[] =
      activeServiceTab === 'both'
        ? ['threads', 'mastodon']
        : activeServiceTab === 'mastodon'
          ? ['mastodon']
          : ['threads'];

    const mediaUrls =
      selectedActionType === 'carousel'
        ? actionCarouselUrls.split(',').map((s) => s.trim()).filter(Boolean)
        : selectedItem.enclosures.length > 0
          ? selectedItem.enclosures.map((e) => e.url)
          : [actionMediaUrl];

    try {
      const res = await fetch('/api/pipeline/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemGuid: selectedItem.guid,
          itemTitle: selectedItem.title,
          feedId: selectedItem.feedId,
          platforms,
          actionType: selectedActionType,
          mastodonPosts: mastodonPreview.posts,
          threadsPosts: threadsPreview.posts,
          linkUrl: resolveEnvVariablesInString(
            actionLinkUrl.replace('{link}', selectedItem.link),
            envVars
          ),
          mediaUrls,
          visibility: formatting.mastodonVisibility,
          credentials: {
            mastodonInstanceUrl: getEnvValue(envVars, 'MASTODON_INSTANCE_URL', 'https://mastodon.social'),
            mastodonAccessToken: getEnvValue(envVars, 'MASTODON_ACCESS_TOKEN', ''),
            threadsUserId: getEnvValue(envVars, 'THREADS_USER_ID', ''),
            threadsAccessToken: getEnvValue(envVars, 'THREADS_ACCESS_TOKEN', ''),
          },
        }),
      });
      const data = await res.json();
      if (data.traces && Array.isArray(data.traces)) {
        setPublishTraces(data.traces);
        setSeenLedger((prev) => [
          {
            guid: selectedItem.guid,
            hashId: selectedItem.hashId,
            feedId: selectedItem.feedId,
            title: selectedItem.title,
            status: platforms.length === 2 ? 'published_both' : platforms[0] === 'mastodon' ? 'published_mastodon' : 'published_threads',
            reason: `Published via "${currentActionDefinition.title}" (${data.traces.length} API steps)`,
            processedAt: new Date().toISOString(),
          },
          ...prev.filter((s) => s.guid !== selectedItem.guid),
        ]);
        setStatusBanner(`Published to ${platforms.join(' & ')}!`);
        setViewMode('applet_home');
      } else if (data.error) {
        setStatusBanner(`Error: ${data.error}`);
      }
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#191919]">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-6 lg:px-10 py-4 bg-white border-b border-slate-200">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setViewMode('applet_home');
          }}
          className="text-xl font-extrabold tracking-tight text-[#191919]"
        >
          BridgeRelay
        </a>

        <nav className="hidden md:flex items-center gap-7 text-sm font-semibold text-slate-600">
          <button
            type="button"
            onClick={() => setViewMode('edit_trigger')}
            className={`py-1 border-b-2 ${viewMode === 'edit_trigger' ? 'border-[#EA7600] text-[#EA7600]' : 'border-transparent hover:text-black'}`}
          >
            Edit Trigger (RSS)
          </button>
          <button
            type="button"
            onClick={() => setViewMode('choose_action')}
            className={`py-1 border-b-2 ${viewMode === 'choose_action' ? 'border-black text-black' : 'border-transparent hover:text-black'}`}
          >
            Threads & Mastodon Actions
          </button>
          <button
            type="button"
            onClick={() => setViewMode('edit_action')}
            className={`py-1 border-b-2 ${viewMode === 'edit_action' ? 'border-black text-black' : 'border-transparent hover:text-black'}`}
          >
            Configure Post Ingredients
          </button>
          <button
            type="button"
            onClick={() => setViewMode('applet_home')}
            className={`py-1 border-b-2 ${viewMode === 'applet_home' ? 'border-black text-black' : 'border-transparent hover:text-black'}`}
          >
            Applet
          </button>
          <button
            type="button"
            onClick={() => setViewMode('connections')}
            className={`py-1 border-b-2 ${viewMode === 'connections' ? 'border-black text-black' : 'border-transparent hover:text-black'}`}
          >
            Dashboard Variables ({envVars.length})
          </button>
        </nav>

        <button
          type="button"
          onClick={handleRunAppletNow}
          disabled={isPublishing}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-extrabold text-white bg-[#191919] rounded-full hover:bg-neutral-800 disabled:opacity-60"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{isPublishing ? 'Publishing...' : 'Run Applet Now'}</span>
        </button>
      </header>

      {statusBanner && (
        <div className="bg-emerald-800 text-white text-xs font-semibold text-center py-2 px-4">
          {statusBanner}
        </div>
      )}

      {/* VIEW: TRIGGER */}
      {viewMode === 'edit_trigger' && (
        <div className="flex-1 bg-[#E56B00] text-white flex flex-col items-center justify-center px-6 py-14">
          <div className="w-full max-w-xl mx-auto flex flex-col items-center">
            <div className="w-full flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => setViewMode('applet_home')}
                className="inline-flex items-center gap-1.5 text-sm font-bold text-white/90 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
            </div>

            <h1 className="text-4xl font-extrabold text-center mb-6">Edit trigger</h1>
            <Rss className="w-24 h-24 text-white mb-6" />

            <form onSubmit={handleUpdateTrigger} className="w-full space-y-6">
              <div>
                <label className="block text-base font-extrabold text-white mb-2">Feed URL</label>
                <textarea
                  rows={4}
                  required
                  value={triggerFeedUrl}
                  onChange={(e) => setTriggerFeedUrl(e.target.value)}
                  className="w-full bg-white text-[#191919] rounded-2xl p-4 text-base focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowUrlHelper((v) => !v)}
                  className="mt-2 text-xs font-bold underline"
                >
                  {showUrlHelper ? 'Hide Presets' : 'Choose from Bridge Presets'}
                </button>
              </div>

              {showUrlHelper && (
                <div className="bg-black/20 rounded-2xl p-4 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {QUICK_BRIDGE_EXAMPLES.map((ex) => (
                      <button
                        key={ex.label}
                        type="button"
                        onClick={() => setTriggerFeedUrl(ex.url)}
                        className="px-3 py-1.5 text-xs font-bold bg-white text-black rounded-lg"
                      >
                        {ex.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-center">
                <button
                  type="submit"
                  disabled={isPolling}
                  className="bg-white text-[#191919] font-extrabold text-xl px-12 py-4 rounded-full"
                >
                  {isPolling ? 'Checking Feed...' : 'Update trigger'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW: CHOOSE ACTION */}
      {viewMode === 'choose_action' && (
        <div className="flex-1 flex flex-col bg-white">
          <div className="bg-[#191919] text-white pt-10 pb-12 px-6 flex flex-col items-center">
            <div className="flex items-center gap-2 bg-white/10 p-1 rounded-full mb-8">
              {(['threads', 'mastodon', 'both'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveServiceTab(tab)}
                  className={`px-4 py-1.5 text-xs font-bold rounded-full capitalize ${activeServiceTab === tab ? 'bg-white text-black' : 'text-white/80'}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-3 text-3xl font-extrabold border-4 border-white">
              {activeServiceTab === 'mastodon' ? 'M' : '@'}
            </div>
            <h1 className="text-3xl font-extrabold capitalize">{activeServiceTab} Actions</h1>
          </div>

          <div className="max-w-5xl w-full mx-auto px-6 py-10">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {ACTION_CARDS.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => {
                    setSelectedActionType(card.id);
                    setFormatting((prev) => ({ ...prev, template: card.defaultTemplate }));
                    setViewMode('edit_action');
                  }}
                  className={`bg-[#191919] text-white rounded-2xl p-6 flex flex-col justify-between text-left min-h-[180px] hover:bg-neutral-900 ${selectedActionType === card.id ? 'ring-4 ring-[#EA7600]' : ''}`}
                >
                  <div>
                    <h2 className="text-xl font-extrabold text-white mb-2">{card.title}</h2>
                    <p className="text-xs text-white/80">
                      {activeServiceTab === 'mastodon' ? card.mastodonDescription : card.threadsDescription}
                    </p>
                  </div>
                  <span className="text-[10px] text-white/50 pt-4">Click to configure</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* VIEW: EDIT ACTION */}
      {viewMode === 'edit_action' && (
        <div className="flex-1 bg-[#191919] text-white flex flex-col items-center px-6 py-10">
          <div className="w-full max-w-2xl mx-auto space-y-6">
            <button
              type="button"
              onClick={() => setViewMode('choose_action')}
              className="inline-flex items-center gap-1.5 text-sm font-bold text-white/80"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to actions</span>
            </button>

            <h1 className="text-3xl font-extrabold text-center">{currentActionDefinition.title}</h1>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold mb-2">Post Template</label>
                <textarea
                  rows={4}
                  value={formatting.template}
                  onChange={(e) => setFormatting((prev) => ({ ...prev, template: e.target.value }))}
                  className="w-full bg-white text-black rounded-xl p-3 text-sm focus:outline-none"
                />
                <div className="flex flex-wrap gap-1 mt-2">
                  {['{title}', '{summary}', '{link}', '{author}', '{tags}'].map((tok) => (
                    <button
                      key={tok}
                      type="button"
                      onClick={() => setFormatting((prev) => ({ ...prev, template: `${prev.template} ${tok}` }))}
                      className="px-2 py-1 text-xs font-bold bg-white text-black rounded"
                    >
                      + {tok}
                    </button>
                  ))}
                </div>
              </div>

              {selectedActionType === 'image' && (
                <div>
                  <label className="block text-sm font-bold mb-1">Fallback Image URL</label>
                  <input
                    type="text"
                    value={actionMediaUrl}
                    onChange={(e) => setActionMediaUrl(e.target.value)}
                    className="w-full bg-white text-black rounded-lg p-2.5 text-xs font-mono"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-center gap-4">
              <button
                type="button"
                onClick={() => setViewMode('applet_home')}
                className="bg-white text-black font-extrabold text-lg px-10 py-3 rounded-full"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: APPLET HOME */}
      {viewMode === 'applet_home' && (
        <div className="flex-1 max-w-3xl w-full mx-auto px-6 py-10 space-y-8">
          <h1 className="text-3xl font-extrabold text-center">Your Active Applet</h1>

          <div className="space-y-4">
            <div className="bg-[#E56B00] text-white rounded-2xl p-6 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-white/70">If This</div>
                <div className="text-xl font-extrabold">New feed item (RSS)</div>
                <div className="text-xs font-mono truncate max-w-md mt-1">{triggerFeedUrl}</div>
              </div>
              <button
                type="button"
                onClick={() => setViewMode('edit_trigger')}
                className="px-4 py-2 bg-white text-black text-xs font-bold rounded-full"
              >
                Edit
              </button>
            </div>

            <div className="bg-[#191919] text-white rounded-2xl p-6 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-white/70">Then That</div>
                <div className="text-xl font-extrabold">{currentActionDefinition.title}</div>
              </div>
              <button
                type="button"
                onClick={() => setViewMode('choose_action')}
                className="px-4 py-2 bg-white text-black text-xs font-bold rounded-full"
              >
                Change
              </button>
            </div>
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleRunAppletNow}
              disabled={isPublishing}
              className="bg-[#191919] text-white font-extrabold text-lg px-10 py-4 rounded-full"
            >
              {isPublishing ? 'Publishing...' : 'Run Applet Now'}
            </button>
          </div>

          {publishTraces.length > 0 && (
            <div className="border border-slate-200 rounded-2xl p-4 space-y-2 bg-slate-50">
              <h3 className="text-xs font-extrabold">Last Execution Log ({publishTraces.length} API Calls)</h3>
              {publishTraces.map((t) => (
                <div key={t.step} className="p-2.5 bg-white border border-slate-200 rounded-lg text-xs flex justify-between">
                  <span className="font-mono">{t.platform}: {t.endpoint}</span>
                  <span className="font-bold text-emerald-700">HTTP {t.httpStatus}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW: CONNECTIONS & ENV */}
      {viewMode === 'connections' && (
        <div className="flex-1 max-w-4xl w-full mx-auto px-6 py-10 space-y-6">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-extrabold">Credentials & Variables</h1>
            <button
              type="button"
              onClick={() => setViewMode('applet_home')}
              className="px-4 py-2 bg-black text-white text-xs font-bold rounded-full"
            >
              Done
            </button>
          </div>

          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="p-3">Variable</th>
                  <th className="p-3">Value</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {envVars.map((v) => (
                  <tr key={v.id}>
                    <td className="p-3 font-mono font-bold">{v.key}</td>
                    <td className="p-3">
                      <input
                        type={v.isSecret && !revealedSecrets[v.id] ? 'password' : 'text'}
                        value={v.value}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateAndSaveEnvVars((prev) =>
                            prev.map((item) => (item.id === v.id ? { ...item, value: val } : item))
                          );
                        }}
                        className="w-full p-1.5 border border-slate-300 rounded font-mono text-xs"
                      />
                    </td>
                    <td className="p-3 text-right">
                      {v.isSecret && (
                        <button
                          type="button"
                          onClick={() => setRevealedSecrets((prev) => ({ ...prev, [v.id]: !prev[v.id] }))}
                          className="p-1 text-slate-500"
                        >
                          {revealedSecrets[v.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

# .ai_backups\20261027_014212_lib_db.ts

```ts
// In lib/db.ts:
const DATA_DIR = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'seen_ledger.json');
```

# .ai_backups\20261027_014212_lib_utils.ts

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

# .ai_backups\20261027_014212_next.config.ts

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;
```

# .ai_backups\20261027_014213_app_api_pipeline_poll_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isItemSeen } from '@/lib/db';
import {
  evaluateFilterRules,
  renderFormattedPreview,
  INITIAL_BRIDGE_FEEDS,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${host}`;

  const results = [];

  for (const feed of INITIAL_BRIDGE_FEEDS.filter((f) => f.enabled)) {
    try {
      const pollRes = await fetch(`${baseUrl}/api/pipeline/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedId: feed.id,
          feedName: feed.name,
          bridgeUrl: feed.bridgeUrl.replace(
            '{RSS_BRIDGE_BASE_URL}',
            process.env.RSS_BRIDGE_BASE_URL || 'https://rss-bridge.org/bridge01'
          ),
        }),
      });

      if (!pollRes.ok) continue;
      const { items } = await pollRes.json();

      for (const item of items) {
        if (isItemSeen(item.hashId)) continue;

        const filterCheck = evaluateFilterRules(item, {
          keywordWhitelist: [],
          keywordBlacklist: ['sponsored', 'ad'],
          regexPattern: '',
          regexInvert: false,
          authorWhitelist: [],
          minContentLength: 10,
          maxContentLength: 4000,
          requireMediaAttachment: false,
          stripHtmlPreserveBreaks: true,
          extractInlineImages: true,
        });

        if (!filterCheck.passed) continue;

        const mastoPreview = renderFormattedPreview(
          item,
          {
            template: '{title}\n\n{summary}\n\n{link}\n{tags}',
            mastodonMaxChars: 500,
            threadsMaxChars: 500,
            mastodonCountUrlAs23Chars: true,
            truncationStrategy: 'ellipsis',
            includeMediaAttachment: true,
            defaultHashtags: ['RSSBridge'],
            mastodonVisibility: 'public',
          },
          'mastodon'
        );

        const threadsPreview = renderFormattedPreview(
          item,
          {
            template: '{title}\n\n{summary}\n\n{link}\n{tags}',
            mastodonMaxChars: 500,
            threadsMaxChars: 500,
            mastodonCountUrlAs23Chars: true,
            truncationStrategy: 'ellipsis',
            includeMediaAttachment: true,
            defaultHashtags: ['RSSBridge'],
            mastodonVisibility: 'public',
          },
          'threads'
        );

        const pubRes = await fetch(`${baseUrl}/api/pipeline/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemGuid: item.guid,
            itemTitle: item.title,
            feedId: feed.id,
            platforms: ['mastodon', 'threads'],
            actionType: item.enclosures.length > 0 ? 'image' : 'text',
            mastodonPosts: mastoPreview.posts,
            threadsPosts: threadsPreview.posts,
            mediaUrls: item.enclosures.map((e) => e.url),
          }),
        });

        results.push({ item: item.title, published: pubRes.ok });
        break;
      }
    } catch (e) {
      console.error(`Cron error on feed ${feed.id}:`, e);
    }
  }

  return NextResponse.json({
    status: 'cron_completed',
    processedAt: new Date().toISOString(),
    results,
  });
}
```

# .ai_backups\20261027_014213_lib_utils.ts

```ts
git add .
git commit -m "Fix Vercel 404s, add serverless storage and real publishing"
git push
```

# .ai_backups\20261027_014213_package.json

```json
{
  "name": "bridgerelay",
  "version": "0.2.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint ."
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "fast-xml-parser": "^4.5.3",
    "lucide-react": "^0.553.0",
    "next": "^15.4.9",
    "react": "^19.2.1",
    "react-dom": "^19.2.1",
    "tailwind-merge": "^3.3.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.11",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "autoprefixer": "^10.4.21",
    "eslint": "^9.20.0",
    "eslint-config-next": "^15.4.9",
    "postcss": "^8.5.6",
    "tailwindcss": "^4.1.11",
    "typescript": "^5.9.3"
  }
}
```

# .ai_backups\20261027_014214_app_api_pipeline_poll_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isItemSeen } from '@/lib/db';
import {
  evaluateFilterRules,
  renderFormattedPreview,
  INITIAL_BRIDGE_FEEDS,
  NormalizedFeedItem,
  MediaEnclosure,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${host}`;

  const results = [];

  for (const feed of INITIAL_BRIDGE_FEEDS.filter((f) => f.enabled)) {
    try {
      const pollRes = await fetch(`${baseUrl}/api/pipeline/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedId: feed.id,
          feedName: feed.name,
          bridgeUrl: feed.bridgeUrl.replace(
            '{RSS_BRIDGE_BASE_URL}',
            process.env.RSS_BRIDGE_BASE_URL || 'https://rss-bridge.org/bridge01'
          ),
        }),
      });

      if (!pollRes.ok) continue;
      const data = (await pollRes.json()) as { items?: NormalizedFeedItem[] };
      const items: NormalizedFeedItem[] = data.items || [];

      for (const item of items) {
        if (isItemSeen(item.hashId)) continue;

        const filterCheck = evaluateFilterRules(item, {
          keywordWhitelist: [],
          keywordBlacklist: ['sponsored', 'ad'],
          regexPattern: '',
          regexInvert: false,
          authorWhitelist: [],
          minContentLength: 10,
          maxContentLength: 4000,
          requireMediaAttachment: false,
          stripHtmlPreserveBreaks: true,
          extractInlineImages: true,
        });

        if (!filterCheck.passed) continue;

        const mastoPreview = renderFormattedPreview(
          item,
          {
            template: '{title}\n\n{summary}\n\n{link}\n{tags}',
            mastodonMaxChars: 500,
            threadsMaxChars: 500,
            mastodonCountUrlAs23Chars: true,
            truncationStrategy: 'ellipsis',
            includeMediaAttachment: true,
            defaultHashtags: ['RSSBridge'],
            mastodonVisibility: 'public',
          },
          'mastodon'
        );

        const threadsPreview = renderFormattedPreview(
          item,
          {
            template: '{title}\n\n{summary}\n\n{link}\n{tags}',
            mastodonMaxChars: 500,
            threadsMaxChars: 500,
            mastodonCountUrlAs23Chars: true,
            truncationStrategy: 'ellipsis',
            includeMediaAttachment: true,
            defaultHashtags: ['RSSBridge'],
            mastodonVisibility: 'public',
          },
          'threads'
        );

        const pubRes = await fetch(`${baseUrl}/api/pipeline/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemGuid: item.guid,
            itemTitle: item.title,
            feedId: feed.id,
            platforms: ['mastodon', 'threads'],
            actionType: item.enclosures.length > 0 ? 'image' : 'text',
            mastodonPosts: mastoPreview.posts,
            threadsPosts: threadsPreview.posts,
            mediaUrls: item.enclosures.map((e: MediaEnclosure) => e.url),
          }),
        });

        results.push({ item: item.title, published: pubRes.ok });
        break;
      }
    } catch (e) {
      console.error(`Cron error on feed ${feed.id}:`, e);
    }
  }

  return NextResponse.json({
    status: 'cron_completed',
    processedAt: new Date().toISOString(),
    results,
  });
}
```

# .ai_backups\20261027_023525_app_api_pipeline_poll_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import {
  cleanHtmlToPlainText,
  computeDeterministicHash,
  extractImagesFromHtml,
  MediaEnclosure,
  NormalizedFeedItem,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  cdataPropName: '__cdata',
});

function getText(node: unknown): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj.__cdata) return String(obj.__cdata);
    if (obj['#text']) return String(obj['#text']);
  }
  return String(node);
}

export function parseXmlFeed(xmlText: string, feedId: string, feedName: string): NormalizedFeedItem[] {
  const items: NormalizedFeedItem[] = [];
  const parsed = xmlParser.parse(xmlText);

  // 1. RSS 2.0 / MRSS channel items
  let rawList = parsed?.rss?.channel?.item;
  // 2. Atom feed entries
  if (!rawList) {
    rawList = parsed?.feed?.entry;
  }

  if (!rawList) return [];
  const entries = Array.isArray(rawList) ? rawList : [rawList];

  for (const entry of entries.slice(0, 20)) {
    const rawTitle = getText(entry.title) || 'Untitled Feed Entry';
    const title = cleanHtmlToPlainText(rawTitle, false);

    let link = '';
    if (typeof entry.link === 'string') {
      link = entry.link;
    } else if (entry.link?.['@_href']) {
      link = entry.link['@_href'];
    } else if (Array.isArray(entry.link)) {
      const alt = entry.link.find((l: Record<string, string>) => l['@_rel'] === 'alternate');
      link = alt?.['@_href'] || entry.link[0]?.['@_href'] || getText(entry.link[0]);
    }

    const rawGuid = getText(entry.guid) || getText(entry.id) || link || `${feedId}-${title}`;
    const rawHtml =
      getText(entry['content:encoded']) ||
      getText(entry.content) ||
      getText(entry.description) ||
      getText(entry.summary) ||
      '';

    const author =
      cleanHtmlToPlainText(
        getText(entry.author?.name) || getText(entry.author) || getText(entry['dc:creator']),
        false
      ) || 'bridge-author';

    const pubDate =
      getText(entry.pubDate) ||
      getText(entry.published) ||
      getText(entry.updated) ||
      new Date().toISOString();

    const tags: string[] = [];
    const rawCats = entry.category;
    if (rawCats) {
      const catList = Array.isArray(rawCats) ? rawCats : [rawCats];
      for (const cat of catList) {
        const val = typeof cat === 'string' ? cat : cat['@_term'] || getText(cat);
        if (val && tags.length < 6) tags.push(val);
      }
    }

    const enclosures: MediaEnclosure[] = [];
    const rawEnc = entry.enclosure;
    if (rawEnc) {
      const encList = Array.isArray(rawEnc) ? rawEnc : [rawEnc];
      for (const enc of encList) {
        if (enc?.['@_url']) {
          enclosures.push({
            url: enc['@_url'],
            mimeType: enc['@_type'] || 'image/jpeg',
            source: 'enclosure',
          });
        }
      }
    }

    for (const img of extractImagesFromHtml(rawHtml)) {
      if (!enclosures.some((e) => e.url === img.url)) {
        enclosures.push(img);
      }
    }

    items.push({
      guid: rawGuid,
      hashId: computeDeterministicHash(rawGuid),
      feedId,
      feedName,
      title,
      rawHtml,
      cleanSummary: cleanHtmlToPlainText(rawHtml, true),
      link: link || 'https://rss-bridge.org',
      author,
      publishedAt: Number.isNaN(Date.parse(pubDate))
        ? new Date().toISOString()
        : new Date(pubDate).toISOString(),
      tags: tags.length > 0 ? tags : ['Syndicated'],
      enclosures,
    });
  }

  return items;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { feedId, feedName, bridgeUrl } = body as {
      feedId: string;
      feedName: string;
      bridgeUrl: string;
    };

    if (!bridgeUrl) {
      return NextResponse.json({ error: 'bridgeUrl is required' }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(bridgeUrl, {
      headers: {
        'User-Agent': 'BridgeRelay-Pipeline/2.0 (+https://rss-bridge.org)',
        Accept: 'application/json, application/atom+xml, application/rss+xml, text/xml, */*',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream bridge returned HTTP ${res.status}: ${res.statusText}` },
        { status: 502 }
      );
    }

    const text = await res.text();

    if (text.trim().startsWith('{')) {
      const parsed = JSON.parse(text);
      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
      const normalized: NormalizedFeedItem[] = rawItems.slice(0, 20).map((entry: Record<string, unknown>, idx: number) => {
        const guid = String(entry.id || entry.url || `${feedId}-${idx}`);
        const rawHtml = String(entry.content_html || entry.content_text || entry.summary || '');
        const enclosures: MediaEnclosure[] = [];

        if (Array.isArray(entry.attachments)) {
          for (const att of entry.attachments) {
            if (att && typeof att === 'object' && 'url' in att) {
              enclosures.push({
                url: String((att as { url: string }).url),
                mimeType: String((att as { mime_type?: string }).mime_type || 'image/jpeg'),
                source: 'enclosure',
              });
            }
          }
        }
        for (const img of extractImagesFromHtml(rawHtml)) {
          if (!enclosures.some((e) => e.url === img.url)) enclosures.push(img);
        }

        const authorObj = entry.author as { name?: string } | undefined;
        return {
          guid,
          hashId: computeDeterministicHash(guid),
          feedId,
          feedName,
          title: cleanHtmlToPlainText(String(entry.title || 'Untitled Entry'), false),
          rawHtml,
          cleanSummary: cleanHtmlToPlainText(rawHtml, true),
          link: String(entry.url || bridgeUrl),
          author: authorObj?.name || 'bridge-author',
          publishedAt: String(entry.date_modified || entry.date_published || new Date().toISOString()),
          tags: Array.isArray(entry.tags) ? entry.tags.map(String) : ['RSSBridge'],
          enclosures,
        };
      });

      return NextResponse.json({
        source: 'live_bridge',
        items: normalized,
        polledAt: new Date().toISOString(),
      });
    }

    const xmlItems = parseXmlFeed(text, feedId, feedName);
    return NextResponse.json({
      source: 'live_bridge',
      items: xmlItems,
      polledAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to poll feed' },
      { status: 500 }
    );
  }
}
```

# .ai_backups\20261027_023525_app_api_pipeline_publish_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { markItemSeen } from '@/lib/db';
import { computeDeterministicHash } from '@/lib/pipeline-engine';

export interface PublishStepTrace {
  step: number;
  platform: 'mastodon' | 'threads';
  actionType?: string;
  endpoint: string;
  method: 'POST' | 'GET';
  status: 'success' | 'error';
  httpStatus: number;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  durationMs: number;
}

// Download remote image buffer and upload as multipart/form-data to Mastodon
async function uploadMediaToMastodon(
  mediaUrl: string,
  mastodonInstance: string,
  token: string
): Promise<string> {
  const mediaRes = await fetch(mediaUrl);
  if (!mediaRes.ok) throw new Error(`Failed to fetch media from enclosure: ${mediaUrl}`);
  const blob = await mediaRes.blob();

  const formData = new FormData();
  formData.append('file', blob, 'attachment.jpg');
  formData.append('description', 'Syndicated via BridgeRelay');

  const uploadRes = await fetch(`${mastodonInstance}/api/v2/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Mastodon media upload failed (HTTP ${uploadRes.status}): ${errText}`);
  }

  const uploadData = await uploadRes.json();
  return uploadData.id;
}

// Poll Threads container status until FINISHED or ERROR
async function pollThreadsContainerReady(
  containerId: string,
  threadsToken: string,
  maxAttempts = 5
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusRes = await fetch(
      `https://graph.threads.net/v1.0/${containerId}?fields=status,error_message&access_token=${threadsToken}`
    );
    if (statusRes.ok) {
      const data = await statusRes.json();
      if (data.status === 'FINISHED') return;
      if (data.status === 'ERROR') {
        throw new Error(`Threads container processing failed: ${data.error_message || 'Unknown error'}`);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      itemGuid,
      itemTitle = 'Feed Item',
      feedId = 'feed-default',
      platforms,
      actionType = 'text',
      mastodonPosts,
      threadsPosts,
      linkUrl = '',
      mediaUrls = [],
      visibility = 'public',
      credentials,
    } = body as {
      itemGuid?: string;
      itemTitle?: string;
      feedId?: string;
      platforms: ('mastodon' | 'threads')[];
      actionType?: 'text' | 'link' | 'image' | 'video' | 'carousel';
      mastodonPosts: string[];
      threadsPosts: string[];
      linkUrl?: string;
      mediaUrls?: string[];
      visibility?: 'public' | 'unlisted' | 'private';
      credentials?: {
        mastodonInstanceUrl?: string;
        mastodonAccessToken?: string;
        threadsUserId?: string;
        threadsAccessToken?: string;
      };
    };

    const traces: PublishStepTrace[] = [];
    let stepCounter = 1;

    const mastodonInstance = (
      credentials?.mastodonInstanceUrl ||
      process.env.MASTODON_INSTANCE_URL ||
      'https://mastodon.social'
    ).replace(/\/$/, '');
    const mastodonToken = (
      credentials?.mastodonAccessToken ||
      process.env.MASTODON_ACCESS_TOKEN ||
      ''
    ).trim();

    const threadsUserId = (
      credentials?.threadsUserId ||
      process.env.THREADS_USER_ID ||
      ''
    ).trim();
    const threadsToken = (
      credentials?.threadsAccessToken ||
      process.env.THREADS_ACCESS_TOKEN ||
      ''
    ).trim();

    let publishedMastodonId: string | undefined;
    let publishedThreadsId: string | undefined;

    // 1. Mastodon Publishing
    if (platforms.includes('mastodon') && mastodonPosts.length > 0) {
      if (!mastodonToken) throw new Error('Mastodon access token is missing');

      const uploadedMediaIds: string[] = [];
      if (
        (actionType === 'image' || actionType === 'video' || actionType === 'carousel') &&
        mediaUrls.length > 0
      ) {
        const mediaToUpload = actionType === 'carousel' ? mediaUrls.slice(0, 4) : [mediaUrls[0]];
        for (const url of mediaToUpload) {
          const t0 = Date.now();
          const mediaId = await uploadMediaToMastodon(url, mastodonInstance, mastodonToken);
          uploadedMediaIds.push(mediaId);
          traces.push({
            step: stepCounter++,
            platform: 'mastodon',
            actionType,
            endpoint: `${mastodonInstance}/api/v2/media`,
            method: 'POST',
            status: 'success',
            httpStatus: 200,
            requestPayload: { file_url: url },
            responsePayload: { id: mediaId },
            durationMs: Date.now() - t0,
          });
        }
      }

      let inReplyToId: string | undefined;
      for (let i = 0; i < mastodonPosts.length; i++) {
        const postText = mastodonPosts[i];
        const statusEndpoint = `${mastodonInstance}/api/v1/statuses`;
        const reqPayload: Record<string, unknown> = {
          status: postText,
          visibility,
          ...(i === 0 && uploadedMediaIds.length > 0 ? { media_ids: uploadedMediaIds } : {}),
          ...(inReplyToId ? { in_reply_to_id: inReplyToId } : {}),
        };

        const t0 = Date.now();
        const res = await fetch(statusEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${mastodonToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(reqPayload),
        });
        const resData = await res.json();

        if (!res.ok) {
          throw new Error(`Mastodon status failed (HTTP ${res.status}): ${JSON.stringify(resData)}`);
        }

        inReplyToId = String(resData.id);
        if (i === 0) publishedMastodonId = inReplyToId;

        traces.push({
          step: stepCounter++,
          platform: 'mastodon',
          actionType,
          endpoint: statusEndpoint,
          method: 'POST',
          status: 'success',
          httpStatus: res.status,
          requestPayload: reqPayload,
          responsePayload: resData,
          durationMs: Date.now() - t0,
        });
      }
    }

    // 2. Meta Threads Publishing (Real Graph API)
    if (platforms.includes('threads') && threadsPosts.length > 0) {
      if (!threadsUserId || !threadsToken) {
        throw new Error('Meta Threads User ID or Access Token is missing');
      }

      const containerEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads`;
      const publishEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`;
      const postText = threadsPosts[0];

      let containerIdToPublish = '';

      if (actionType === 'carousel' && mediaUrls.length >= 2) {
        const childContainerIds: string[] = [];
        for (const mUrl of mediaUrls.slice(0, 5)) {
          const t0 = Date.now();
          const isVideo = mUrl.endsWith('.mp4');
          const childParams = new URLSearchParams({
            is_carousel_item: 'true',
            media_type: isVideo ? 'VIDEO' : 'IMAGE',
            [isVideo ? 'video_url' : 'image_url']: mUrl,
            access_token: threadsToken,
          });

          const childRes = await fetch(`${containerEndpoint}?${childParams.toString()}`, { method: 'POST' });
          const childData = await childRes.json();
          if (!childRes.ok) throw new Error(`Threads carousel child failed: ${JSON.stringify(childData)}`);
          childContainerIds.push(childData.id);

          traces.push({
            step: stepCounter++,
            platform: 'threads',
            actionType: 'carousel_item',
            endpoint: containerEndpoint,
            method: 'POST',
            status: 'success',
            httpStatus: childRes.status,
            requestPayload: { media_url: mUrl },
            responsePayload: childData,
            durationMs: Date.now() - t0,
          });
        }

        // Parent carousel container
        const parentParams = new URLSearchParams({
          media_type: 'CAROUSEL',
          children: childContainerIds.join(','),
          text: postText,
          access_token: threadsToken,
        });
        const parentRes = await fetch(`${containerEndpoint}?${parentParams.toString()}`, { method: 'POST' });
        const parentData = await parentRes.json();
        if (!parentRes.ok) throw new Error(`Threads parent carousel failed: ${JSON.stringify(parentData)}`);
        containerIdToPublish = parentData.id;
      } else {
        // Text, link, or single image/video
        const isImage = actionType === 'image' && mediaUrls.length > 0;
        const isVideo = actionType === 'video' && mediaUrls.length > 0;
        const mediaType = isImage ? 'IMAGE' : isVideo ? 'VIDEO' : 'TEXT';

        const params = new URLSearchParams({
          media_type: mediaType,
          text: postText,
          access_token: threadsToken,
          ...(actionType === 'link' && linkUrl ? { link_attachment: linkUrl } : {}),
          ...(isImage ? { image_url: mediaUrls[0] } : {}),
          ...(isVideo ? { video_url: mediaUrls[0] } : {}),
        });

        const t0 = Date.now();
        const createRes = await fetch(`${containerEndpoint}?${params.toString()}`, { method: 'POST' });
        const createData = await createRes.json();
        if (!createRes.ok) throw new Error(`Threads container creation failed: ${JSON.stringify(createData)}`);
        containerIdToPublish = createData.id;

        traces.push({
          step: stepCounter++,
          platform: 'threads',
          actionType,
          endpoint: containerEndpoint,
          method: 'POST',
          status: 'success',
          httpStatus: createRes.status,
          requestPayload: { mediaType, textLength: postText.length },
          responsePayload: createData,
          durationMs: Date.now() - t0,
        });
      }

      // Check container processing readiness
      await pollThreadsContainerReady(containerIdToPublish, threadsToken);

      // Publish container
      const tPublish = Date.now();
      const pubParams = new URLSearchParams({
        creation_id: containerIdToPublish,
        access_token: threadsToken,
      });
      const pubRes = await fetch(`${publishEndpoint}?${pubParams.toString()}`, { method: 'POST' });
      const pubData = await pubRes.json();
      if (!pubRes.ok) throw new Error(`Threads publish failed: ${JSON.stringify(pubData)}`);
      publishedThreadsId = pubData.id;

      traces.push({
        step: stepCounter++,
        platform: 'threads',
        actionType,
        endpoint: publishEndpoint,
        method: 'POST',
        status: 'success',
        httpStatus: pubRes.status,
        requestPayload: { creation_id: containerIdToPublish },
        responsePayload: pubData,
        durationMs: Date.now() - tPublish,
      });
    }

    // Persist to server deduplication database
    if (itemGuid) {
      markItemSeen({
        guidHash: computeDeterministicHash(itemGuid),
        guid: itemGuid,
        feedId,
        title: itemTitle,
        status: 'published',
        publishedAt: new Date().toISOString(),
        mastodonStatusId: publishedMastodonId,
        threadsPostId: publishedThreadsId,
      });
    }

    return NextResponse.json({
      success: true,
      executedAt: new Date().toISOString(),
      traces,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Publish execution failed' },
      { status: 500 }
    );
  }
}
```

# .ai_backups\20261027_023525_app_api_pipeline_verify_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { platform, mastodonInstanceUrl, mastodonAccessToken, threadsUserId, threadsAccessToken } = body;

    if (platform === 'mastodon') {
      const instance = (mastodonInstanceUrl || process.env.MASTODON_INSTANCE_URL || 'https://mastodon.social').replace(/\/$/, '');
      const token = (mastodonAccessToken || process.env.MASTODON_ACCESS_TOKEN || '').trim();

      if (!token) {
        return NextResponse.json({ verified: false, message: 'Missing Mastodon token' }, { status: 400 });
      }

      const res = await fetch(`${instance}/api/v1/accounts/verify_credentials`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const account = await res.json();
        return NextResponse.json({
          verified: true,
          handle: `@${account.username}@${new URL(instance).hostname}`,
          displayName: account.display_name || account.username,
        });
      }
      return NextResponse.json({ verified: false, message: 'Invalid Mastodon credentials' }, { status: 401 });
    }

    if (platform === 'threads') {
      const userId = (threadsUserId || process.env.THREADS_USER_ID || '').trim();
      const token = (threadsAccessToken || process.env.THREADS_ACCESS_TOKEN || '').trim();

      if (!userId || !token) {
        return NextResponse.json({ verified: false, message: 'Missing Threads User ID or Token' }, { status: 400 });
      }

      const res = await fetch(`https://graph.threads.net/v1.0/${userId}?fields=id,username&access_token=${token}`);
      if (res.ok) {
        const profile = await res.json();
        return NextResponse.json({
          verified: true,
          handle: `@${profile.username || userId}`,
        });
      }
      return NextResponse.json({ verified: false, message: 'Invalid Threads credentials' }, { status: 401 });
    }

    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Verification failed' }, { status: 500 });
  }
}
```

# .ai_backups\20261027_023525_components_BridgeRelayStudio.tsx

```tsx
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Plus,
  Rss,
  Send,
  Trash2,
} from 'lucide-react';
import {
  BridgeFeedSource,
  DashboardEnvVar,
  FilterRulesConfig,
  FormattingConfig,
  getEnvValue,
  INITIAL_BRIDGE_FEEDS,
  INITIAL_DASHBOARD_ENV_VARS,
  INITIAL_NORMALIZED_ITEMS,
  INITIAL_SEEN_STATE,
  InitialRunPolicy,
  NormalizedFeedItem,
  renderFormattedPreview,
  resolveEnvVariablesInString,
  SeenEntry,
  SocialActionType,
} from '@/lib/pipeline-engine';
import type { PublishStepTrace } from '@/app/api/pipeline/publish/route';

export type IftttViewMode =
  | 'edit_trigger'
  | 'choose_action'
  | 'edit_action'
  | 'applet_home'
  | 'connections';

interface ActionCardDefinition {
  id: SocialActionType;
  title: string;
  threadsDescription: string;
  mastodonDescription: string;
  defaultTemplate: string;
}

const ACTION_CARDS: ActionCardDefinition[] = [
  {
    id: 'text',
    title: 'Create a text post',
    threadsDescription: 'This action will create a text post on Threads.',
    mastodonDescription: 'This action will create a text post on Mastodon.',
    defaultTemplate: '{title}\n\n{summary}\n\n{tags}',
  },
  {
    id: 'link',
    title: 'Create a link post',
    threadsDescription: 'This action will create a link post on Threads.',
    mastodonDescription: 'This action will create a link post on Mastodon.',
    defaultTemplate: '{title}\n\n{summary}\n\n{link}{UTM_SUFFIX}',
  },
  {
    id: 'image',
    title: 'Create an image post',
    threadsDescription: 'This action will create an image post on Threads.',
    mastodonDescription: 'This action will create an image post on Mastodon.',
    defaultTemplate: '{title}\n\n{link}\n{tags}',
  },
  {
    id: 'video',
    title: 'Create a video post',
    threadsDescription: 'This action will create a video post on Threads.',
    mastodonDescription: 'This action will create a video post on Mastodon.',
    defaultTemplate: '{title} — Watch via {source}\n\n{link}\n{tags}',
  },
  {
    id: 'carousel',
    title: 'Create a carousel (multiple media) post',
    threadsDescription:
      'This action will create a carousel (multiple media) post on Threads. At least two items are required in the carousel.',
    mastodonDescription:
      'This action will create a multi-image carousel post on Mastodon (up to 4 media attachments).',
    defaultTemplate: '{title}\n\n{summary}\n\n{link}\n{tags}',
  },
];

const QUICK_BRIDGE_EXAMPLES = [
  {
    label: 'TikTok Bridge (By user)',
    url: 'https://rss-bridge.org/bridge01/?action=display&bridge=TikTokBridge&context=By+user&username=funnykittenstok&format=Atom',
  },
  {
    label: 'GitHub Releases Bridge',
    url: 'https://rss-bridge.org/bridge01/?action=display&bridge=GithubReleaseBridge&user=RSS-Bridge&repo=rss-bridge&format=Json',
  },
  {
    label: 'Instagram User Bridge',
    url: 'https://rss-bridge.org/bridge01/?action=display&bridge=InstagramBridge&context=Username&u=natgeo&media_type=all&format=Atom',
  },
  {
    label: 'YouTube Channel Bridge',
    url: 'https://rss-bridge.org/bridge01/?action=display&bridge=YoutubeBridge&context=By+username&u=fireship&format=Mrss',
  },
  {
    label: 'Hacker News Bridge',
    url: 'https://rss-bridge.org/bridge01/?action=display&bridge=HackerNewsBridge&area=newest&min_score=150&format=Atom',
  },
];

const STORAGE_KEY_ENV = 'bridgerelay_ifttt_env_v3';
const STORAGE_KEY_TRIGGER_URL = 'bridgerelay_ifttt_trigger_url_v3';

export default function BridgeRelayStudio() {
  const [viewMode, setViewMode] = useState<IftttViewMode>('choose_action');
  const [activeServiceTab, setActiveServiceTab] = useState<'threads' | 'mastodon' | 'both'>('threads');

  const [triggerFeedUrl, setTriggerFeedUrl] = useState<string>(
    'https://rss-bridge.org/bridge01/?action=display&bridge=TikTokBridge&context=By+user&username=funnykittenstok&format=Atom'
  );
  const [showUrlHelper, setShowUrlHelper] = useState<boolean>(false);
  const [initialRunPolicy, setInitialRunPolicy] = useState<InitialRunPolicy>('seed_only');
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState<number>(15);

  const [selectedActionType, setSelectedActionType] = useState<SocialActionType>('image');
  const [actionLinkUrl, setActionLinkUrl] = useState<string>('{link}');
  const [actionMediaUrl, setActionMediaUrl] = useState<string>(
    'https://rss-bridge.org/static/release-2026-10-arch.png'
  );
  const [actionCarouselUrls, setActionCarouselUrls] = useState<string>(
    'https://rss-bridge.org/static/slide-1.jpg, https://rss-bridge.org/static/slide-2.jpg'
  );

  const [envVars, setEnvVars] = useState<DashboardEnvVar[]>(INITIAL_DASHBOARD_ENV_VARS);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  const [newVarKey, setNewVarKey] = useState<string>('');
  const [newVarValue, setNewVarValue] = useState<string>('');
  const [statusBanner, setStatusBanner] = useState<string>('');

  const [items, setItems] = useState<NormalizedFeedItem[]>(INITIAL_NORMALIZED_ITEMS);
  const [selectedItemGuid, setSelectedItemGuid] = useState<string>(INITIAL_NORMALIZED_ITEMS[0].guid);
  const [seenLedger, setSeenLedger] = useState<SeenEntry[]>(INITIAL_SEEN_STATE);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);

  const [formatting, setFormatting] = useState<FormattingConfig>({
    template: '{title}\n\n{summary}\n\n{link}\n{tags}',
    mastodonMaxChars: 500,
    threadsMaxChars: 500,
    mastodonCountUrlAs23Chars: true,
    truncationStrategy: 'ellipsis',
    includeMediaAttachment: true,
    defaultHashtags: ['RSSBridge'],
    mastodonVisibility: 'public',
  });

  const [publishTraces, setPublishTraces] = useState<PublishStepTrace[]>([]);

  useEffect(() => {
    try {
      const savedEnv = localStorage.getItem(STORAGE_KEY_ENV);
      if (savedEnv) {
        const parsed = JSON.parse(savedEnv);
        if (Array.isArray(parsed) && parsed.length > 0) setEnvVars(parsed);
      }
      const savedUrl = localStorage.getItem(STORAGE_KEY_TRIGGER_URL);
      if (savedUrl) setTriggerFeedUrl(savedUrl);
    } catch {
      // ignore
    }
  }, []);

  const updateAndSaveEnvVars = (updater: (prev: DashboardEnvVar[]) => DashboardEnvVar[]) => {
    setEnvVars((prev) => {
      const next = updater(prev);
      try {
        localStorage.setItem(STORAGE_KEY_ENV, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    setStatusBanner('Saved credentials in dashboard');
    setTimeout(() => setStatusBanner(''), 2500);
  };

  const selectedItem = useMemo(() => {
    return items.find((i) => i.guid === selectedItemGuid) || items[0];
  }, [items, selectedItemGuid]);

  const mastodonPreview = useMemo(() => {
    if (!selectedItem) return null;
    return renderFormattedPreview(selectedItem, formatting, 'mastodon', envVars);
  }, [selectedItem, formatting, envVars]);

  const threadsPreview = useMemo(() => {
    if (!selectedItem) return null;
    return renderFormattedPreview(selectedItem, formatting, 'threads', envVars);
  }, [selectedItem, formatting, envVars]);

  const currentActionDefinition = useMemo(() => {
    return ACTION_CARDS.find((c) => c.id === selectedActionType) || ACTION_CARDS[0];
  }, [selectedActionType]);

  const handleUpdateTrigger = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem(STORAGE_KEY_TRIGGER_URL, triggerFeedUrl);
    } catch {
      // ignore
    }

    setIsPolling(true);
    const resolvedUrl = resolveEnvVariablesInString(triggerFeedUrl, envVars);
    setStatusBanner(`Updating trigger & polling ${resolvedUrl}...`);

    try {
      const res = await fetch('/api/pipeline/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedId: 'ifttt-active-trigger',
          feedName: 'RSS-Bridge Trigger',
          bridgeUrl: resolvedUrl,
        }),
      });
      const data = await res.json();
      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        const incoming: NormalizedFeedItem[] = data.items;
        setItems((prev) => {
          const existing = new Set(prev.map((i) => i.guid));
          const fresh = incoming.filter((i) => !existing.has(i.guid));
          return [...fresh, ...prev];
        });
        setSelectedItemGuid(incoming[0].guid);
      }
      setStatusBanner('Trigger updated! Choose your action below.');
      setViewMode('choose_action');
    } catch {
      setStatusBanner('Trigger URL saved.');
      setViewMode('choose_action');
    } finally {
      setIsPolling(false);
    }
  };

  const handleRunAppletNow = async () => {
    if (!selectedItem || !mastodonPreview || !threadsPreview) return;
    setIsPublishing(true);

    const platforms: ('mastodon' | 'threads')[] =
      activeServiceTab === 'both'
        ? ['threads', 'mastodon']
        : activeServiceTab === 'mastodon'
          ? ['mastodon']
          : ['threads'];

    const mediaUrls =
      selectedActionType === 'carousel'
        ? actionCarouselUrls.split(',').map((s) => s.trim()).filter(Boolean)
        : selectedItem.enclosures.length > 0
          ? selectedItem.enclosures.map((e) => e.url)
          : [actionMediaUrl];

    try {
      const res = await fetch('/api/pipeline/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemGuid: selectedItem.guid,
          itemTitle: selectedItem.title,
          feedId: selectedItem.feedId,
          platforms,
          actionType: selectedActionType,
          mastodonPosts: mastodonPreview.posts,
          threadsPosts: threadsPreview.posts,
          linkUrl: resolveEnvVariablesInString(
            actionLinkUrl.replace('{link}', selectedItem.link),
            envVars
          ),
          mediaUrls,
          visibility: formatting.mastodonVisibility,
          credentials: {
            mastodonInstanceUrl: getEnvValue(envVars, 'MASTODON_INSTANCE_URL', 'https://mastodon.social'),
            mastodonAccessToken: getEnvValue(envVars, 'MASTODON_ACCESS_TOKEN', ''),
            threadsUserId: getEnvValue(envVars, 'THREADS_USER_ID', ''),
            threadsAccessToken: getEnvValue(envVars, 'THREADS_ACCESS_TOKEN', ''),
          },
        }),
      });
      const data = await res.json();
      if (data.traces && Array.isArray(data.traces)) {
        setPublishTraces(data.traces);
        setSeenLedger((prev) => [
          {
            guid: selectedItem.guid,
            hashId: selectedItem.hashId,
            feedId: selectedItem.feedId,
            title: selectedItem.title,
            status: platforms.length === 2 ? 'published_both' : platforms[0] === 'mastodon' ? 'published_mastodon' : 'published_threads',
            reason: `Published via "${currentActionDefinition.title}" (${data.traces.length} API steps)`,
            processedAt: new Date().toISOString(),
          },
          ...prev.filter((s) => s.guid !== selectedItem.guid),
        ]);
        setStatusBanner(`Published to ${platforms.join(' & ')}!`);
        setViewMode('applet_home');
      } else if (data.error) {
        setStatusBanner(`Error: ${data.error}`);
      }
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#191919]">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-6 lg:px-10 py-4 bg-white border-b border-slate-200">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setViewMode('applet_home');
          }}
          className="text-xl font-extrabold tracking-tight text-[#191919]"
        >
          BridgeRelay
        </a>

        <nav className="hidden md:flex items-center gap-7 text-sm font-semibold text-slate-600">
          <button
            type="button"
            onClick={() => setViewMode('edit_trigger')}
            className={`py-1 border-b-2 ${viewMode === 'edit_trigger' ? 'border-[#EA7600] text-[#EA7600]' : 'border-transparent hover:text-black'}`}
          >
            Edit Trigger (RSS)
          </button>
          <button
            type="button"
            onClick={() => setViewMode('choose_action')}
            className={`py-1 border-b-2 ${viewMode === 'choose_action' ? 'border-black text-black' : 'border-transparent hover:text-black'}`}
          >
            Threads & Mastodon Actions
          </button>
          <button
            type="button"
            onClick={() => setViewMode('edit_action')}
            className={`py-1 border-b-2 ${viewMode === 'edit_action' ? 'border-black text-black' : 'border-transparent hover:text-black'}`}
          >
            Configure Post Ingredients
          </button>
          <button
            type="button"
            onClick={() => setViewMode('applet_home')}
            className={`py-1 border-b-2 ${viewMode === 'applet_home' ? 'border-black text-black' : 'border-transparent hover:text-black'}`}
          >
            Applet
          </button>
          <button
            type="button"
            onClick={() => setViewMode('connections')}
            className={`py-1 border-b-2 ${viewMode === 'connections' ? 'border-black text-black' : 'border-transparent hover:text-black'}`}
          >
            Dashboard Variables ({envVars.length})
          </button>
        </nav>

        <button
          type="button"
          onClick={handleRunAppletNow}
          disabled={isPublishing}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-extrabold text-white bg-[#191919] rounded-full hover:bg-neutral-800 disabled:opacity-60"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{isPublishing ? 'Publishing...' : 'Run Applet Now'}</span>
        </button>
      </header>

      {statusBanner && (
        <div className="bg-emerald-800 text-white text-xs font-semibold text-center py-2 px-4">
          {statusBanner}
        </div>
      )}

      {/* VIEW: TRIGGER */}
      {viewMode === 'edit_trigger' && (
        <div className="flex-1 bg-[#E56B00] text-white flex flex-col items-center justify-center px-6 py-14">
          <div className="w-full max-w-xl mx-auto flex flex-col items-center">
            <div className="w-full flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => setViewMode('applet_home')}
                className="inline-flex items-center gap-1.5 text-sm font-bold text-white/90 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
            </div>

            <h1 className="text-4xl font-extrabold text-center mb-6">Edit trigger</h1>
            <Rss className="w-24 h-24 text-white mb-6" />

            <form onSubmit={handleUpdateTrigger} className="w-full space-y-6">
              <div>
                <label className="block text-base font-extrabold text-white mb-2">Feed URL</label>
                <textarea
                  rows={4}
                  required
                  value={triggerFeedUrl}
                  onChange={(e) => setTriggerFeedUrl(e.target.value)}
                  className="w-full bg-white text-[#191919] rounded-2xl p-4 text-base focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowUrlHelper((v) => !v)}
                  className="mt-2 text-xs font-bold underline"
                >
                  {showUrlHelper ? 'Hide Presets' : 'Choose from Bridge Presets'}
                </button>
              </div>

              {showUrlHelper && (
                <div className="bg-black/20 rounded-2xl p-4 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {QUICK_BRIDGE_EXAMPLES.map((ex) => (
                      <button
                        key={ex.label}
                        type="button"
                        onClick={() => setTriggerFeedUrl(ex.url)}
                        className="px-3 py-1.5 text-xs font-bold bg-white text-black rounded-lg"
                      >
                        {ex.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-center">
                <button
                  type="submit"
                  disabled={isPolling}
                  className="bg-white text-[#191919] font-extrabold text-xl px-12 py-4 rounded-full"
                >
                  {isPolling ? 'Checking Feed...' : 'Update trigger'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW: CHOOSE ACTION */}
      {viewMode === 'choose_action' && (
        <div className="flex-1 flex flex-col bg-white">
          <div className="bg-[#191919] text-white pt-10 pb-12 px-6 flex flex-col items-center">
            <div className="flex items-center gap-2 bg-white/10 p-1 rounded-full mb-8">
              {(['threads', 'mastodon', 'both'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveServiceTab(tab)}
                  className={`px-4 py-1.5 text-xs font-bold rounded-full capitalize ${activeServiceTab === tab ? 'bg-white text-black' : 'text-white/80'}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-3 text-3xl font-extrabold border-4 border-white">
              {activeServiceTab === 'mastodon' ? 'M' : '@'}
            </div>
            <h1 className="text-3xl font-extrabold capitalize">{activeServiceTab} Actions</h1>
          </div>

          <div className="max-w-5xl w-full mx-auto px-6 py-10">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {ACTION_CARDS.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => {
                    setSelectedActionType(card.id);
                    setFormatting((prev) => ({ ...prev, template: card.defaultTemplate }));
                    setViewMode('edit_action');
                  }}
                  className={`bg-[#191919] text-white rounded-2xl p-6 flex flex-col justify-between text-left min-h-[180px] hover:bg-neutral-900 ${selectedActionType === card.id ? 'ring-4 ring-[#EA7600]' : ''}`}
                >
                  <div>
                    <h2 className="text-xl font-extrabold text-white mb-2">{card.title}</h2>
                    <p className="text-xs text-white/80">
                      {activeServiceTab === 'mastodon' ? card.mastodonDescription : card.threadsDescription}
                    </p>
                  </div>
                  <span className="text-[10px] text-white/50 pt-4">Click to configure</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* VIEW: EDIT ACTION */}
      {viewMode === 'edit_action' && (
        <div className="flex-1 bg-[#191919] text-white flex flex-col items-center px-6 py-10">
          <div className="w-full max-w-2xl mx-auto space-y-6">
            <button
              type="button"
              onClick={() => setViewMode('choose_action')}
              className="inline-flex items-center gap-1.5 text-sm font-bold text-white/80"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to actions</span>
            </button>

            <h1 className="text-3xl font-extrabold text-center">{currentActionDefinition.title}</h1>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold mb-2">Post Template</label>
                <textarea
                  rows={4}
                  value={formatting.template}
                  onChange={(e) => setFormatting((prev) => ({ ...prev, template: e.target.value }))}
                  className="w-full bg-white text-black rounded-xl p-3 text-sm focus:outline-none"
                />
                <div className="flex flex-wrap gap-1 mt-2">
                  {['{title}', '{summary}', '{link}', '{author}', '{tags}'].map((tok) => (
                    <button
                      key={tok}
                      type="button"
                      onClick={() => setFormatting((prev) => ({ ...prev, template: `${prev.template} ${tok}` }))}
                      className="px-2 py-1 text-xs font-bold bg-white text-black rounded"
                    >
                      + {tok}
                    </button>
                  ))}
                </div>
              </div>

              {selectedActionType === 'image' && (
                <div>
                  <label className="block text-sm font-bold mb-1">Fallback Image URL</label>
                  <input
                    type="text"
                    value={actionMediaUrl}
                    onChange={(e) => setActionMediaUrl(e.target.value)}
                    className="w-full bg-white text-black rounded-lg p-2.5 text-xs font-mono"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-center gap-4">
              <button
                type="button"
                onClick={() => setViewMode('applet_home')}
                className="bg-white text-black font-extrabold text-lg px-10 py-3 rounded-full"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: APPLET HOME */}
      {viewMode === 'applet_home' && (
        <div className="flex-1 max-w-3xl w-full mx-auto px-6 py-10 space-y-8">
          <h1 className="text-3xl font-extrabold text-center">Your Active Applet</h1>

          <div className="space-y-4">
            <div className="bg-[#E56B00] text-white rounded-2xl p-6 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-white/70">If This</div>
                <div className="text-xl font-extrabold">New feed item (RSS)</div>
                <div className="text-xs font-mono truncate max-w-md mt-1">{triggerFeedUrl}</div>
              </div>
              <button
                type="button"
                onClick={() => setViewMode('edit_trigger')}
                className="px-4 py-2 bg-white text-black text-xs font-bold rounded-full"
              >
                Edit
              </button>
            </div>

            <div className="bg-[#191919] text-white rounded-2xl p-6 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-white/70">Then That</div>
                <div className="text-xl font-extrabold">{currentActionDefinition.title}</div>
              </div>
              <button
                type="button"
                onClick={() => setViewMode('choose_action')}
                className="px-4 py-2 bg-white text-black text-xs font-bold rounded-full"
              >
                Change
              </button>
            </div>
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleRunAppletNow}
              disabled={isPublishing}
              className="bg-[#191919] text-white font-extrabold text-lg px-10 py-4 rounded-full"
            >
              {isPublishing ? 'Publishing...' : 'Run Applet Now'}
            </button>
          </div>

          {publishTraces.length > 0 && (
            <div className="border border-slate-200 rounded-2xl p-4 space-y-2 bg-slate-50">
              <h3 className="text-xs font-extrabold">Last Execution Log ({publishTraces.length} API Calls)</h3>
              {publishTraces.map((t) => (
                <div key={t.step} className="p-2.5 bg-white border border-slate-200 rounded-lg text-xs flex justify-between">
                  <span className="font-mono">{t.platform}: {t.endpoint}</span>
                  <span className="font-bold text-emerald-700">HTTP {t.httpStatus}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW: CONNECTIONS & ENV */}
      {viewMode === 'connections' && (
        <div className="flex-1 max-w-4xl w-full mx-auto px-6 py-10 space-y-6">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-extrabold">Credentials & Variables</h1>
            <button
              type="button"
              onClick={() => setViewMode('applet_home')}
              className="px-4 py-2 bg-black text-white text-xs font-bold rounded-full"
            >
              Done
            </button>
          </div>

          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="p-3">Variable</th>
                  <th className="p-3">Value</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {envVars.map((v) => (
                  <tr key={v.id}>
                    <td className="p-3 font-mono font-bold">{v.key}</td>
                    <td className="p-3">
                      <input
                        type={v.isSecret && !revealedSecrets[v.id] ? 'password' : 'text'}
                        value={v.value}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateAndSaveEnvVars((prev) =>
                            prev.map((item) => (item.id === v.id ? { ...item, value: val } : item))
                          );
                        }}
                        className="w-full p-1.5 border border-slate-300 rounded font-mono text-xs"
                      />
                    </td>
                    <td className="p-3 text-right">
                      {v.isSecret && (
                        <button
                          type="button"
                          onClick={() => setRevealedSecrets((prev) => ({ ...prev, [v.id]: !prev[v.id] }))}
                          className="p-1 text-slate-500"
                        >
                          {revealedSecrets[v.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

# .ai_backups\20261027_023525_lib_db.ts

```ts
// In lib/db.ts:
const DATA_DIR = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'seen_ledger.json');
```

# .ai_backups\20261027_023525_next.config.ts

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;
```

# .ai_backups\20261027_023525_package.json

```json
{
  "name": "ai-studio-applet",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "clean": "next clean"
  },
  "dependencies": {
    "@google/genai": "^2.4.0",
    "@hookform/resolvers": "^5.2.1",
    "autoprefixer": "^10.4.21",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "fast-xml-parser": "^4.5.3",
    "lucide-react": "^0.553.0",
    "motion": "^12.23.24",
    "next": "^15.4.9",
    "postcss": "^8.5.6",
    "react": "^19.2.1",
    "react-dom": "^19.2.1",
    "tailwind-merge": "^3.3.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "4.1.11",
    "@tailwindcss/typography": "^0.5.19",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "9.39.1",
    "eslint-config-next": "16.0.8",
    "firebase-tools": "^15.0.0",
    "tailwindcss": "4.1.11",
    "tw-animate-css": "^1.4.0",
    "typescript": "5.9.3"
  }
}
```

# .ai_backups\20261027_023525_Vercel_Next.js

```js
https://your-domain.vercel.app/api/cron
```

# .ai_backups\20261027_023526_lib_utils.ts

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

# .ai_backups\20261027_023527_app_api_pipeline_poll_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isItemSeen } from '@/lib/db';
import {
  evaluateFilterRules,
  renderFormattedPreview,
  INITIAL_BRIDGE_FEEDS,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${host}`;

  const results = [];

  for (const feed of INITIAL_BRIDGE_FEEDS.filter((f) => f.enabled)) {
    try {
      const pollRes = await fetch(`${baseUrl}/api/pipeline/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedId: feed.id,
          feedName: feed.name,
          bridgeUrl: feed.bridgeUrl.replace(
            '{RSS_BRIDGE_BASE_URL}',
            process.env.RSS_BRIDGE_BASE_URL || 'https://rss-bridge.org/bridge01'
          ),
        }),
      });

      if (!pollRes.ok) continue;
      const { items } = await pollRes.json();

      for (const item of items) {
        if (isItemSeen(item.hashId)) continue;

        const filterCheck = evaluateFilterRules(item, {
          keywordWhitelist: [],
          keywordBlacklist: ['sponsored', 'ad'],
          regexPattern: '',
          regexInvert: false,
          authorWhitelist: [],
          minContentLength: 10,
          maxContentLength: 4000,
          requireMediaAttachment: false,
          stripHtmlPreserveBreaks: true,
          extractInlineImages: true,
        });

        if (!filterCheck.passed) continue;

        const mastoPreview = renderFormattedPreview(
          item,
          {
            template: '{title}\n\n{summary}\n\n{link}\n{tags}',
            mastodonMaxChars: 500,
            threadsMaxChars: 500,
            mastodonCountUrlAs23Chars: true,
            truncationStrategy: 'ellipsis',
            includeMediaAttachment: true,
            defaultHashtags: ['RSSBridge'],
            mastodonVisibility: 'public',
          },
          'mastodon'
        );

        const threadsPreview = renderFormattedPreview(
          item,
          {
            template: '{title}\n\n{summary}\n\n{link}\n{tags}',
            mastodonMaxChars: 500,
            threadsMaxChars: 500,
            mastodonCountUrlAs23Chars: true,
            truncationStrategy: 'ellipsis',
            includeMediaAttachment: true,
            defaultHashtags: ['RSSBridge'],
            mastodonVisibility: 'public',
          },
          'threads'
        );

        const pubRes = await fetch(`${baseUrl}/api/pipeline/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemGuid: item.guid,
            itemTitle: item.title,
            feedId: feed.id,
            platforms: ['mastodon', 'threads'],
            actionType: item.enclosures.length > 0 ? 'image' : 'text',
            mastodonPosts: mastoPreview.posts,
            threadsPosts: threadsPreview.posts,
            mediaUrls: item.enclosures.map((e) => e.url),
          }),
        });

        results.push({ item: item.title, published: pubRes.ok });
        break;
      }
    } catch (e) {
      console.error(`Cron error on feed ${feed.id}:`, e);
    }
  }

  return NextResponse.json({
    status: 'cron_completed',
    processedAt: new Date().toISOString(),
    results,
  });
}
```

# .ai_backups\20261027_023527_lib_utils.ts

```ts
git add .
git commit -m "Fix Vercel 404s, add serverless storage and real publishing"
git push
```

# .ai_backups\20261027_023527_package.json

```json
{
  "name": "bridgerelay",
  "version": "0.2.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint ."
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "fast-xml-parser": "^4.5.3",
    "lucide-react": "^0.553.0",
    "next": "^15.4.9",
    "react": "^19.2.1",
    "react-dom": "^19.2.1",
    "tailwind-merge": "^3.3.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.11",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "autoprefixer": "^10.4.21",
    "eslint": "^9.20.0",
    "eslint-config-next": "^15.4.9",
    "postcss": "^8.5.6",
    "tailwindcss": "^4.1.11",
    "typescript": "^5.9.3"
  }
}
```

# .ai_backups\20261027_023528_app_api_pipeline_poll_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isItemSeen } from '@/lib/db';
import {
  evaluateFilterRules,
  renderFormattedPreview,
  INITIAL_BRIDGE_FEEDS,
  NormalizedFeedItem,
  MediaEnclosure,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${host}`;

  const results = [];

  for (const feed of INITIAL_BRIDGE_FEEDS.filter((f) => f.enabled)) {
    try {
      const pollRes = await fetch(`${baseUrl}/api/pipeline/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedId: feed.id,
          feedName: feed.name,
          bridgeUrl: feed.bridgeUrl.replace(
            '{RSS_BRIDGE_BASE_URL}',
            process.env.RSS_BRIDGE_BASE_URL || 'https://rss-bridge.org/bridge01'
          ),
        }),
      });

      if (!pollRes.ok) continue;
      const data = (await pollRes.json()) as { items?: NormalizedFeedItem[] };
      const items: NormalizedFeedItem[] = data.items || [];

      for (const item of items) {
        if (isItemSeen(item.hashId)) continue;

        const filterCheck = evaluateFilterRules(item, {
          keywordWhitelist: [],
          keywordBlacklist: ['sponsored', 'ad'],
          regexPattern: '',
          regexInvert: false,
          authorWhitelist: [],
          minContentLength: 10,
          maxContentLength: 4000,
          requireMediaAttachment: false,
          stripHtmlPreserveBreaks: true,
          extractInlineImages: true,
        });

        if (!filterCheck.passed) continue;

        const mastoPreview = renderFormattedPreview(
          item,
          {
            template: '{title}\n\n{summary}\n\n{link}\n{tags}',
            mastodonMaxChars: 500,
            threadsMaxChars: 500,
            mastodonCountUrlAs23Chars: true,
            truncationStrategy: 'ellipsis',
            includeMediaAttachment: true,
            defaultHashtags: ['RSSBridge'],
            mastodonVisibility: 'public',
          },
          'mastodon'
        );

        const threadsPreview = renderFormattedPreview(
          item,
          {
            template: '{title}\n\n{summary}\n\n{link}\n{tags}',
            mastodonMaxChars: 500,
            threadsMaxChars: 500,
            mastodonCountUrlAs23Chars: true,
            truncationStrategy: 'ellipsis',
            includeMediaAttachment: true,
            defaultHashtags: ['RSSBridge'],
            mastodonVisibility: 'public',
          },
          'threads'
        );

        const pubRes = await fetch(`${baseUrl}/api/pipeline/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemGuid: item.guid,
            itemTitle: item.title,
            feedId: feed.id,
            platforms: ['mastodon', 'threads'],
            actionType: item.enclosures.length > 0 ? 'image' : 'text',
            mastodonPosts: mastoPreview.posts,
            threadsPosts: threadsPreview.posts,
            mediaUrls: item.enclosures.map((e: MediaEnclosure) => e.url),
          }),
        });

        results.push({ item: item.title, published: pubRes.ok });
        break;
      }
    } catch (e) {
      console.error(`Cron error on feed ${feed.id}:`, e);
    }
  }

  return NextResponse.json({
    status: 'cron_completed',
    processedAt: new Date().toISOString(),
    results,
  });
}
```

# .ai_backups\20261027_023619_package.json

```json
git add postcss.config.mjs package.json
git commit -m "Fix PostCSS config and add autoprefixer"
git push
```

# .ai_backups\20261027_023701_app_api_pipeline_poll_route.ts

```ts
git add app/api/pipeline/poll/route.ts app/api/cron/route.ts
git commit -m "Fix route files and add explicit TypeScript enclosures types"
git push
```

# .ai_backups\20261027_023711_app_api_pipeline_poll_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import {
  cleanHtmlToPlainText,
  computeDeterministicHash,
  extractImagesFromHtml,
  MediaEnclosure,
  NormalizedFeedItem,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  cdataPropName: '__cdata',
});

function getText(node: unknown): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj.__cdata) return String(obj.__cdata);
    if (obj['#text']) return String(obj['#text']);
  }
  return String(node);
}

export function parseXmlFeed(xmlText: string, feedId: string, feedName: string): NormalizedFeedItem[] {
  const items: NormalizedFeedItem[] = [];
  const parsed = xmlParser.parse(xmlText);

  let rawList = parsed?.rss?.channel?.item;
  if (!rawList) {
    rawList = parsed?.feed?.entry;
  }

  if (!rawList) return [];
  const entries: Record<string, any>[] = Array.isArray(rawList) ? rawList : [rawList];

  for (const entry of entries.slice(0, 20)) {
    const rawTitle = getText(entry.title) || 'Untitled Feed Entry';
    const title = cleanHtmlToPlainText(rawTitle, false);

    let link = '';
    if (typeof entry.link === 'string') {
      link = entry.link;
    } else if (entry.link?.['@_href']) {
      link = entry.link['@_href'];
    } else if (Array.isArray(entry.link)) {
      const alt = entry.link.find((l: Record<string, string>) => l['@_rel'] === 'alternate');
      link = alt?.['@_href'] || entry.link[0]?.['@_href'] || getText(entry.link[0]);
    }

    const rawGuid = getText(entry.guid) || getText(entry.id) || link || `${feedId}-${title}`;
    const rawHtml =
      getText(entry['content:encoded']) ||
      getText(entry.content) ||
      getText(entry.description) ||
      getText(entry.summary) ||
      '';

    const author =
      cleanHtmlToPlainText(
        getText(entry.author?.name) || getText(entry.author) || getText(entry['dc:creator']),
        false
      ) || 'bridge-author';

    const pubDate =
      getText(entry.pubDate) ||
      getText(entry.published) ||
      getText(entry.updated) ||
      new Date().toISOString();

    const tags: string[] = [];
    const rawCats = entry.category;
    if (rawCats) {
      const catList = Array.isArray(rawCats) ? rawCats : [rawCats];
      for (const cat of catList) {
        const val = typeof cat === 'string' ? cat : cat['@_term'] || getText(cat);
        if (val && tags.length < 6) tags.push(val);
      }
    }

    const enclosures: MediaEnclosure[] = [];
    const rawEnc = entry.enclosure;
    if (rawEnc) {
      const encList = Array.isArray(rawEnc) ? rawEnc : [rawEnc];
      for (const enc of encList) {
        if (enc?.['@_url']) {
          enclosures.push({
            url: enc['@_url'],
            mimeType: enc['@_type'] || 'image/jpeg',
            source: 'enclosure',
          });
        }
      }
    }

    for (const img of extractImagesFromHtml(rawHtml)) {
      if (!enclosures.some((e: MediaEnclosure) => e.url === img.url)) {
        enclosures.push(img);
      }
    }

    items.push({
      guid: rawGuid,
      hashId: computeDeterministicHash(rawGuid),
      feedId,
      feedName,
      title,
      rawHtml,
      cleanSummary: cleanHtmlToPlainText(rawHtml, true),
      link: link || 'https://rss-bridge.org',
      author,
      publishedAt: Number.isNaN(Date.parse(pubDate))
        ? new Date().toISOString()
        : new Date(pubDate).toISOString(),
      tags: tags.length > 0 ? tags : ['Syndicated'],
      enclosures,
    });
  }

  return items;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { feedId, feedName, bridgeUrl } = body as {
      feedId: string;
      feedName: string;
      bridgeUrl: string;
    };

    if (!bridgeUrl) {
      return NextResponse.json({ error: 'bridgeUrl is required' }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(bridgeUrl, {
      headers: {
        'User-Agent': 'BridgeRelay-Pipeline/2.0 (+https://rss-bridge.org)',
        Accept: 'application/json, application/atom+xml, application/rss+xml, text/xml, */*',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream bridge returned HTTP ${res.status}: ${res.statusText}` },
        { status: 502 }
      );
    }

    const text = await res.text();

    if (text.trim().startsWith('{')) {
      const parsed = JSON.parse(text);
      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
      const normalized: NormalizedFeedItem[] = rawItems.slice(0, 20).map((entry: Record<string, unknown>, idx: number) => {
        const guid = String(entry.id || entry.url || `${feedId}-${idx}`);
        const rawHtml = String(entry.content_html || entry.content_text || entry.summary || '');
        const enclosures: MediaEnclosure[] = [];

        if (Array.isArray(entry.attachments)) {
          for (const att of entry.attachments) {
            if (att && typeof att === 'object' && 'url' in att) {
              enclosures.push({
                url: String((att as { url: string }).url),
                mimeType: String((att as { mime_type?: string }).mime_type || 'image/jpeg'),
                source: 'enclosure',
              });
            }
          }
        }
        for (const img of extractImagesFromHtml(rawHtml)) {
          if (!enclosures.some((e: MediaEnclosure) => e.url === img.url)) enclosures.push(img);
        }

        const authorObj = entry.author as { name?: string } | undefined;
        return {
          guid,
          hashId: computeDeterministicHash(guid),
          feedId,
          feedName,
          title: cleanHtmlToPlainText(String(entry.title || 'Untitled Entry'), false),
          rawHtml,
          cleanSummary: cleanHtmlToPlainText(rawHtml, true),
          link: String(entry.url || bridgeUrl),
          author: authorObj?.name || 'bridge-author',
          publishedAt: String(entry.date_modified || entry.date_published || new Date().toISOString()),
          tags: Array.isArray(entry.tags) ? entry.tags.map(String) : ['RSSBridge'],
          enclosures,
        };
      });

      return NextResponse.json({
        source: 'live_bridge',
        items: normalized,
        polledAt: new Date().toISOString(),
      });
    }

    const xmlItems = parseXmlFeed(text, feedId, feedName);
    return NextResponse.json({
      source: 'live_bridge',
      items: xmlItems,
      polledAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to poll feed' },
      { status: 500 }
    );
  }
}
```

# .eslintrc.json

```json
{
  "extends": "next"
}

```

# .gitignore

```
node_modules/
.next/
coverage/
.DS_Store
*.log
.env*
!.env.example

```

# app\api\pipeline\poll\route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isItemSeen } from '@/lib/db';
import {
  evaluateFilterRules,
  renderFormattedPreview,
  INITIAL_BRIDGE_FEEDS,
  NormalizedFeedItem,
  MediaEnclosure,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${host}`;

  const results = [];

  for (const feed of INITIAL_BRIDGE_FEEDS.filter((f) => f.enabled)) {
    try {
      const pollRes = await fetch(`${baseUrl}/api/pipeline/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedId: feed.id,
          feedName: feed.name,
          bridgeUrl: feed.bridgeUrl.replace(
            '{RSS_BRIDGE_BASE_URL}',
            process.env.RSS_BRIDGE_BASE_URL || 'https://rss-bridge.org/bridge01'
          ),
        }),
      });

      if (!pollRes.ok) continue;
      const data = (await pollRes.json()) as { items?: NormalizedFeedItem[] };
      const items: NormalizedFeedItem[] = data.items || [];

      for (const item of items) {
        if (isItemSeen(item.hashId)) continue;

        const filterCheck = evaluateFilterRules(item, {
          keywordWhitelist: [],
          keywordBlacklist: ['sponsored', 'ad'],
          regexPattern: '',
          regexInvert: false,
          authorWhitelist: [],
          minContentLength: 10,
          maxContentLength: 4000,
          requireMediaAttachment: false,
          stripHtmlPreserveBreaks: true,
          extractInlineImages: true,
        });

        if (!filterCheck.passed) continue;

        const mastoPreview = renderFormattedPreview(
          item,
          {
            template: '{title}\n\n{summary}\n\n{link}\n{tags}',
            mastodonMaxChars: 500,
            threadsMaxChars: 500,
            mastodonCountUrlAs23Chars: true,
            truncationStrategy: 'ellipsis',
            includeMediaAttachment: true,
            defaultHashtags: ['RSSBridge'],
            mastodonVisibility: 'public',
          },
          'mastodon'
        );

        const threadsPreview = renderFormattedPreview(
          item,
          {
            template: '{title}\n\n{summary}\n\n{link}\n{tags}',
            mastodonMaxChars: 500,
            threadsMaxChars: 500,
            mastodonCountUrlAs23Chars: true,
            truncationStrategy: 'ellipsis',
            includeMediaAttachment: true,
            defaultHashtags: ['RSSBridge'],
            mastodonVisibility: 'public',
          },
          'threads'
        );

        const pubRes = await fetch(`${baseUrl}/api/pipeline/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemGuid: item.guid,
            itemTitle: item.title,
            feedId: feed.id,
            platforms: ['mastodon', 'threads'],
            actionType: item.enclosures.length > 0 ? 'image' : 'text',
            mastodonPosts: mastoPreview.posts,
            threadsPosts: threadsPreview.posts,
            mediaUrls: item.enclosures.map((e: MediaEnclosure) => e.url),
          }),
        });

        results.push({ item: item.title, published: pubRes.ok });
        break;
      }
    } catch (e) {
      console.error(`Cron error on feed ${feed.id}:`, e);
    }
  }

  return NextResponse.json({
    status: 'cron_completed',
    processedAt: new Date().toISOString(),
    results,
  });
}
```

# app\api\pipeline\publish\route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { markItemSeen } from '@/lib/db';
import { computeDeterministicHash } from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

export interface PublishStepTrace {
  step: number;
  platform: 'mastodon' | 'threads';
  actionType?: string;
  endpoint: string;
  method: 'POST' | 'GET';
  status: 'success' | 'error';
  httpStatus: number;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  durationMs: number;
}

async function uploadMediaToMastodon(
  mediaUrl: string,
  mastodonInstance: string,
  token: string
): Promise<string> {
  const mediaRes = await fetch(mediaUrl);
  if (!mediaRes.ok) throw new Error(`Failed to download media enclosure: ${mediaUrl}`);
  const blob = await mediaRes.blob();

  const formData = new FormData();
  formData.append('file', blob, 'media.jpg');
  formData.append('description', 'Syndicated via BridgeRelay');

  const uploadRes = await fetch(`${mastodonInstance}/api/v2/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Mastodon media upload failed (HTTP ${uploadRes.status}): ${errText}`);
  }

  const uploadData = await uploadRes.json();
  return uploadData.id;
}

async function pollThreadsContainerReady(
  containerId: string,
  threadsToken: string,
  maxAttempts = 6
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusRes = await fetch(
      `https://graph.threads.net/v1.0/${containerId}?fields=status,error_message&access_token=${threadsToken}`
    );
    if (statusRes.ok) {
      const data = await statusRes.json();
      if (data.status === 'FINISHED') return;
      if (data.status === 'ERROR') {
        throw new Error(`Threads container error: ${data.error_message || 'Container failed'}`);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      itemGuid,
      itemTitle = 'Feed Item',
      feedId = 'feed-default',
      platforms,
      actionType = 'text',
      mastodonPosts,
      threadsPosts,
      linkUrl = '',
      mediaUrls = [],
      visibility = 'public',
      credentials,
    } = body as {
      itemGuid?: string;
      itemTitle?: string;
      feedId?: string;
      platforms: ('mastodon' | 'threads')[];
      actionType?: 'text' | 'link' | 'image' | 'video' | 'carousel';
      mastodonPosts: string[];
      threadsPosts: string[];
      linkUrl?: string;
      mediaUrls?: string[];
      visibility?: 'public' | 'unlisted' | 'private';
      credentials?: {
        mastodonInstanceUrl?: string;
        mastodonAccessToken?: string;
        threadsUserId?: string;
        threadsAccessToken?: string;
      };
    };

    const traces: PublishStepTrace[] = [];
    let stepCounter = 1;

    const mastodonInstance = (
      credentials?.mastodonInstanceUrl ||
      process.env.MASTODON_INSTANCE_URL ||
      'https://mastodon.social'
    ).replace(/\/$/, '');
    const mastodonToken = (
      credentials?.mastodonAccessToken ||
      process.env.MASTODON_ACCESS_TOKEN ||
      ''
    ).trim();

    const threadsUserId = (
      credentials?.threadsUserId ||
      process.env.THREADS_USER_ID ||
      ''
    ).trim();
    const threadsToken = (
      credentials?.threadsAccessToken ||
      process.env.THREADS_ACCESS_TOKEN ||
      ''
    ).trim();

    let publishedMastodonId: string | undefined;
    let publishedThreadsId: string | undefined;

    // 1. Mastodon
    if (platforms.includes('mastodon') && mastodonPosts?.length > 0) {
      if (!mastodonToken) throw new Error('Mastodon access token is missing');

      const uploadedMediaIds: string[] = [];
      if (
        (actionType === 'image' || actionType === 'video' || actionType === 'carousel') &&
        mediaUrls.length > 0
      ) {
        const mediaToUpload = actionType === 'carousel' ? mediaUrls.slice(0, 4) : [mediaUrls[0]];
        for (const url of mediaToUpload) {
          const t0 = Date.now();
          const mediaId = await uploadMediaToMastodon(url, mastodonInstance, mastodonToken);
          uploadedMediaIds.push(mediaId);
          traces.push({
            step: stepCounter++,
            platform: 'mastodon',
            actionType,
            endpoint: `${mastodonInstance}/api/v2/media`,
            method: 'POST',
            status: 'success',
            httpStatus: 200,
            requestPayload: { file_url: url },
            responsePayload: { id: mediaId },
            durationMs: Date.now() - t0,
          });
        }
      }

      let inReplyToId: string | undefined;
      for (let i = 0; i < mastodonPosts.length; i++) {
        const postText = mastodonPosts[i];
        const statusEndpoint = `${mastodonInstance}/api/v1/statuses`;
        const reqPayload: Record<string, unknown> = {
          status: postText,
          visibility,
          ...(i === 0 && uploadedMediaIds.length > 0 ? { media_ids: uploadedMediaIds } : {}),
          ...(inReplyToId ? { in_reply_to_id: inReplyToId } : {}),
        };

        const t0 = Date.now();
        const res = await fetch(statusEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${mastodonToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(reqPayload),
        });
        const resData = await res.json();

        if (!res.ok) {
          throw new Error(`Mastodon status error (HTTP ${res.status}): ${JSON.stringify(resData)}`);
        }

        inReplyToId = String(resData.id);
        if (i === 0) publishedMastodonId = inReplyToId;

        traces.push({
          step: stepCounter++,
          platform: 'mastodon',
          actionType,
          endpoint: statusEndpoint,
          method: 'POST',
          status: 'success',
          httpStatus: res.status,
          requestPayload: reqPayload,
          responsePayload: resData,
          durationMs: Date.now() - t0,
        });
      }
    }

    // 2. Meta Threads
    if (platforms.includes('threads') && threadsPosts?.length > 0) {
      if (!threadsUserId || !threadsToken) {
        throw new Error('Meta Threads User ID or Access Token is missing');
      }

      const containerEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads`;
      const publishEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`;
      const postText = threadsPosts[0];

      let containerIdToPublish = '';

      if (actionType === 'carousel' && mediaUrls.length >= 2) {
        const childContainerIds: string[] = [];
        for (const mUrl of mediaUrls.slice(0, 5)) {
          const t0 = Date.now();
          const isVideo = mUrl.endsWith('.mp4');
          const childParams = new URLSearchParams({
            is_carousel_item: 'true',
            media_type: isVideo ? 'VIDEO' : 'IMAGE',
            [isVideo ? 'video_url' : 'image_url']: mUrl,
            access_token: threadsToken,
          });

          const childRes = await fetch(`${containerEndpoint}?${childParams.toString()}`, { method: 'POST' });
          const childData = await childRes.json();
          if (!childRes.ok) throw new Error(`Threads carousel child failed: ${JSON.stringify(childData)}`);
          childContainerIds.push(childData.id);

          traces.push({
            step: stepCounter++,
            platform: 'threads',
            actionType: 'carousel_item',
            endpoint: containerEndpoint,
            method: 'POST',
            status: 'success',
            httpStatus: childRes.status,
            requestPayload: { media_url: mUrl },
            responsePayload: childData,
            durationMs: Date.now() - t0,
          });
        }

        const parentParams = new URLSearchParams({
          media_type: 'CAROUSEL',
          children: childContainerIds.join(','),
          text: postText,
          access_token: threadsToken,
        });
        const parentRes = await fetch(`${containerEndpoint}?${parentParams.toString()}`, { method: 'POST' });
        const parentData = await parentRes.json();
        if (!parentRes.ok) throw new Error(`Threads parent carousel failed: ${JSON.stringify(parentData)}`);
        containerIdToPublish = parentData.id;
      } else {
        const isImage = actionType === 'image' && mediaUrls.length > 0;
        const isVideo = actionType === 'video' && mediaUrls.length > 0;
        const mediaType = isImage ? 'IMAGE' : isVideo ? 'VIDEO' : 'TEXT';

        const params = new URLSearchParams({
          media_type: mediaType,
          text: postText,
          access_token: threadsToken,
          ...(actionType === 'link' && linkUrl ? { link_attachment: linkUrl } : {}),
          ...(isImage ? { image_url: mediaUrls[0] } : {}),
          ...(isVideo ? { video_url: mediaUrls[0] } : {}),
        });

        const t0 = Date.now();
        const createRes = await fetch(`${containerEndpoint}?${params.toString()}`, { method: 'POST' });
        const createData = await createRes.json();
        if (!createRes.ok) throw new Error(`Threads container creation failed: ${JSON.stringify(createData)}`);
        containerIdToPublish = createData.id;

        traces.push({
          step: stepCounter++,
          platform: 'threads',
          actionType,
          endpoint: containerEndpoint,
          method: 'POST',
          status: 'success',
          httpStatus: createRes.status,
          requestPayload: { mediaType, textLength: postText.length },
          responsePayload: createData,
          durationMs: Date.now() - t0,
        });
      }

      await pollThreadsContainerReady(containerIdToPublish, threadsToken);

      const tPublish = Date.now();
      const pubParams = new URLSearchParams({
        creation_id: containerIdToPublish,
        access_token: threadsToken,
      });
      const pubRes = await fetch(`${publishEndpoint}?${pubParams.toString()}`, { method: 'POST' });
      const pubData = await pubRes.json();
      if (!pubRes.ok) throw new Error(`Threads publish failed: ${JSON.stringify(pubData)}`);
      publishedThreadsId = pubData.id;

      traces.push({
        step: stepCounter++,
        platform: 'threads',
        actionType,
        endpoint: publishEndpoint,
        method: 'POST',
        status: 'success',
        httpStatus: pubRes.status,
        requestPayload: { creation_id: containerIdToPublish },
        responsePayload: pubData,
        durationMs: Date.now() - tPublish,
      });
    }

    // Persist to server deduplication store
    if (itemGuid) {
      markItemSeen({
        guidHash: computeDeterministicHash(itemGuid),
        guid: itemGuid,
        feedId,
        title: itemTitle,
        status: 'published',
        publishedAt: new Date().toISOString(),
        mastodonStatusId: publishedMastodonId,
        threadsPostId: publishedThreadsId,
      });
    }

    return NextResponse.json({
      success: true,
      executedAt: new Date().toISOString(),
      traces,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Publish execution failed' },
      { status: 500 }
    );
  }
}
```

# app\api\pipeline\verify\route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { platform, mastodonInstanceUrl, mastodonAccessToken, threadsUserId, threadsAccessToken } = body;

    if (platform === 'mastodon') {
      const instance = (mastodonInstanceUrl || process.env.MASTODON_INSTANCE_URL || 'https://mastodon.social').replace(/\/$/, '');
      const token = (mastodonAccessToken || process.env.MASTODON_ACCESS_TOKEN || '').trim();

      if (!token) {
        return NextResponse.json({ verified: false, message: 'Missing Mastodon token' }, { status: 400 });
      }

      const res = await fetch(`${instance}/api/v1/accounts/verify_credentials`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const account = await res.json();
        return NextResponse.json({
          verified: true,
          handle: `@${account.username}@${new URL(instance).hostname}`,
          displayName: account.display_name || account.username,
        });
      }
      return NextResponse.json({ verified: false, message: 'Invalid Mastodon credentials' }, { status: 401 });
    }

    if (platform === 'threads') {
      const userId = (threadsUserId || process.env.THREADS_USER_ID || '').trim();
      const token = (threadsAccessToken || process.env.THREADS_ACCESS_TOKEN || '').trim();

      if (!userId || !token) {
        return NextResponse.json({ verified: false, message: 'Missing Threads User ID or Token' }, { status: 400 });
      }

      const res = await fetch(`https://graph.threads.net/v1.0/${userId}?fields=id,username&access_token=${token}`);
      if (res.ok) {
        const profile = await res.json();
        return NextResponse.json({
          verified: true,
          handle: `@${profile.username || userId}`,
        });
      }
      return NextResponse.json({ verified: false, message: 'Invalid Threads credentials' }, { status: 401 });
    }

    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Verification failed' }, { status: 500 });
  }
}
```

# app\globals.css

```css
@import "tailwindcss";

```

# app\layout.tsx

```tsx
import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Public_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
});

const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'BridgeRelay — RSS-Bridge to Mastodon & Threads Pipeline',
  description:
    'End-to-end syndication pipeline for ingesting RSS-Bridge feeds, deduplicating state, applying regex and template formatting rules, and publishing to Mastodon and Meta Threads.',
  openGraph: {
    title: 'BridgeRelay — RSS-Bridge to Mastodon & Threads Pipeline',
    description:
      'End-to-end syndication pipeline for ingesting RSS-Bridge feeds, deduplicating state, applying regex and template formatting rules, and publishing to Mastodon and Meta Threads.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BridgeRelay — RSS-Bridge to Mastodon & Threads Pipeline',
    description:
      'End-to-end syndication pipeline for ingesting RSS-Bridge feeds, deduplicating state, applying regex and template formatting rules, and publishing to Mastodon and Meta Threads.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${publicSans.variable} ${jetbrainsMono.variable}`}
    >
      <body
        suppressHydrationWarning
        className="min-h-screen bg-[#F8FAFC] text-[#0F172A] antialiased selection:bg-[#0F172A] selection:text-white"
        style={{ fontFamily: 'var(--font-sans), sans-serif' }}
      >
        {children}
      </body>
    </html>
  );
}

```

# app\page.tsx

```tsx
import BridgeRelayStudio from '@/components/BridgeRelayStudio';

export default function HomePage() {
  return <BridgeRelayStudio />;
}

```

# bridge.py

```py
import os, sys, json, shutil, subprocess
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8999
PROJECT_DIR = os.path.abspath(os.getcwd())
PROJECT_NAME = os.path.basename(PROJECT_DIR)
BACKUP_DIR = os.path.join(PROJECT_DIR, ".ai_backups")
EXCLUDE_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".cache", ".ai_backups"}

def open_in_vscode(abs_path, line=1):
    try:
        subprocess.Popen(["code", "-g", f"{abs_path}:{line}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except FileNotFoundError:
        pass
    try:
        subprocess.Popen(["cmd", "/c", "start", f"vscode://file/{abs_path}:{line}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception:
        return False

def find_file(filename):
    clean_path = filename.strip().replace("\\", "/").lstrip("/")
    direct = os.path.join(PROJECT_DIR, clean_path.replace("/", os.sep))
    if os.path.exists(direct):
        return clean_path, direct

    norm_target = clean_path.lower()
    for root, dirs, files in os.walk(PROJECT_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            abs_p = os.path.join(root, f)
            rel_p = os.path.relpath(abs_p, PROJECT_DIR).replace(os.sep, "/")
            if rel_p.lower() == norm_target or rel_p.lower().endswith("/" + norm_target):
                return rel_p, abs_p

    base_target = os.path.basename(clean_path).lower()
    for root, dirs, files in os.walk(PROJECT_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            if f.lower() == base_target:
                abs_p = os.path.join(root, f)
                return os.path.relpath(abs_p, PROJECT_DIR).replace(os.sep, "/"), abs_p

    return None, None

def backup_file(abs_path):
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        rel = os.path.relpath(abs_path, PROJECT_DIR).replace(os.sep, "_")
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest = os.path.join(BACKUP_DIR, f"{ts}_{rel}")
        shutil.copy2(abs_path, dest)
    except Exception:
        pass

def replace_snippet_in_content(full_content, find_snip, new_snip):
    if find_snip in full_content:
        count = full_content.count(find_snip)
        pos = full_content.find(find_snip)
        line_no = full_content[:pos].count("\n") + 1
        updated = full_content.replace(find_snip, new_snip)
        return updated, line_no, count

    norm_full = full_content.replace("\r\n", "\n")
    norm_find = find_snip.replace("\r\n", "\n").strip()
    norm_new = new_snip.replace("\r\n", "\n")

    if norm_find in norm_full:
        count = norm_full.count(norm_find)
        pos = norm_full.find(norm_find)
        line_no = norm_full[:pos].count("\n") + 1
        updated = norm_full.replace(norm_find, norm_new)
        return updated, line_no, count

    find_lines = [l.strip() for l in norm_find.splitlines() if l.strip()]
    if find_lines:
        file_lines = norm_full.splitlines(keepends=True)
        first_line = find_lines[0]
        for idx, line in enumerate(file_lines):
            if first_line in line:
                match = True
                for j, f_line in enumerate(find_lines):
                    if idx + j >= len(file_lines) or f_line not in file_lines[idx + j]:
                        match = False
                        break
                if match:
                    line_no = idx + 1
                    prefix = "".join(file_lines[:idx])
                    suffix = "".join(file_lines[idx + len(find_lines):])
                    if not norm_new.endswith("\n"): norm_new += "\n"
                    return prefix + norm_new + suffix, line_no, 1

    return None, None, 0

def generate_digest():
    tree_lines = []
    file_count = 0
    for root, dirs, files in os.walk(PROJECT_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
        level = root.replace(PROJECT_DIR, "").count(os.sep)
        indent = "  " * level
        folder = os.path.basename(root)
        if level > 0:
            tree_lines.append(f"{indent}📁 {folder}/")
        for f in sorted(files):
            if not f.startswith("."):
                tree_lines.append(f"{indent}  📄 {f}")
                file_count += 1
                if file_count >= 120: break
        if file_count >= 120:
            tree_lines.append("  ... (truncated)")
            break
    return "\n".join(tree_lines), file_count

def get_project_files():
    file_list = []
    for root, dirs, files in os.walk(PROJECT_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
        for f in sorted(files):
            if not f.startswith("."):
                abs_p = os.path.join(root, f)
                rel_p = os.path.relpath(abs_p, PROJECT_DIR).replace(os.sep, "/")
                file_list.append(rel_p)
                if len(file_list) >= 300: break
        if len(file_list) >= 300: break
    return file_list

class BridgeServer(ThreadingHTTPServer):
    allow_reuse_address = True

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")

    def _json(self, status, payload):
        b = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path_only = self.path.split("?")[0]
        if path_only == "/status":
            self._json(200, {"bridge": "ai-bridge", "status": "ok", "project": PROJECT_NAME, "root": PROJECT_DIR})
        elif path_only == "/digest":
            tree, count = generate_digest()
            self._json(200, {"bridge": "ai-bridge", "project": PROJECT_NAME, "tree": tree, "file_count": count})
        elif path_only == "/files":
            files = get_project_files()
            self._json(200, {"bridge": "ai-bridge", "project": PROJECT_NAME, "files": files, "count": len(files)})
        elif path_only == "/get_bridge_source":
            try:
                with open(__file__, "r", encoding="utf-8") as f:
                    src = f.read().encode("utf-8")
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "text/x-python; charset=utf-8")
                self.send_header("Content-Length", str(len(src)))
                self.end_headers()
                self.wfile.write(src)
            except Exception:
                self._json(500, {"error": "Could not read source"})
        else:
            self._json(404, {"error": "Not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        path_only = self.path.split("?")[0]

        if path_only == "/find":
            rel, abs_p = find_file(body.get("filename", ""))
            if not rel: return self._json(200, {"bridge": "ai-bridge", "found": False})
            open_in_vscode(abs_p, 1)
            self._json(200, {"bridge": "ai-bridge", "found": True, "path": rel})

        elif path_only in ("/replace", "/create"):
            raw_path = body.get("path", "").strip()
            content = body.get("content", "")
            find_snip = body.get("find_snippet", None)

            rel, abs_p = find_file(raw_path)
            if not abs_p:
                abs_p = os.path.join(PROJECT_DIR, raw_path.lstrip("/\\"))
                rel = os.path.relpath(abs_p, PROJECT_DIR).replace(os.sep, "/")

            os.makedirs(os.path.dirname(abs_p) or PROJECT_DIR, exist_ok=True)

            if find_snip and os.path.exists(abs_p):
                backup_file(abs_p)
                with open(abs_p, "r", encoding="utf-8", errors="ignore") as f:
                    orig = f.read()
                updated, line_no, count = replace_snippet_in_content(orig, find_snip, content)
                if updated is not None:
                    with open(abs_p, "w", encoding="utf-8") as f:
                        f.write(updated)
                    open_in_vscode(abs_p, line_no)
                    return self._json(200, {"bridge": "ai-bridge", "success": True, "path": rel, "replaced_snippet": True, "count": count, "line": line_no})
                else:
                    return self._json(200, {"bridge": "ai-bridge", "success": False, "error": "Snippet not found in target file."})

            if os.path.exists(abs_p):
                with open(abs_p, "r", encoding="utf-8", errors="ignore") as f:
                    orig = f.read()
                orig_lines = len(orig.splitlines())
                new_lines = len(content.splitlines())
                is_full = any(content.strip().startswith(kw) for kw in ["import ", "export ", "<!DOCTYPE", "<?php", "package "])
                if orig_lines > 20 and new_lines <= 5 and not is_full:
                    return self._json(200, {
                        "bridge": "ai-bridge",
                        "success": False,
                        "error": f"Safety Guard: File has {orig_lines} lines. Refusing to overwrite full file with a {new_lines}-line snippet."
                    })

            backup_file(abs_p)
            with open(abs_p, "w", encoding="utf-8") as f:
                f.write(content)
            open_in_vscode(abs_p, 1)
            self._json(200, {"bridge": "ai-bridge", "success": True, "path": rel, "replaced_snippet": False})

        elif path_only == "/batch_replace":
            files = body.get("files", [])
            updated = []
            for item in files:
                p, c = item.get("path", "").strip(), item.get("content", "")
                if not p or not c: continue
                rel, abs_p = find_file(p)
                if not abs_p:
                    abs_p = os.path.join(PROJECT_DIR, p.lstrip("/\\"))
                    rel = os.path.relpath(abs_p, PROJECT_DIR).replace(os.sep, "/")
                os.makedirs(os.path.dirname(abs_p) or PROJECT_DIR, exist_ok=True)
                backup_file(abs_p)
                with open(abs_p, "w", encoding="utf-8") as f:
                    f.write(c)
                updated.append(rel)
                open_in_vscode(abs_p, 1)
            self._json(200, {"bridge": "ai-bridge", "success": True, "updated": len(updated), "files": updated})

        elif path_only == "/terminal":
            cmd = body.get("command", "").strip()
            try:
                subprocess.Popen(["code", PROJECT_DIR], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception:
                pass
            self._json(200, {"bridge": "ai-bridge", "success": True, "command": cmd})

def main():
    server = BridgeServer(("127.0.0.1", PORT), Handler)
    print(f"\n==========================================")
    print(f" [OK] AI Bridge Connected: {PROJECT_NAME}")
    print(f" [OK] Port: http://127.0.0.1:{PORT}")
    print(f"==========================================\n")
    server.serve_forever()

if __name__ == "__main__":
    main()

```

# components\BridgeRelayStudio.tsx

```tsx
app/
  api/
    cron/
      route.ts
    pipeline/
      poll/
        route.ts
      publish/
        route.ts
      verify/
        route.ts
  page.tsx
  layout.tsx
  globals.css
lib/
  db.ts
  pipeline-engine.ts
  utils.ts
```

# eslint.config.mjs

```mjs
import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([{
    extends: [...next],
}]);

```

# hooks\use-mobile.ts

```ts
import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

```

# lib\config-generator.ts

```ts
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

```

# lib\db.ts

```ts
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
```

# lib\pipeline-engine.ts

```ts
export type BridgeFormat = 'Json' | 'Atom' | 'Mrss';

export type InitialRunPolicy = 'seed_only' | 'publish_latest_one' | 'publish_all';

export type TruncationStrategy = 'ellipsis' | 'thread_split' | 'title_and_link_only';

export interface DashboardEnvVar {
  id: string;
  key: string;
  value: string;
  description: string;
  isSecret: boolean;
  category: 'rss_bridge' | 'mastodon' | 'threads' | 'template';
}

export interface IftttApplet {
  id: string;
  name: string;
  enabled: boolean;
  trigger: {
    bridgePreset: string;
    bridgeUrl: string;
    format: BridgeFormat;
    pollIntervalMinutes: number;
    initialRunPolicy: InitialRunPolicy;
  };
  filter: FilterRulesConfig;
  action: {
    destinations: ('mastodon' | 'threads')[];
    formatting: FormattingConfig;
  };
  stats: {
    runsCount: number;
    publishedCount: number;
    lastRunAt: string | null;
  };
}

export interface MediaEnclosure {
  url: string;
  mimeType: string;
  source: 'enclosure' | 'html_img';
  altText?: string;
}

export interface NormalizedFeedItem {
  guid: string;
  hashId: string;
  feedId: string;
  feedName: string;
  title: string;
  rawHtml: string;
  cleanSummary: string;
  link: string;
  author: string;
  publishedAt: string;
  tags: string[];
  enclosures: MediaEnclosure[];
}

export interface BridgeFeedSource {
  id: string;
  name: string;
  bridgeUrl: string;
  bridgeName: string;
  format: BridgeFormat;
  pollIntervalMinutes: number;
  initialRunPolicy: InitialRunPolicy;
  enabled: boolean;
  lastPolledAt: string | null;
  hasCompletedInitialRun: boolean;
}

export interface FilterRulesConfig {
  keywordWhitelist: string[];
  keywordBlacklist: string[];
  regexPattern: string;
  regexInvert: boolean;
  authorWhitelist: string[];
  minContentLength: number;
  maxContentLength: number;
  requireMediaAttachment: boolean;
  stripHtmlPreserveBreaks: boolean;
  extractInlineImages: boolean;
}

export interface FormattingConfig {
  template: string;
  mastodonMaxChars: number;
  threadsMaxChars: number;
  mastodonCountUrlAs23Chars: boolean;
  truncationStrategy: TruncationStrategy;
  includeMediaAttachment: boolean;
  defaultHashtags: string[];
  mastodonVisibility: 'public' | 'unlisted' | 'private';
}

export interface SeenEntryRecord {
  guid: string;
  hashId: string;
  feedId: string;
  title: string;
  status:
    | 'published_both'
    | 'published_mastodon'
    | 'published_threads'
    | 'seeded_initial'
    | 'filtered_out'
    | 'queued';
  reason?: string;
  processedAt: string;
  mastodonStatusId?: string;
  threadsContainerId?: string;
  threadsMediaId?: string;
}

export type SeenEntry = SeenEntryRecord;

export interface FilterEvaluationResult {
  passed: boolean;
  reasons: string[];
  matchedWhitelist: string[];
  triggeredBlacklist: string[];
  regexMatched: boolean;
}

export interface FormattedPayloadPreview {
  platform: 'mastodon' | 'threads';
  posts: string[];
  effectiveCharCounts: number[];
  maxAllowedChars: number;
  wasTruncated: boolean;
  isThreaded: boolean;
  mediaAttachments: MediaEnclosure[];
}

export const INITIAL_DASHBOARD_ENV_VARS: DashboardEnvVar[] = [
  {
    id: 'env-1',
    key: 'RSS_BRIDGE_BASE_URL',
    value: 'https://rss-bridge.org/bridge01',
    description: 'Base URL of your RSS-Bridge instance used in IFTTT Trigger URLs',
    isSecret: false,
    category: 'rss_bridge',
  },
  {
    id: 'env-2',
    key: 'MASTODON_INSTANCE_URL',
    value: 'https://mastodon.social',
    description: 'Target Mastodon server URL for status & media uploads',
    isSecret: false,
    category: 'mastodon',
  },
  {
    id: 'env-3',
    key: 'MASTODON_ACCESS_TOKEN',
    value: 'masto_live_tok_98f21a4c7e3b109d',
    description: 'Bearer token with write:statuses and write:media scopes',
    isSecret: true,
    category: 'mastodon',
  },
  {
    id: 'env-4',
    key: 'THREADS_USER_ID',
    value: '17841405829304918',
    description: 'Meta Threads Graph API User ID for /{user-id}/threads container endpoint',
    isSecret: false,
    category: 'threads',
  },
  {
    id: 'env-5',
    key: 'THREADS_ACCESS_TOKEN',
    value: 'THQVJ_long_lived_60d_token_849201a',
    description: '60-day long-lived Meta Threads OAuth access token',
    isSecret: true,
    category: 'threads',
  },
  {
    id: 'env-6',
    key: 'BRAND_SIGNATURE',
    value: 'via BridgeRelay Automation',
    description: 'Custom signature variable usable as {BRAND_SIGNATURE} in post templates',
    isSecret: false,
    category: 'template',
  },
  {
    id: 'env-7',
    key: 'UTM_SUFFIX',
    value: '?utm_source=syndication&utm_medium=social',
    description: 'Tracking suffix variable usable as {UTM_SUFFIX} in post templates',
    isSecret: false,
    category: 'template',
  },
];

export function resolveEnvVariablesInString(
  input: string,
  envVars: DashboardEnvVar[]
): string {
  if (!input) return '';
  let output = input;
  for (const env of envVars) {
    if (!env.key) continue;
    const doubleBrace = new RegExp(`\\{\\{${env.key}\\}\\}`, 'g');
    const singleBrace = new RegExp(`\\{${env.key}\\}`, 'g');
    const dollarBrace = new RegExp(`\\$\\{${env.key}\\}`, 'g');
    output = output
      .replace(doubleBrace, env.value)
      .replace(singleBrace, env.value)
      .replace(dollarBrace, env.value);
  }
  return output;
}

export function getEnvValue(
  envVars: DashboardEnvVar[],
  key: string,
  fallback = ''
): string {
  const found = envVars.find((e) => e.key === key);
  return found ? found.value : fallback;
}

export function computeDeterministicHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0, ch; i < input.length; i++) {
    ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(12, '0');
  return `sha_${hex.slice(0, 12)}`;
}

export function cleanHtmlToPlainText(html: string, preserveBreaks = true): string {
  if (!html) return '';
  let text = html;

  if (preserveBreaks) {
    text = text
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*p\s*>/gi, '\n\n')
      .replace(/<\/\s*div\s*>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '• ')
      .replace(/<\/\s*li\s*>/gi, '\n');
  }

  text = text.replace(/<[^>]+>/g, '');

  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
  };

  text = text.replace(/&[a-zA-Z0-9#]+;/g, (match) => entities[match] ?? match);

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractImagesFromHtml(html: string): MediaEnclosure[] {
  if (!html) return [];
  const results: MediaEnclosure[] = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    if (!url || url.startsWith('data:')) continue;
    const altMatch = match[0].match(/alt=["']([^"']*)["']/i);
    results.push({
      url,
      mimeType: url.endsWith('.png')
        ? 'image/png'
        : url.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg',
      source: 'html_img',
      altText: altMatch?.[1] || undefined,
    });
  }
  return results;
}

export function evaluateFilterRules(
  item: NormalizedFeedItem,
  rules: FilterRulesConfig
): FilterEvaluationResult {
  const reasons: string[] = [];
  const matchedWhitelist: string[] = [];
  const triggeredBlacklist: string[] = [];

  const searchableCorpus = `${item.title}\n${item.cleanSummary}\n${item.tags.join(' ')}`.toLowerCase();

  if (rules.keywordWhitelist.length > 0) {
    for (const kw of rules.keywordWhitelist) {
      const normalized = kw.trim().toLowerCase();
      if (normalized && searchableCorpus.includes(normalized)) {
        matchedWhitelist.push(kw.trim());
      }
    }
    if (matchedWhitelist.length === 0) {
      reasons.push(
        `Did not match any required whitelist keyword (${rules.keywordWhitelist.join(', ')})`
      );
    }
  }

  if (rules.keywordBlacklist.length > 0) {
    for (const kw of rules.keywordBlacklist) {
      const normalized = kw.trim().toLowerCase();
      if (normalized && searchableCorpus.includes(normalized)) {
        triggeredBlacklist.push(kw.trim());
      }
    }
    if (triggeredBlacklist.length > 0) {
      reasons.push(`Triggered blacklist keyword: ${triggeredBlacklist.join(', ')}`);
    }
  }

  let regexMatched = true;
  if (rules.regexPattern.trim().length > 0) {
    try {
      const regex = new RegExp(rules.regexPattern.trim(), 'i');
      const rawTest = regex.test(`${item.title}\n${item.cleanSummary}`);
      regexMatched = rules.regexInvert ? !rawTest : rawTest;
      if (!regexMatched) {
        reasons.push(
          rules.regexInvert
            ? `Excluded because content matched inverted regex /${rules.regexPattern}/i`
            : `Did not match required regex /${rules.regexPattern}/i`
        );
      }
    } catch {
      reasons.push(`Invalid regular expression syntax: ${rules.regexPattern}`);
      regexMatched = false;
    }
  }

  if (rules.authorWhitelist.length > 0) {
    const normalizedAuthor = item.author.toLowerCase();
    const authorAllowed = rules.authorWhitelist.some(
      (a) => a.trim() && normalizedAuthor.includes(a.trim().toLowerCase())
    );
    if (!authorAllowed) {
      reasons.push(`Author "${item.author}" is not in author whitelist`);
    }
  }

  const contentLen = item.cleanSummary.length + item.title.length;
  if (rules.minContentLength > 0 && contentLen < rules.minContentLength) {
    reasons.push(
      `Content length (${contentLen} chars) is below minimum (${rules.minContentLength} chars)`
    );
  }
  if (rules.maxContentLength > 0 && contentLen > rules.maxContentLength) {
    reasons.push(
      `Content length (${contentLen} chars) exceeds maximum (${rules.maxContentLength} chars)`
    );
  }

  if (rules.requireMediaAttachment && item.enclosures.length === 0) {
    reasons.push('Entry does not contain a required media enclosure or inline image');
  }

  return {
    passed: reasons.length === 0,
    reasons,
    matchedWhitelist,
    triggeredBlacklist,
    regexMatched,
  };
}

export function formatHashtags(tags: string[], extraTags: string[]): string {
  const combined = Array.from(new Set([...tags, ...extraTags]))
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)
    .map((t) => {
      const cleaned = t.replace(/[^a-zA-Z0-9\s_-]/g, '');
      if (cleaned.includes(' ') || cleaned.includes('-')) {
        return (
          '#' +
          cleaned
            .split(/[\s-]+/)
            .filter(Boolean)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join('')
        );
      }
      return `#${cleaned}`;
    });

  return combined.join(' ');
}

export function computeEffectiveLength(
  text: string,
  platform: 'mastodon' | 'threads',
  countUrlAs23: boolean
): number {
  if (platform === 'mastodon' && countUrlAs23) {
    const urlRegex = /https?:\/\/[^\s]+/g;
    const replaced = text.replace(urlRegex, 'x'.repeat(23));
    return replaced.length;
  }
  return text.length;
}

export function renderFormattedPreview(
  item: NormalizedFeedItem,
  formatting: FormattingConfig,
  platform: 'mastodon' | 'threads',
  envVars: DashboardEnvVar[] = []
): FormattedPayloadPreview {
  const maxChars =
    platform === 'mastodon' ? formatting.mastodonMaxChars : formatting.threadsMaxChars;
  const countUrlAs23 = platform === 'mastodon' && formatting.mastodonCountUrlAs23Chars;
  const formattedTags = formatHashtags(item.tags, formatting.defaultHashtags);

  const renderWithSummary = (summaryText: string) => {
    const withEnv = resolveEnvVariablesInString(formatting.template, envVars);
    return withEnv
      .replace(/\{title\}/g, item.title)
      .replace(/\{summary\}/g, summaryText)
      .replace(/\{link\}/g, item.link)
      .replace(/\{author\}/g, item.author)
      .replace(/\{source\}/g, item.feedName)
      .replace(/\{tags\}/g, formattedTags)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const fullText = renderWithSummary(item.cleanSummary);
  const fullLen = computeEffectiveLength(fullText, platform, countUrlAs23);

  const mediaAttachments = formatting.includeMediaAttachment ? item.enclosures.slice(0, 4) : [];

  if (fullLen <= maxChars) {
    return {
      platform,
      posts: [fullText],
      effectiveCharCounts: [fullLen],
      maxAllowedChars: maxChars,
      wasTruncated: false,
      isThreaded: false,
      mediaAttachments,
    };
  }

  if (formatting.truncationStrategy === 'title_and_link_only') {
    const compact = `${item.title}\n\n${item.link}${formattedTags ? `\n\n${formattedTags}` : ''}`.trim();
    const compactLen = computeEffectiveLength(compact, platform, countUrlAs23);
    return {
      platform,
      posts: [compact],
      effectiveCharCounts: [compactLen],
      maxAllowedChars: maxChars,
      wasTruncated: true,
      isThreaded: false,
      mediaAttachments,
    };
  }

  if (formatting.truncationStrategy === 'thread_split') {
    const sentences = item.cleanSummary.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) || [item.cleanSummary];
    const chunks: string[] = [];
    let currentChunk = `${item.title}\n\n`;

    for (const sentence of sentences) {
      const candidate = `${currentChunk}${sentence}`.trim();
      if (computeEffectiveLength(candidate, platform, countUrlAs23) > maxChars - 18) {
        if (currentChunk.trim().length > 0) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = sentence.trim() + ' ';
      } else {
        currentChunk = candidate + ' ';
      }
    }

    const footer = `\n\n${item.link}${formattedTags ? `\n${formattedTags}` : ''}`;
    if (
      computeEffectiveLength(currentChunk.trim() + footer, platform, countUrlAs23) <=
      maxChars - 10
    ) {
      chunks.push((currentChunk.trim() + footer).trim());
    } else {
      if (currentChunk.trim()) chunks.push(currentChunk.trim());
      chunks.push(`${item.title}\n${footer}`.trim());
    }

    const total = chunks.length;
    const numberedPosts = chunks.map((c, idx) => (total > 1 ? `${c}\n\n(${idx + 1}/${total})` : c));
    return {
      platform,
      posts: numberedPosts,
      effectiveCharCounts: numberedPosts.map((p) =>
        computeEffectiveLength(p, platform, countUrlAs23)
      ),
      maxAllowedChars: maxChars,
      wasTruncated: false,
      isThreaded: numberedPosts.length > 1,
      mediaAttachments,
    };
  }

  const emptySummaryShell = renderWithSummary('');
  const shellLen = computeEffectiveLength(emptySummaryShell, platform, countUrlAs23);
  const availableForSummary = Math.max(24, maxChars - shellLen - 5);

  let truncatedSummary = item.cleanSummary.slice(0, availableForSummary);
  const lastSpace = truncatedSummary.lastIndexOf(' ');
  if (lastSpace > availableForSummary * 0.6) {
    truncatedSummary = truncatedSummary.slice(0, lastSpace);
  }
  truncatedSummary = `${truncatedSummary.replace(/[.,;:\s]+$/, '')}…`;

  const finalPost = renderWithSummary(truncatedSummary);
  const finalLen = computeEffectiveLength(finalPost, platform, countUrlAs23);

  return {
    platform,
    posts: [finalPost],
    effectiveCharCounts: [finalLen],
    maxAllowedChars: maxChars,
    wasTruncated: true,
    isThreaded: false,
    mediaAttachments,
  };
}

export const INITIAL_BRIDGE_FEEDS: BridgeFeedSource[] = [
  {
    id: 'feed-github-releases',
    name: 'IF GitHub Release via RSS-Bridge → THEN Mastodon + Threads',
    bridgeUrl:
      '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=GithubReleaseBridge&user=RSS-Bridge&repo=rss-bridge&format=Json',
    bridgeName: 'GithubReleaseBridge',
    format: 'Json',
    pollIntervalMinutes: 30,
    initialRunPolicy: 'seed_only',
    enabled: true,
    lastPolledAt: '2026-10-26T16:15:00Z',
    hasCompletedInitialRun: true,
  },
  {
    id: 'feed-hn-frontpage',
    name: 'IF HackerNews Score > 150 → THEN Cross-Post Summary',
    bridgeUrl:
      '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=HackerNewsBridge&area=newest&min_score=150&format=Atom',
    bridgeName: 'HackerNewsBridge',
    format: 'Atom',
    pollIntervalMinutes: 15,
    initialRunPolicy: 'publish_latest_one',
    enabled: true,
    lastPolledAt: '2026-10-26T16:30:00Z',
    hasCompletedInitialRun: true,
  },
  {
    id: 'feed-fedi-engineering',
    name: 'IF Mastodon Bridge Media Post → THEN Meta Threads Container',
    bridgeUrl:
      '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=MastodonBridge&username=%40Gargron%40mastodon.social&format=Mrss',
    bridgeName: 'MastodonBridge',
    format: 'Mrss',
    pollIntervalMinutes: 20,
    initialRunPolicy: 'seed_only',
    enabled: true,
    lastPolledAt: null,
    hasCompletedInitialRun: false,
  },
];

export const INITIAL_NORMALIZED_ITEMS: NormalizedFeedItem[] = [
  {
    guid: 'https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-10-24',
    hashId: computeDeterministicHash(
      'https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-10-24'
    ),
    feedId: 'feed-github-releases',
    feedName: 'IF GitHub Release via RSS-Bridge → THEN Mastodon + Threads',
    title: 'RSS-Bridge 2026-10 Release: Native JSON Attachment Normalizer & Rate-Limit Cache',
    rawHtml:
      '<p>This release introduces deterministic ETag caching across 42 bridges, stricter HTML sanitization for Atom and MRSS outputs, and native media enclosure extraction for multi-image posts.</p><img src="https://rss-bridge.org/static/release-2026-10-arch.png" alt="RSS-Bridge Cache Pipeline Diagram" />',
    cleanSummary:
      'This release introduces deterministic ETag caching across 42 bridges, stricter HTML sanitization for Atom and MRSS outputs, and native media enclosure extraction for multi-image posts. Operators running high-frequency polling loops can now enable conditional HTTP 304 responses per bridge instance.',
    link: 'https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-10-24',
    author: 'rss-bridge-maintainers',
    publishedAt: '2026-10-26T15:42:00Z',
    tags: ['RSSBridge', 'OpenSource', 'Syndication', 'SelfHosted'],
    enclosures: [
      {
        url: 'https://rss-bridge.org/static/release-2026-10-arch.png',
        mimeType: 'image/png',
        source: 'html_img',
        altText: 'RSS-Bridge Cache Pipeline Diagram',
      },
    ],
  },
  {
    guid: 'https://news.ycombinator.com/item?id=41982410',
    hashId: computeDeterministicHash('https://news.ycombinator.com/item?id=41982410'),
    feedId: 'feed-hn-frontpage',
    feedName: 'IF HackerNews Score > 150 → THEN Cross-Post Summary',
    title: 'SQLite WAL Mode Contention Benchmarks for High-Frequency Cron Collectors',
    rawHtml:
      '<p>An empirical breakdown of SQLite WAL journal concurrency when running 15-minute feed ingestion workers alongside web read replicas on a single NVMe VPS.</p>',
    cleanSummary:
      'An empirical breakdown of SQLite WAL journal concurrency when running 15-minute feed ingestion workers alongside web read replicas on a single NVMe VPS. Setting busy_timeout=5000 and synchronous=NORMAL eliminates lock errors up to 1,200 writes/sec.',
    link: 'https://news.ycombinator.com/item?id=41982410',
    author: 'k_systems',
    publishedAt: '2026-10-26T16:10:00Z',
    tags: ['SQLite', 'Databases', 'Architecture', 'Backend'],
    enclosures: [],
  },
  {
    guid: 'https://news.ycombinator.com/item?id=41981905',
    hashId: computeDeterministicHash('https://news.ycombinator.com/item?id=41981905'),
    feedId: 'feed-hn-frontpage',
    feedName: 'IF HackerNews Score > 150 → THEN Cross-Post Summary',
    title: 'Sponsored Webinar: Boost Enterprise Cloud Spend Efficiency by 10x Today',
    rawHtml:
      '<p>Sponsored post: Register now for our exclusive promotional webinar on enterprise cloud cost management and receive a free trial voucher.</p>',
    cleanSummary:
      'Sponsored post: Register now for our exclusive promotional webinar on enterprise cloud cost management and receive a free trial voucher.',
    link: 'https://news.ycombinator.com/item?id=41981905',
    author: 'promo_partner',
    publishedAt: '2026-10-26T14:55:00Z',
    tags: ['Sponsored', 'Cloud', 'Webinar'],
    enclosures: [],
  },
  {
    guid: 'https://mastodon.social/@Gargron/11339481029384',
    hashId: computeDeterministicHash('https://mastodon.social/@Gargron/11339481029384'),
    feedId: 'feed-fedi-engineering',
    feedName: 'IF Mastodon Bridge Media Post → THEN Meta Threads Container',
    title: 'Async Media Processing & Two-Step Container Upload Patterns in ActivityPub 2026',
    rawHtml:
      '<p>When cross-posting high-resolution enclosures to Mastodon (/api/v2/media) and Meta Threads (/{user-id}/threads), asynchronous media container polling prevents HTTP 422 timeouts on large images.</p>',
    cleanSummary:
      'When cross-posting high-resolution enclosures to Mastodon (/api/v2/media) and Meta Threads (/{user-id}/threads), asynchronous media container polling prevents HTTP 422 timeouts on large images. Always verify container status=FINISHED before invoking threads_publish.',
    link: 'https://mastodon.social/@Gargron/11339481029384',
    author: 'Gargron',
    publishedAt: '2026-10-26T16:28:00Z',
    tags: ['ActivityPub', 'Mastodon', 'ThreadsAPI', 'MediaPipeline'],
    enclosures: [
      {
        url: 'https://files.mastodon.social/media_attachments/files/113/394/810/original/pipeline.png',
        mimeType: 'image/png',
        source: 'enclosure',
        altText: 'Two-step media upload state machine diagram',
      },
    ],
  },
  {
    guid: 'https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-09-15',
    hashId: computeDeterministicHash(
      'https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-09-15'
    ),
    feedId: 'feed-github-releases',
    feedName: 'IF GitHub Release via RSS-Bridge → THEN Mastodon + Threads',
    title: 'RSS-Bridge 2026-09 Release: Custom CSS Selector Bridge & XPath 2.0 Support',
    rawHtml:
      '<p>Added support for custom XPath 2.0 expressions in FilterBridge and improved character encoding normalization for non-UTF8 upstream sites.</p>',
    cleanSummary:
      'Added support for custom XPath 2.0 expressions in FilterBridge and improved character encoding normalization for non-UTF8 upstream sites.',
    link: 'https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-09-15',
    author: 'rss-bridge-maintainers',
    publishedAt: '2026-09-15T11:20:00Z',
    tags: ['RSSBridge', 'XPath', 'Release'],
    enclosures: [],
  },
];

export const INITIAL_SEEN_STATE: SeenEntry[] = [
  {
    guid: 'https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-09-15',
    hashId: computeDeterministicHash(
      'https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-09-15'
    ),
    feedId: 'feed-github-releases',
    title: 'RSS-Bridge 2026-09 Release: Custom CSS Selector Bridge & XPath 2.0 Support',
    status: 'seeded_initial',
    reason: 'Marked seen on initial feed registration (seed_only policy)',
    processedAt: '2026-10-20T09:00:00Z',
  },
  {
    guid: 'https://news.ycombinator.com/item?id=41981905',
    hashId: computeDeterministicHash('https://news.ycombinator.com/item?id=41981905'),
    feedId: 'feed-hn-frontpage',
    title: 'Sponsored Webinar: Boost Enterprise Cloud Spend Efficiency by 10x Today',
    status: 'filtered_out',
    reason: 'Triggered blacklist keyword: sponsored, webinar',
    processedAt: '2026-10-26T15:00:00Z',
  },
];

```

# lib\utils.ts

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

# metadata.json

```json
{
  "name": "BridgeRelay — RSS-Bridge to Mastodon & Threads Pipeline",
  "description": "End-to-end syndication pipeline for ingesting RSS-Bridge feeds, deduplicating state, applying regex and template formatting rules, and publishing to Mastodon and Meta Threads.",
  "requestFramePermissions": [],
  "majorCapabilities": ["MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API"]
}

```

# next-env.d.ts

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
/// <reference path="./.next/types/routes.d.ts" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.

```

# next.config.ts

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;
```

# package.json

```json
{
  "name": "ai-studio-applet",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "clean": "next clean"
  },
  "dependencies": {
    "@google/genai": "^2.4.0",
    "@hookform/resolvers": "^5.2.1",
    "autoprefixer": "^10.4.21",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "fast-xml-parser": "^4.5.3",
    "lucide-react": "^0.553.0",
    "motion": "^12.23.24",
    "next": "^15.4.9",
    "postcss": "^8.5.6",
    "react": "^19.2.1",
    "react-dom": "^19.2.1",
    "tailwind-merge": "^3.3.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "4.1.11",
    "@tailwindcss/typography": "^0.5.19",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "9.39.1",
    "eslint-config-next": "16.0.8",
    "firebase-tools": "^15.0.0",
    "tailwindcss": "4.1.11",
    "tw-animate-css": "^1.4.0",
    "typescript": "5.9.3"
  }
}
```

# postcss.config.mjs

```mjs
/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
```

# public\assets\aistudio\image_5b88e67e.png

This is a binary file of the type: Image

# public\assets\aistudio\image_73873339.png

This is a binary file of the type: Image

# README.md

```md
<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/50bf7c09-8613-4e5d-8900-9476401851d8

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

```

# tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}

```

# Vercel\Next.js

```js
https://your-domain.vercel.app/api/cron
```

