# .ai_backups\20261027_045056_app_api_pipeline_poll_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import {
  cleanHtmlToPlainText,
  computeDeterministicHash,
  extractImagesFromHtml,
  NormalizedFeedItem,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

export async function POST(req: NextRequest) {
  try {
    const { feedId = 'feed-default', feedName = 'RSS Feed', bridgeUrl } = await req.json();
    if (!bridgeUrl) return NextResponse.json({ error: 'bridgeUrl is required' }, { status: 400 });

    const res = await fetch(bridgeUrl, {
      headers: { 'User-Agent': 'BridgeRelay-Pipeline/2.0' },
    });
    if (!res.ok) return NextResponse.json({ error: `Bridge returned HTTP ${res.status}` }, { status: 502 });

    const text = await res.text();
    if (text.trim().startsWith('{')) {
      const parsed = JSON.parse(text);
      const items = (parsed.items || []).slice(0, 20).map((entry, idx) => ({
        guid: String(entry.id || entry.url || `${feedId}-${idx}`),
        hashId: computeDeterministicHash(String(entry.id || entry.url || `${feedId}-${idx}`)),
        feedId,
        feedName,
        title: String(entry.title || 'Untitled Entry'),
        rawHtml: String(entry.content_html || entry.summary || ''),
        cleanSummary: cleanHtmlToPlainText(String(entry.content_html || entry.summary || '')),
        link: String(entry.url || bridgeUrl),
        author: entry.author?.name || 'author',
        publishedAt: String(entry.date_published || new Date().toISOString()),
        tags: Array.isArray(entry.tags) ? entry.tags.map(String) : ['RSSBridge'],
        enclosures: [],
      }));
      return NextResponse.json({ items });
    }

    const parsed = xmlParser.parse(text);
    const rawList = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
    const entries = Array.isArray(rawList) ? rawList : [rawList];

    const items: NormalizedFeedItem[] = entries.slice(0, 20).map((entry, idx) => {
      const rawTitle = String(entry.title?.['#text'] || entry.title || 'Untitled Entry');
      const title = cleanHtmlToPlainText(rawTitle, false);
      const link = String(entry.link?.['@_href'] || entry.link || bridgeUrl);
      const guid = String(entry.guid?.['#text'] || entry.guid || entry.id || `${feedId}-${idx}`);
      const rawHtml = String(entry['content:encoded'] || entry.content?.['#text'] || entry.description || '');

      return {
        guid,
        hashId: computeDeterministicHash(guid),
        feedId,
        feedName,
        title,
        rawHtml,
        cleanSummary: cleanHtmlToPlainText(rawHtml),
        link,
        author: 'bridge-author',
        publishedAt: new Date().toISOString(),
        tags: ['Syndicated'],
        enclosures: extractImagesFromHtml(rawHtml),
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to poll feed' }, { status: 500 });
  }
}

```

# .ai_backups\20261027_045325_app_api_pipeline_publish_route.ts

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

async function uploadMediaToMastodon(mediaUrl: string, instance: string, token: string): Promise<string> {
  const mediaRes = await fetch(mediaUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BridgeRelay/2.0)', Accept: 'image/*, video/*, */*' },
  });
  if (!mediaRes.ok) throw new Error(`Media download returned HTTP ${mediaRes.status} for ${mediaUrl}`);

  const blob = await mediaRes.blob();
  const ext = (mediaRes.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg';
  const formData = new FormData();
  formData.append('file', blob, `attachment.${ext}`);
  formData.append('description', 'Syndicated via BridgeRelay');

  const uploadRes = await fetch(`${instance}/api/v2/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!uploadRes.ok) throw new Error(`Mastodon upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
  const data = await uploadRes.json();
  return data.id;
}

async function pollThreadsContainerReady(containerId: string, token: string, maxAttempts = 8): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`https://graph.threads.net/v1.0/${containerId}?fields=status,error_message&access_token=${token}`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'FINISHED') return;
      if (data.status === 'ERROR') throw new Error(`Threads container error: ${data.error_message || 'Processing failed'}`);
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
      platforms = [],
      actionType = 'text',
      mastodonPosts = [],
      threadsPosts = [],
      linkUrl = '',
      mediaUrls = [],
      visibility = 'public',
      credentials,
    } = body;

    const traces: PublishStepTrace[] = [];
    let stepCounter = 1;

    const mastodonInstance = (credentials?.mastodonInstanceUrl || process.env.MASTODON_INSTANCE_URL || 'https://mastodon.social').replace(/\/$/, '');
    const mastodonToken = (credentials?.mastodonAccessToken || process.env.MASTODON_ACCESS_TOKEN || '').trim();
    const threadsUserId = (credentials?.threadsUserId || process.env.THREADS_USER_ID || '').trim();
    const threadsToken = (credentials?.threadsAccessToken || process.env.THREADS_ACCESS_TOKEN || '').trim();

    let publishedMastodonId: string | undefined;
    let publishedThreadsId: string | undefined;

    const validMediaUrls = (mediaUrls || []).filter(
      (url) => url && typeof url === 'string' && url.startsWith('http') && !url.includes('release-2026-10-arch')
    );

    // 1. Mastodon
    if (platforms.includes('mastodon') && mastodonPosts?.length > 0) {
      if (!mastodonToken) throw new Error('Mastodon access token is missing');
      const uploadedMediaIds: string[] = [];

      if ((actionType === 'image' || actionType === 'video' || actionType === 'carousel') && validMediaUrls.length > 0) {
        const mediaToUpload = actionType === 'carousel' ? validMediaUrls.slice(0, 4) : [validMediaUrls[0]];
        for (const url of mediaToUpload) {
          const t0 = Date.now();
          try {
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
          } catch (mediaErr) {
            traces.push({
              step: stepCounter++,
              platform: 'mastodon',
              actionType,
              endpoint: `${mastodonInstance}/api/v2/media`,
              method: 'POST',
              status: 'error',
              httpStatus: 400,
              requestPayload: { file_url: url },
              responsePayload: { warning: mediaErr instanceof Error ? mediaErr.message : 'Media upload skipped' },
              durationMs: Date.now() - t0,
            });
          }
        }
      }

      let inReplyToId: string | undefined;
      for (let i = 0; i < mastodonPosts.length; i++) {
        const t0 = Date.now();
        const postText = mastodonPosts[i];
        const statusEndpoint = `${mastodonInstance}/api/v1/statuses`;
        const reqPayload = {
          status: postText,
          visibility,
          ...(i === 0 && uploadedMediaIds.length > 0 ? { media_ids: uploadedMediaIds } : {}),
          ...(inReplyToId ? { in_reply_to_id: inReplyToId } : {}),
        };

        const res = await fetch(statusEndpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${mastodonToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(reqPayload),
        });
        const resData = await res.json();
        if (!res.ok) throw new Error(`Mastodon error (${res.status}): ${JSON.stringify(resData)}`);

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
      if (!threadsUserId || !threadsToken) throw new Error('Threads User ID or Access Token is missing');

      const containerEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads`;
      const publishEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`;
      const postText = threadsPosts[0];
      let containerIdToPublish = '';

      if (actionType === 'carousel' && validMediaUrls.length >= 2) {
        const childContainerIds: string[] = [];
        for (const mUrl of validMediaUrls.slice(0, 5)) {
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
          if (!childRes.ok) throw new Error(`Threads carousel item failed: ${JSON.stringify(childData)}`);
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
        const hasValidMedia = (actionType === 'image' || actionType === 'video') && validMediaUrls.length > 0;
        const isImage = actionType === 'image' && hasValidMedia;
        const isVideo = actionType === 'video' && hasValidMedia;
        const mediaType = isImage ? 'IMAGE' : isVideo ? 'VIDEO' : 'TEXT';

        const params = new URLSearchParams({
          media_type: mediaType,
          text: postText,
          access_token: threadsToken,
          ...(actionType === 'link' && linkUrl ? { link_attachment: linkUrl } : {}),
          ...(isImage ? { image_url: validMediaUrls[0] } : {}),
          ...(isVideo ? { video_url: validMediaUrls[0] } : {}),
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
      const pubParams = new URLSearchParams({ creation_id: containerIdToPublish, access_token: threadsToken });
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

    return NextResponse.json({ success: true, executedAt: new Date().toISOString(), traces });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Publish execution failed' },
      { status: 500 }
    );
  }
}

```

# .ai_backups\20261027_045745_tsconfig.json

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

# .ai_backups\20261027_045750_tsconfig.json

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

# .ai_backups\20261027_050031_app_api_pipeline_publish_route.ts

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

async function uploadMediaToMastodon(mediaUrl: string, instance: string, token: string): Promise<string> {
  const mediaRes = await fetch(mediaUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BridgeRelay/2.0)', Accept: 'image/*, video/*, */*' },
  });
  if (!mediaRes.ok) throw new Error(`Media download returned HTTP ${mediaRes.status} for ${mediaUrl}`);

  const blob = await mediaRes.blob();
  const ext = (mediaRes.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg';
  const formData = new FormData();
  formData.append('file', blob, `attachment.${ext}`);
  formData.append('description', 'Syndicated via BridgeRelay');

  const uploadRes = await fetch(`${instance}/api/v2/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!uploadRes.ok) throw new Error(`Mastodon upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
  const data = await uploadRes.json();
  return data.id;
}

async function pollThreadsContainerReady(containerId: string, token: string, maxAttempts = 8): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`https://graph.threads.net/v1.0/${containerId}?fields=status,error_message&access_token=${token}`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'FINISHED') return;
      if (data.status === 'ERROR') throw new Error(`Threads container error: ${data.error_message || 'Processing failed'}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: any = await req.json();
    const {
      itemGuid,
      itemTitle = 'Feed Item',
      feedId = 'feed-default',
      platforms = [],
      actionType = 'text',
      mastodonPosts = [],
      threadsPosts = [],
      linkUrl = '',
      mediaUrls = [],
      visibility = 'public',
      credentials,
    } = body;

    const traces: PublishStepTrace[] = [];
    let stepCounter = 1;

    const mastodonInstance = (credentials?.mastodonInstanceUrl || process.env.MASTODON_INSTANCE_URL || 'https://mastodon.social').replace(/\/$/, '');
    const mastodonToken = (credentials?.mastodonAccessToken || process.env.MASTODON_ACCESS_TOKEN || '').trim();
    const threadsUserId = (credentials?.threadsUserId || process.env.THREADS_USER_ID || '').trim();
    const threadsToken = (credentials?.threadsAccessToken || process.env.THREADS_ACCESS_TOKEN || '').trim();

    let publishedMastodonId: string | undefined;
    let publishedThreadsId: string | undefined;

    // Explicitly typed (url: string)
    const validMediaUrls: string[] = ((mediaUrls as string[]) || []).filter(
      (url: string) => url && typeof url === 'string' && url.startsWith('http') && !url.includes('release-2026-10-arch')
    );

    // 1. Mastodon
    if (platforms.includes('mastodon') && mastodonPosts?.length > 0) {
      if (!mastodonToken) throw new Error('Mastodon access token is missing');
      const uploadedMediaIds: string[] = [];

      if ((actionType === 'image' || actionType === 'video' || actionType === 'carousel') && validMediaUrls.length > 0) {
        const mediaToUpload = actionType === 'carousel' ? validMediaUrls.slice(0, 4) : [validMediaUrls[0]];
        for (const url of mediaToUpload) {
          const t0 = Date.now();
          try {
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
          } catch (mediaErr) {
            traces.push({
              step: stepCounter++,
              platform: 'mastodon',
              actionType,
              endpoint: `${mastodonInstance}/api/v2/media`,
              method: 'POST',
              status: 'error',
              httpStatus: 400,
              requestPayload: { file_url: url },
              responsePayload: { warning: mediaErr instanceof Error ? mediaErr.message : 'Media upload skipped' },
              durationMs: Date.now() - t0,
            });
          }
        }
      }

      let inReplyToId: string | undefined;
      for (let i = 0; i < mastodonPosts.length; i++) {
        const t0 = Date.now();
        const postText = mastodonPosts[i];
        const statusEndpoint = `${mastodonInstance}/api/v1/statuses`;
        const reqPayload: Record<string, unknown> = {
          status: postText,
          visibility,
          ...(i === 0 && uploadedMediaIds.length > 0 ? { media_ids: uploadedMediaIds } : {}),
          ...(inReplyToId ? { in_reply_to_id: inReplyToId } : {}),
        };

        const res = await fetch(statusEndpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${mastodonToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(reqPayload),
        });
        const resData = await res.json();
        if (!res.ok) throw new Error(`Mastodon status error (${res.status}): ${JSON.stringify(resData)}`);

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
      if (!threadsUserId || !threadsToken) throw new Error('Threads User ID or Access Token is missing');

      const containerEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads`;
      const publishEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`;
      const postText = threadsPosts[0];
      let containerIdToPublish = '';

      if (actionType === 'carousel' && validMediaUrls.length >= 2) {
        const childContainerIds: string[] = [];
        for (const mUrl of validMediaUrls.slice(0, 5)) {
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
          if (!childRes.ok) throw new Error(`Threads carousel item failed: ${JSON.stringify(childData)}`);
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
        const hasValidMedia = (actionType === 'image' || actionType === 'video') && validMediaUrls.length > 0;
        const isImage = actionType === 'image' && hasValidMedia;
        const isVideo = actionType === 'video' && hasValidMedia;
        const mediaType = isImage ? 'IMAGE' : isVideo ? 'VIDEO' : 'TEXT';

        const params = new URLSearchParams({
          media_type: mediaType,
          text: postText,
          access_token: threadsToken,
          ...(actionType === 'link' && linkUrl ? { link_attachment: linkUrl } : {}),
          ...(isImage ? { image_url: validMediaUrls[0] } : {}),
          ...(isVideo ? { video_url: validMediaUrls[0] } : {}),
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
      const pubParams = new URLSearchParams({ creation_id: containerIdToPublish, access_token: threadsToken });
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

    return NextResponse.json({ success: true, executedAt: new Date().toISOString(), traces });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Publish execution failed' },
      { status: 500 }
    );
  }
}
```

# .ai_backups\20261027_050752_app_api_pipeline_publish_route.ts

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

async function uploadMediaToMastodon(mediaUrl: string, instance: string, token: string): Promise<string> {
  const mediaRes = await fetch(mediaUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BridgeRelay/2.0)', Accept: 'image/*, video/*, */*' },
  });
  if (!mediaRes.ok) throw new Error(`Media download returned HTTP ${mediaRes.status} for ${mediaUrl}`);

  const blob = await mediaRes.blob();
  const ext = (mediaRes.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg';
  const formData = new FormData();
  formData.append('file', blob, `attachment.${ext}`);
  formData.append('description', 'Syndicated via BridgeRelay');

  const uploadRes = await fetch(`${instance}/api/v2/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!uploadRes.ok) throw new Error(`Mastodon upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
  const data = await uploadRes.json();
  return data.id;
}

// Improved status poller with backoff & detailed error reporting
async function pollThreadsContainerReady(containerId: string, token: string, maxAttempts = 10): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fetch(`https://graph.threads.net/v1.0/${containerId}?fields=status,error_message&access_token=${token}`);
    
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'FINISHED') return;
      if (data.status === 'ERROR') {
        const errorDetail = data.error_message || 'Media processing rejected by Meta (check if media URL is public/hotlink-protected)';
        throw new Error(`Threads container error: ${errorDetail}`);
      }
      // If status is 'IN_PROGRESS', continue loop
    }
  }
  throw new Error('Threads container processing timed out after 25s');
}

export async function POST(req: NextRequest) {
  try {
    const body: any = await req.json();
    const {
      itemGuid,
      itemTitle = 'Feed Item',
      feedId = 'feed-default',
      platforms = [],
      actionType = 'text',
      mastodonPosts = [],
      threadsPosts = [],
      linkUrl = '',
      mediaUrls = [],
      visibility = 'public',
      credentials,
    } = body;

    const traces: PublishStepTrace[] = [];
    let stepCounter = 1;

    const mastodonInstance = (credentials?.mastodonInstanceUrl || process.env.MASTODON_INSTANCE_URL || 'https://mastodon.social').replace(/\/$/, '');
    const mastodonToken = (credentials?.mastodonAccessToken || process.env.MASTODON_ACCESS_TOKEN || '').trim();
    const threadsUserId = (credentials?.threadsUserId || process.env.THREADS_USER_ID || '').trim();
    const threadsToken = (credentials?.threadsAccessToken || process.env.THREADS_ACCESS_TOKEN || '').trim();

    let publishedMastodonId: string | undefined;
    let publishedThreadsId: string | undefined;

    const validMediaUrls: string[] = ((mediaUrls as string[]) || []).filter(
      (url: string) => url && typeof url === 'string' && url.startsWith('http') && !url.includes('release-2026-10-arch')
    );

    // 1. Mastodon
    if (platforms.includes('mastodon') && mastodonPosts?.length > 0) {
      if (!mastodonToken) throw new Error('Mastodon access token is missing');
      const uploadedMediaIds: string[] = [];

      if ((actionType === 'image' || actionType === 'video' || actionType === 'carousel') && validMediaUrls.length > 0) {
        const mediaToUpload = actionType === 'carousel' ? validMediaUrls.slice(0, 4) : [validMediaUrls[0]];
        for (const url of mediaToUpload) {
          const t0 = Date.now();
          try {
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
          } catch (mediaErr) {
            traces.push({
              step: stepCounter++,
              platform: 'mastodon',
              actionType,
              endpoint: `${mastodonInstance}/api/v2/media`,
              method: 'POST',
              status: 'error',
              httpStatus: 400,
              requestPayload: { file_url: url },
              responsePayload: { warning: mediaErr instanceof Error ? mediaErr.message : 'Media upload skipped' },
              durationMs: Date.now() - t0,
            });
          }
        }
      }

      let inReplyToId: string | undefined;
      for (let i = 0; i < mastodonPosts.length; i++) {
        const t0 = Date.now();
        const postText = mastodonPosts[i];
        const statusEndpoint = `${mastodonInstance}/api/v1/statuses`;
        const reqPayload: Record<string, unknown> = {
          status: postText,
          visibility,
          ...(i === 0 && uploadedMediaIds.length > 0 ? { media_ids: uploadedMediaIds } : {}),
          ...(inReplyToId ? { in_reply_to_id: inReplyToId } : {}),
        };

        const res = await fetch(statusEndpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${mastodonToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(reqPayload),
        });
        const resData = await res.json();
        if (!res.ok) throw new Error(`Mastodon status error (${res.status}): ${JSON.stringify(resData)}`);

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
      if (!threadsUserId || !threadsToken) throw new Error('Threads User ID or Access Token is missing');

      const containerEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads`;
      const publishEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`;
      const postText = threadsPosts[0];
      let containerIdToPublish = '';
      let requiresPolling = false;

      if (actionType === 'carousel' && validMediaUrls.length >= 2) {
        requiresPolling = true;
        const childContainerIds: string[] = [];
        for (const mUrl of validMediaUrls.slice(0, 5)) {
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
          if (!childRes.ok) throw new Error(`Threads carousel item failed: ${JSON.stringify(childData)}`);
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
        const hasValidMedia = (actionType === 'image' || actionType === 'video') && validMediaUrls.length > 0;
        const isImage = actionType === 'image' && hasValidMedia;
        const isVideo = actionType === 'video' && hasValidMedia;
        const mediaType = isImage ? 'IMAGE' : isVideo ? 'VIDEO' : 'TEXT';

        // Only image/video/carousel containers require status polling
        if (isImage || isVideo) {
          requiresPolling = true;
        }

        const params = new URLSearchParams({
          media_type: mediaType,
          text: postText,
          access_token: threadsToken,
          ...(actionType === 'link' && linkUrl ? { link_attachment: linkUrl } : {}),
          ...(isImage ? { image_url: validMediaUrls[0] } : {}),
          ...(isVideo ? { video_url: validMediaUrls[0] } : {}),
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

      // Only poll status if media is attached (Text containers are ready immediately)
      if (requiresPolling) {
        await pollThreadsContainerReady(containerIdToPublish, threadsToken);
      }

      const tPublish = Date.now();
      const pubParams = new URLSearchParams({ creation_id: containerIdToPublish, access_token: threadsToken });
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

    return NextResponse.json({ success: true, executedAt: new Date().toISOString(), traces });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Publish execution failed' },
      { status: 500 }
    );
  }
}
```

# .ai_backups\20261027_052515_app_api_pipeline_poll_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import {
  cleanHtmlToPlainText,
  computeDeterministicHash,
  extractImagesFromHtml,
  NormalizedFeedItem,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

export async function POST(req: NextRequest) {
  try {
    const { feedId = 'feed-default', feedName = 'RSS Feed', bridgeUrl } = await req.json();
    if (!bridgeUrl) return NextResponse.json({ error: 'bridgeUrl is required' }, { status: 400 });

    const res = await fetch(bridgeUrl, {
      headers: { 'User-Agent': 'BridgeRelay-Pipeline/2.0' },
    });
    if (!res.ok) return NextResponse.json({ error: `Bridge returned HTTP ${res.status}` }, { status: 502 });

    const text = await res.text();

    // 1. JSON Feed parser
    if (text.trim().startsWith('{')) {
      const parsed = JSON.parse(text);
      const items: NormalizedFeedItem[] = (parsed.items || []).slice(0, 20).map((entry: Record<string, any>, idx: number) => ({
        guid: String(entry.id || entry.url || `${feedId}-${idx}`),
        hashId: computeDeterministicHash(String(entry.id || entry.url || `${feedId}-${idx}`)),
        feedId,
        feedName,
        title: String(entry.title || 'Untitled Entry'),
        rawHtml: String(entry.content_html || entry.summary || ''),
        cleanSummary: cleanHtmlToPlainText(String(entry.content_html || entry.summary || '')),
        link: String(entry.url || bridgeUrl),
        author: String(entry.author?.name || 'author'),
        publishedAt: String(entry.date_published || new Date().toISOString()),
        tags: Array.isArray(entry.tags) ? entry.tags.map(String) : ['RSSBridge'],
        enclosures: [],
      }));
      return NextResponse.json({ items });
    }

    // 2. XML / Atom / RSS parser
    const parsed = xmlParser.parse(text);
    const rawList = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
    const entries: Record<string, any>[] = Array.isArray(rawList) ? rawList : [rawList];

    const items: NormalizedFeedItem[] = entries.slice(0, 20).map((entry: Record<string, any>, idx: number) => {
      const rawTitle = String(entry.title?.['#text'] || entry.title || 'Untitled Entry');
      const title = cleanHtmlToPlainText(rawTitle, false);
      const link = String(entry.link?.['@_href'] || entry.link || bridgeUrl);
      const guid = String(entry.guid?.['#text'] || entry.guid || entry.id || `${feedId}-${idx}`);
      const rawHtml = String(entry['content:encoded'] || entry.content?.['#text'] || entry.description || '');

      return {
        guid,
        hashId: computeDeterministicHash(guid),
        feedId,
        feedName,
        title,
        rawHtml,
        cleanSummary: cleanHtmlToPlainText(rawHtml),
        link,
        author: 'bridge-author',
        publishedAt: new Date().toISOString(),
        tags: ['Syndicated'],
        enclosures: extractImagesFromHtml(rawHtml),
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to poll feed' }, { status: 500 });
  }
}
```

# .ai_backups\20261027_052947_app_api_pipeline_poll_route.ts

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
});

export async function POST(req: NextRequest) {
  try {
    const { feedId = 'feed-default', feedName = 'RSS Feed', bridgeUrl } = await req.json();
    if (!bridgeUrl) return NextResponse.json({ error: 'bridgeUrl is required' }, { status: 400 });

    const res = await fetch(bridgeUrl, {
      headers: { 'User-Agent': 'BridgeRelay-Pipeline/2.0 (+https://rss-bridge.org)' },
    });
    if (!res.ok) return NextResponse.json({ error: `Bridge returned HTTP ${res.status}` }, { status: 502 });

    const text = await res.text();

    // 1. JSON Feed Parser
    if (text.trim().startsWith('{')) {
      const parsed = JSON.parse(text);
      const items: NormalizedFeedItem[] = (parsed.items || []).slice(0, 20).map((entry: Record<string, any>, idx: number) => {
        const enclosures: MediaEnclosure[] = [];
        if (Array.isArray(entry.attachments)) {
          for (const att of entry.attachments) {
            if (att?.url) {
              const isVid = String(att.mime_type || '').includes('video') || String(att.url).includes('.mp4');
              enclosures.push({
                url: String(att.url),
                mimeType: isVid ? 'video/mp4' : 'image/jpeg',
                source: 'enclosure',
              });
            }
          }
        }
        if (entry.image) {
          enclosures.push({ url: String(entry.image), mimeType: 'image/jpeg', source: 'enclosure' });
        }

        return {
          guid: String(entry.id || entry.url || `${feedId}-${idx}`),
          hashId: computeDeterministicHash(String(entry.id || entry.url || `${feedId}-${idx}`)),
          feedId,
          feedName,
          title: String(entry.title || 'Untitled Entry'),
          rawHtml: String(entry.content_html || entry.summary || ''),
          cleanSummary: cleanHtmlToPlainText(String(entry.content_html || entry.summary || '')),
          link: String(entry.url || bridgeUrl),
          author: String(entry.author?.name || 'author'),
          publishedAt: String(entry.date_published || new Date().toISOString()),
          tags: Array.isArray(entry.tags) ? entry.tags.map(String) : ['RSSBridge'],
          enclosures,
        };
      });
      return NextResponse.json({ items });
    }

    // 2. RSS / Atom / Media-RSS (MRSS) Parser
    const parsed = xmlParser.parse(text);
    const rawList = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
    const entries: Record<string, any>[] = Array.isArray(rawList) ? rawList : [rawList];

    const items: NormalizedFeedItem[] = entries.slice(0, 20).map((entry: Record<string, any>, idx: number) => {
      const rawTitle = String(entry.title?.['#text'] || entry.title || 'Untitled Entry');
      const title = cleanHtmlToPlainText(rawTitle, false);
      const link = String(entry.link?.['@_href'] || entry.link || bridgeUrl);
      const guid = String(entry.guid?.['#text'] || entry.guid || entry.id || `${feedId}-${idx}`);
      const rawHtml = String(entry['content:encoded'] || entry.content?.['#text'] || entry.description || '');

      const enclosures: MediaEnclosure[] = [];

      // A. Extract <enclosure url="..." type="..." />
      const rawEnc = entry.enclosure;
      if (rawEnc) {
        const encList = Array.isArray(rawEnc) ? rawEnc : [rawEnc];
        for (const enc of encList) {
          if (enc?.['@_url']) {
            const url = String(enc['@_url']);
            const type = String(enc['@_type'] || '');
            const isVid = type.includes('video') || url.includes('.mp4') || url.includes('.mov');
            enclosures.push({
              url,
              mimeType: isVid ? 'video/mp4' : 'image/jpeg',
              source: 'enclosure',
            });
          }
        }
      }

      // B. Extract <media:content url="..." /> (Used by YouTube & TikTok RSS-Bridge)
      const rawMediaContent = entry['media:content'];
      if (rawMediaContent) {
        const mcList = Array.isArray(rawMediaContent) ? rawMediaContent : [rawMediaContent];
        for (const mc of mcList) {
          if (mc?.['@_url']) {
            const url = String(mc['@_url']);
            const type = String(mc['@_type'] || '');
            const isVid = type.includes('video') || url.includes('.mp4');
            enclosures.push({
              url,
              mimeType: isVid ? 'video/mp4' : 'image/jpeg',
              source: 'enclosure',
            });
          }
        }
      }

      // C. Extract <media:thumbnail url="..." />
      const rawThumbnail = entry['media:thumbnail'];
      if (rawThumbnail && enclosures.length === 0) {
        const thumbList = Array.isArray(rawThumbnail) ? rawThumbnail : [rawThumbnail];
        if (thumbList[0]?.['@_url']) {
          enclosures.push({
            url: String(thumbList[0]['@_url']),
            mimeType: 'image/jpeg',
            source: 'enclosure',
          });
        }
      }

      // D. Fallback to HTML images
      for (const img of extractImagesFromHtml(rawHtml)) {
        if (!enclosures.some((e) => e.url === img.url)) {
          enclosures.push(img);
        }
      }

      return {
        guid,
        hashId: computeDeterministicHash(guid),
        feedId,
        feedName,
        title,
        rawHtml,
        cleanSummary: cleanHtmlToPlainText(rawHtml),
        link,
        author: 'bridge-author',
        publishedAt: new Date().toISOString(),
        tags: ['Syndicated'],
        enclosures,
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to poll feed' }, { status: 500 });
  }
}
```

# .ai_backups\20261027_054038_app_api_pipeline_poll_route.ts

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
});

export async function POST(req: NextRequest) {
  try {
    const { feedId = 'feed-default', feedName = 'TikTok Feed', bridgeUrl } = await req.json();
    if (!bridgeUrl) return NextResponse.json({ error: 'bridgeUrl is required' }, { status: 400 });

    const res = await fetch(bridgeUrl, {
      headers: { 'User-Agent': 'BridgeRelay-Pipeline/2.0 (+https://rss-bridge.org)' },
    });
    if (!res.ok) return NextResponse.json({ error: `Bridge returned HTTP ${res.status}` }, { status: 502 });

    const text = await res.text();
    const parsed = xmlParser.parse(text);

    // Support Atom <feed><entry> and RSS <channel><item>
    const rawList = parsed?.feed?.entry || parsed?.rss?.channel?.item || [];
    const entries: Record<string, any>[] = Array.isArray(rawList) ? rawList : [rawList];

    const items: NormalizedFeedItem[] = entries.slice(0, 20).map((entry: Record<string, any>, idx: number) => {
      // 1. Extract clean canonical Link
      let link = '';
      if (typeof entry.link === 'string') {
        link = entry.link;
      } else if (Array.isArray(entry.link)) {
        const alt = entry.link.find((l: any) => l['@_rel'] === 'alternate');
        link = alt?.['@_href'] || entry.link[0]?.['@_href'] || '';
      } else if (entry.link?.['@_href']) {
        link = entry.link['@_href'];
      }
      if (!link) link = String(entry.id?.['#text'] || entry.id || bridgeUrl);

      // 2. Extract Title and Content
      const rawTitle = String(entry.title?.['#text'] || entry.title || 'TikTok Video');
      const title = cleanHtmlToPlainText(rawTitle, false);
      const rawHtml = String(entry.content?.['#text'] || entry.content || entry['content:encoded'] || entry.description || '');

      // 3. Extract Enclosures (Handling Atom <link rel="enclosure" href="...">)
      const enclosures: MediaEnclosure[] = [];
      if (Array.isArray(entry.link)) {
        for (const l of entry.link) {
          if (l['@_rel'] === 'enclosure' && l['@_href']) {
            const url = String(l['@_href']);
            // Ignore tiny 100x100 avatar thumbnails that Meta Threads blocks
            if (!url.includes('100:100')) {
              enclosures.push({
                url,
                mimeType: l['@_type'] || 'image/jpeg',
                source: 'enclosure',
              });
            }
          }
        }
      }

      // Also check standard RSS <enclosure>
      if (entry.enclosure?.['@_url']) {
        enclosures.push({
          url: String(entry.enclosure['@_url']),
          mimeType: entry.enclosure['@_type'] || 'image/jpeg',
          source: 'enclosure',
        });
      }

      const guid = String(entry.id?.['#text'] || entry.id || link || `${feedId}-${idx}`);

      return {
        guid,
        hashId: computeDeterministicHash(guid),
        feedId,
        feedName,
        title: title.startsWith('http') ? 'New TikTok Video' : title,
        rawHtml,
        cleanSummary: cleanHtmlToPlainText(rawHtml),
        link,
        author: '@mollynailsind',
        publishedAt: String(entry.published || entry.updated || new Date().toISOString()),
        tags: ['TikTok', 'Nails', 'Beauty'],
        enclosures,
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to parse feed' }, { status: 500 });
  }
}
```

# .ai_backups\20261027_055245_lib_pipeline-engine.ts

```ts
export type BridgeFormat = 'Json' | 'Atom' | 'Mrss';
export type InitialRunPolicy = 'seed_only' | 'publish_latest_one' | 'publish_all';
export type TruncationStrategy = 'ellipsis' | 'thread_split' | 'title_and_link_only';
export type SocialActionType = 'text' | 'link' | 'image' | 'video' | 'carousel';

export interface DashboardEnvVar {
  id: string;
  key: string;
  value: string;
  description: string;
  isSecret: boolean;
  category: 'rss_bridge' | 'mastodon' | 'threads' | 'template';
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
  status: 'published_both' | 'published_mastodon' | 'published_threads' | 'seeded_initial' | 'filtered_out' | 'queued';
  reason?: string;
  processedAt: string;
  mastodonStatusId?: string;
  threadsPostId?: string;
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
  { id: 'env-1', key: 'RSS_BRIDGE_BASE_URL', value: 'https://rss-bridge.org/bridge01', description: 'Base URL of RSS-Bridge instance', isSecret: false, category: 'rss_bridge' },
  { id: 'env-2', key: 'THREADS_APP_ID', value: '', description: 'Meta Threads App ID', isSecret: false, category: 'threads' },
  { id: 'env-3', key: 'THREADS_APP_SECRET', value: '', description: 'Meta Threads App Secret', isSecret: true, category: 'threads' },
  { id: 'env-4', key: 'THREADS_USER_ID', value: '', description: 'Meta Threads User ID', isSecret: false, category: 'threads' },
  { id: 'env-5', key: 'THREADS_ACCESS_TOKEN', value: '', description: 'Meta Threads Access Token', isSecret: true, category: 'threads' },
  { id: 'env-6', key: 'MASTODON_INSTANCE_URL', value: 'https://mastodon.social', description: 'Target Mastodon URL', isSecret: false, category: 'mastodon' },
  { id: 'env-7', key: 'MASTODON_ACCESS_TOKEN', value: '', description: 'Mastodon Bearer Token', isSecret: true, category: 'mastodon' },
  { id: 'env-8', key: 'BRAND_SIGNATURE', value: 'via BridgeRelay', description: 'Signature for {BRAND_SIGNATURE}', isSecret: false, category: 'template' },
  { id: 'env-9', key: 'UTM_SUFFIX', value: '?utm_source=syndication', description: 'Tracking suffix for {UTM_SUFFIX}', isSecret: false, category: 'template' },
];

export function resolveEnvVariablesInString(input: string, envVars: DashboardEnvVar[]): string {
  if (!input) return '';
  let output = input;
  for (const env of envVars) {
    if (!env.key) continue;
    output = output
      .replace(new RegExp(`\\{\\{${env.key}\\}\\}`, 'g'), env.value)
      .replace(new RegExp(`\\{${env.key}\\}`, 'g'), env.value);
  }
  return output;
}

export function getEnvValue(envVars: DashboardEnvVar[], key: string, fallback = ''): string {
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
    text = text.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*p\s*>/gi, '\n\n').replace(/<\/\s*div\s*>/gi, '\n');
  }
  text = text.replace(/<[^>]+>/g, '');
  const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
  text = text.replace(/&[a-zA-Z0-9#]+;/g, (m) => entities[m] || m);
  return text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n').trim();
}

export function extractImagesFromHtml(html: string): MediaEnclosure[] {
  if (!html) return [];
  const results: MediaEnclosure[] = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    if (url && !url.startsWith('data:')) {
      results.push({ url, mimeType: url.endsWith('.png') ? 'image/png' : 'image/jpeg', source: 'html_img' });
    }
  }
  return results;
}

export function formatHashtags(tags: string[], extraTags: string[]): string {
  return Array.from(new Set([...tags, ...extraTags]))
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)
    .map((t) => `#${t.replace(/[^a-zA-Z0-9_]/g, '')}`)
    .join(' ');
}

export function computeEffectiveLength(text: string, platform: 'mastodon' | 'threads', countUrlAs23: boolean): number {
  if (platform === 'mastodon' && countUrlAs23) {
    return text.replace(/https?:\/\/[^\s]+/g, 'x'.repeat(23)).length;
  }
  return text.length;
}

export function renderFormattedPreview(
  item: NormalizedFeedItem,
  formatting: FormattingConfig,
  platform: 'mastodon' | 'threads',
  envVars: DashboardEnvVar[] = []
): FormattedPayloadPreview {
  const maxChars = platform === 'mastodon' ? formatting.mastodonMaxChars : formatting.threadsMaxChars;
  const countUrlAs23 = platform === 'mastodon' && formatting.mastodonCountUrlAs23Chars;
  const formattedTags = formatHashtags(item.tags, formatting.defaultHashtags);

  const fullText = resolveEnvVariablesInString(formatting.template, envVars)
    .replace(/{title}/g, item.title)
    .replace(/{summary}/g, item.cleanSummary)
    .replace(/{link}/g, item.link)
    .replace(/{author}/g, item.author)
    .replace(/{tags}/g, formattedTags)
    .trim();

  const len = computeEffectiveLength(fullText, platform, countUrlAs23);
  return {
    platform,
    posts: [fullText],
    effectiveCharCounts: [len],
    maxAllowedChars: maxChars,
    wasTruncated: len > maxChars,
    isThreaded: false,
    mediaAttachments: formatting.includeMediaAttachment && item.enclosures ? item.enclosures.slice(0, 4) : [],
  };
}

export const INITIAL_BRIDGE_FEEDS: BridgeFeedSource[] = [
  {
    id: 'feed-github-releases',
    name: 'GitHub Releases Feed',
    bridgeUrl: '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=GithubReleaseBridge&user=RSS-Bridge&repo=rss-bridge&format=Json',
    bridgeName: 'GithubReleaseBridge',
    format: 'Json',
    pollIntervalMinutes: 30,
    initialRunPolicy: 'seed_only',
    enabled: true,
    lastPolledAt: null,
    hasCompletedInitialRun: true,
  },
];

export const INITIAL_NORMALIZED_ITEMS: NormalizedFeedItem[] = [
  {
    guid: 'https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-10-24',
    hashId: computeDeterministicHash('https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-10-24'),
    feedId: 'feed-github-releases',
    feedName: 'GitHub Releases Feed',
    title: 'RSS-Bridge Release: Native JSON Normalizer',
    rawHtml: '<p>Release details for RSS-Bridge.</p>',
    cleanSummary: 'Release details for RSS-Bridge.',
    link: 'https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-10-24',
    author: 'rss-bridge-maintainers',
    publishedAt: '2026-10-26T15:42:00Z',
    tags: ['RSSBridge', 'OpenSource'],
    enclosures: [],
  },
];

export const INITIAL_SEEN_STATE: SeenEntry[] = [];

```

# .ai_backups\20261027_055303_app_api_pipeline_publish_route.ts

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

async function uploadMediaToMastodon(mediaUrl: string, instance: string, token: string): Promise<string> {
  const mediaRes = await fetch(mediaUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BridgeRelay/2.0)', Accept: 'image/*, video/*, */*' },
  });
  if (!mediaRes.ok) throw new Error(`Media download returned HTTP ${mediaRes.status} for ${mediaUrl}`);

  const blob = await mediaRes.blob();
  const ext = (mediaRes.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg';
  const formData = new FormData();
  formData.append('file', blob, `attachment.${ext}`);
  formData.append('description', 'Syndicated via BridgeRelay');

  const uploadRes = await fetch(`${instance}/api/v2/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!uploadRes.ok) throw new Error(`Mastodon upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
  const data = await uploadRes.json();
  return data.id;
}

async function pollThreadsContainerReady(containerId: string, token: string, maxAttempts = 10): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`https://graph.threads.net/v1.0/${containerId}?fields=status,error_message&access_token=${token}`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'FINISHED') return;
      if (data.status === 'ERROR') {
        throw new Error(`Threads container error: ${data.error_message || 'Media processing rejected by Meta'}`);
      }
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: any = await req.json();
    const {
      itemGuid,
      itemTitle = 'Feed Item',
      feedId = 'feed-default',
      platforms = [],
      actionType = 'text',
      mastodonPosts = [],
      threadsPosts = [],
      linkUrl = '',
      mediaUrls = [],
      visibility = 'public',
      credentials,
    } = body;

    const traces: PublishStepTrace[] = [];
    let stepCounter = 1;

    const mastodonInstance = (credentials?.mastodonInstanceUrl || process.env.MASTODON_INSTANCE_URL || 'https://mastodon.social').replace(/\/$/, '');
    const mastodonToken = (credentials?.mastodonAccessToken || process.env.MASTODON_ACCESS_TOKEN || '').trim();
    const threadsUserId = (credentials?.threadsUserId || process.env.THREADS_USER_ID || '').trim();
    const threadsToken = (credentials?.threadsAccessToken || process.env.THREADS_ACCESS_TOKEN || '').trim();

    let publishedMastodonId: string | undefined;
    let publishedThreadsId: string | undefined;

    // Filter out dummy/mock URLs
    const validMediaUrls: string[] = ((mediaUrls as string[]) || []).filter(
      (url: string) => url && typeof url === 'string' && url.startsWith('http') && !url.includes('release-2026-10-arch')
    );

    // 1. Mastodon
    if (platforms.includes('mastodon') && mastodonPosts?.length > 0) {
      if (!mastodonToken) throw new Error('Mastodon access token is missing');
      const uploadedMediaIds: string[] = [];

      if ((actionType === 'image' || actionType === 'video' || actionType === 'carousel') && validMediaUrls.length > 0) {
        const mediaToUpload = actionType === 'carousel' ? validMediaUrls.slice(0, 4) : [validMediaUrls[0]];
        for (const url of mediaToUpload) {
          const t0 = Date.now();
          try {
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
          } catch (mediaErr) {
            traces.push({
              step: stepCounter++,
              platform: 'mastodon',
              actionType,
              endpoint: `${mastodonInstance}/api/v2/media`,
              method: 'POST',
              status: 'error',
              httpStatus: 400,
              requestPayload: { file_url: url },
              responsePayload: { warning: mediaErr instanceof Error ? mediaErr.message : 'Media upload skipped' },
              durationMs: Date.now() - t0,
            });
          }
        }
      }

      let inReplyToId: string | undefined;
      for (let i = 0; i < mastodonPosts.length; i++) {
        const t0 = Date.now();
        const postText = mastodonPosts[i];
        const statusEndpoint = `${mastodonInstance}/api/v1/statuses`;
        const reqPayload: Record<string, unknown> = {
          status: postText,
          visibility,
          ...(i === 0 && uploadedMediaIds.length > 0 ? { media_ids: uploadedMediaIds } : {}),
          ...(inReplyToId ? { in_reply_to_id: inReplyToId } : {}),
        };

        const res = await fetch(statusEndpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${mastodonToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(reqPayload),
        });
        const resData = await res.json();
        if (!res.ok) throw new Error(`Mastodon status error (${res.status}): ${JSON.stringify(resData)}`);

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
      if (!threadsUserId || !threadsToken) throw new Error('Threads User ID or Access Token is missing');

      const containerEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads`;
      const publishEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`;
      const postText = threadsPosts[0];
      let containerIdToPublish = '';
      let requiresPolling = false;

      // Safe Media Check: If media URL exists and is valid
      const hasMedia = (actionType === 'image' || actionType === 'video') && validMediaUrls.length > 0;
      const isImage = actionType === 'image' && hasMedia;
      const isVideo = actionType === 'video' && hasMedia;
      const mediaType = isImage ? 'IMAGE' : isVideo ? 'VIDEO' : 'TEXT';

      if (isImage || isVideo) {
        requiresPolling = true;
      }

      const params = new URLSearchParams({
        media_type: mediaType,
        text: postText,
        access_token: threadsToken,
        ...(actionType === 'link' && linkUrl ? { link_attachment: linkUrl } : {}),
        ...(isImage ? { image_url: validMediaUrls[0] } : {}),
        ...(isVideo ? { video_url: validMediaUrls[0] } : {}),
      });

      const t0 = Date.now();
      let createRes = await fetch(`${containerEndpoint}?${params.toString()}`, { method: 'POST' });
      let createData = await createRes.json();

      // Graceful Auto-Fallback: If Meta rejects the image URL, fall back to TEXT post immediately
      if (!createRes.ok && (isImage || isVideo)) {
        console.warn('Threads media container failed. Falling back to TEXT post:', createData);
        requiresPolling = false;
        const textFallbackParams = new URLSearchParams({
          media_type: 'TEXT',
          text: postText,
          access_token: threadsToken,
        });
        createRes = await fetch(`${containerEndpoint}?${textFallbackParams.toString()}`, { method: 'POST' });
        createData = await createRes.json();
      }

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

      if (requiresPolling) {
        await pollThreadsContainerReady(containerIdToPublish, threadsToken);
      }

      const tPublish = Date.now();
      const pubParams = new URLSearchParams({ creation_id: containerIdToPublish, access_token: threadsToken });
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

    return NextResponse.json({ success: true, executedAt: new Date().toISOString(), traces });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Publish execution failed' },
      { status: 500 }
    );
  }
}
```

# .ai_backups\20261027_055537_lib_pipeline-engine.ts

```ts
export const INITIAL_NORMALIZED_ITEMS: NormalizedFeedItem[] = [
  {
    guid: 'https://www.tiktok.com/@mollynailsind/video/7152249874161945883',
    hashId: computeDeterministicHash('https://www.tiktok.com/@mollynailsind/video/7152249874161945883'),
    feedId: 'tiktok-feed',
    feedName: '@mollynailsind - TikTok',
    title: 'Molly Nails TikTok Video',
    rawHtml: '<p>2.1M views</p>',
    cleanSummary: 'Molly Nails New TikTok Video',
    link: 'https://www.tiktok.com/@mollynailsind/video/7152249874161945883',
    author: '@mollynailsind',
    publishedAt: '2026-10-27T05:27:42Z',
    tags: ['mollynails', 'tiktok', 'nails'],
    enclosures: [],
  },
];
```

# .ai_backups\20261027_055549_app_api_pipeline_poll_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import {
  cleanHtmlToPlainText,
  computeDeterministicHash,
  MediaEnclosure,
  NormalizedFeedItem,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

// Resolves a TikTok web URL into direct MP4 video and cover image URLs
async function resolveTikTokMedia(tiktokUrl: string): Promise<{ videoUrl?: string; coverUrl?: string; title?: string }> {
  try {
    const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BridgeRelay/2.0)' },
    });
    if (!res.ok) return {};
    const json = await res.json();
    if (json.code === 0 && json.data) {
      return {
        videoUrl: json.data.play || json.data.wmplay,
        coverUrl: json.data.cover || json.data.origin_cover,
        title: json.data.title,
      };
    }
  } catch (err) {
    console.warn(`Failed to resolve TikTok media for ${tiktokUrl}:`, err);
  }
  return {};
}

export async function POST(req: NextRequest) {
  try {
    const { feedId = 'tiktok-feed', feedName = 'TikTok Feed', bridgeUrl } = await req.json();
    if (!bridgeUrl) return NextResponse.json({ error: 'bridgeUrl is required' }, { status: 400 });

    const res = await fetch(bridgeUrl, {
      headers: { 'User-Agent': 'BridgeRelay-Pipeline/2.0 (+https://rss-bridge.org)' },
    });
    if (!res.ok) return NextResponse.json({ error: `Bridge returned HTTP ${res.status}` }, { status: 502 });

    const text = await res.text();
    const parsed = xmlParser.parse(text);

    const rawList = parsed?.feed?.entry || parsed?.rss?.channel?.item || [];
    const entries: Record<string, any>[] = Array.isArray(rawList) ? rawList : [rawList];

    // Process items (resolving TikTok MP4 video links)
    const items: NormalizedFeedItem[] = [];

    for (let idx = 0; idx < Math.min(entries.length, 10); idx++) {
      const entry = entries[idx];

      let link = '';
      if (typeof entry.link === 'string') {
        link = entry.link;
      } else if (Array.isArray(entry.link)) {
        const alt = entry.link.find((l: any) => l['@_rel'] === 'alternate');
        link = alt?.['@_href'] || entry.link[0]?.['@_href'] || '';
      } else if (entry.link?.['@_href']) {
        link = entry.link['@_href'];
      }
      if (!link) link = String(entry.id?.['#text'] || entry.id || bridgeUrl);

      const rawTitle = String(entry.title?.['#text'] || entry.title || 'TikTok Video');
      let title = cleanHtmlToPlainText(rawTitle, false);
      const rawHtml = String(entry.content?.['#text'] || entry.content || entry['content:encoded'] || entry.description || '');

      const enclosures: MediaEnclosure[] = [];

      // If it's a TikTok URL, resolve the real MP4 video and high-res cover
      if (link.includes('tiktok.com/')) {
        const resolved = await resolveTikTokMedia(link);
        if (resolved.videoUrl) {
          enclosures.push({
            url: resolved.videoUrl,
            mimeType: 'video/mp4',
            source: 'enclosure',
          });
        }
        if (resolved.coverUrl) {
          enclosures.push({
            url: resolved.coverUrl,
            mimeType: 'image/jpeg',
            source: 'enclosure',
          });
        }
        if (resolved.title) {
          title = resolved.title;
        }
      }

      const guid = String(entry.id?.['#text'] || entry.id || link || `${feedId}-${idx}`);

      items.push({
        guid,
        hashId: computeDeterministicHash(guid),
        feedId,
        feedName,
        title: title.startsWith('http') ? 'TikTok Video' : title,
        rawHtml,
        cleanSummary: title,
        link,
        author: '@mollynailsind',
        publishedAt: String(entry.published || entry.updated || new Date().toISOString()),
        tags: ['TikTok', 'Reel', 'Viral'],
        enclosures,
      });
    }

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to parse feed' }, { status: 500 });
  }
}
```

# .ai_backups\20261027_055557_app_api_pipeline_publish_route.ts

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

// Resolves a TikTok URL to a direct, unwatermarked MP4 video and high-res cover
async function resolveTikTok(url: string): Promise<{ videoUrl?: string; coverUrl?: string; title?: string }> {
  try {
    const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!res.ok) return {};
    const json = await res.json();
    if (json.code === 0 && json.data) {
      const play = json.data.play || json.data.wmplay || '';
      const cover = json.data.cover || json.data.origin_cover || '';
      return {
        videoUrl: play.startsWith('http') ? play : `https://www.tikwm.com${play}`,
        coverUrl: cover.startsWith('http') ? cover : `https://www.tikwm.com${cover}`,
        title: json.data.title || '',
      };
    }
  } catch (e) {
    console.warn('TikTok resolver error:', e);
  }
  return {};
}

async function uploadMediaToMastodon(mediaUrl: string, instance: string, token: string): Promise<string> {
  const mediaRes = await fetch(mediaUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BridgeRelay/2.0)', Accept: 'image/*, video/*, */*' },
  });
  if (!mediaRes.ok) throw new Error(`Media download returned HTTP ${mediaRes.status} for ${mediaUrl}`);

  const blob = await mediaRes.blob();
  const ext = (mediaRes.headers.get('content-type') || '').includes('mp4') ? 'mp4' : 'jpg';
  const formData = new FormData();
  formData.append('file', blob, `attachment.${ext}`);
  formData.append('description', 'Syndicated via BridgeRelay');

  const uploadRes = await fetch(`${instance}/api/v2/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!uploadRes.ok) throw new Error(`Mastodon upload failed: ${await uploadRes.text()}`);
  const data = await uploadRes.json();
  return data.id;
}

async function pollThreadsContainerReady(containerId: string, token: string, maxAttempts = 15): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`https://graph.threads.net/v1.0/${containerId}?fields=status,error_message&access_token=${token}`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'FINISHED') return;
      if (data.status === 'ERROR') {
        throw new Error(`Threads video processing error: ${data.error_message || 'Transcoding failed'}`);
      }
    }
  }
  throw new Error('Threads video processing timed out (longer than 45s)');
}

export async function POST(req: NextRequest) {
  try {
    const body: any = await req.json();
    let {
      itemGuid,
      itemTitle = 'TikTok Video',
      feedId = 'tiktok-feed',
      platforms = [],
      actionType = 'video',
      mastodonPosts = [],
      threadsPosts = [],
      linkUrl = '',
      mediaUrls = [],
      visibility = 'public',
      credentials,
    } = body;

    const traces: PublishStepTrace[] = [];
    let stepCounter = 1;

    const mastodonInstance = (credentials?.mastodonInstanceUrl || process.env.MASTODON_INSTANCE_URL || 'https://mastodon.social').replace(/\/$/, '');
    const mastodonToken = (credentials?.mastodonAccessToken || process.env.MASTODON_ACCESS_TOKEN || '').trim();
    const threadsUserId = (credentials?.threadsUserId || process.env.THREADS_USER_ID || '').trim();
    const threadsToken = (credentials?.threadsAccessToken || process.env.THREADS_ACCESS_TOKEN || '').trim();

    // 1. TIKTOK AUTO-RESOLVER: Convert TikTok web URL into direct MP4 or Cover
    const targetUrl = linkUrl || itemGuid || '';
    if (targetUrl.includes('tiktok.com/')) {
      const resolved = await resolveTikTok(targetUrl);
      if (actionType === 'video' && resolved.videoUrl) {
        mediaUrls = [resolved.videoUrl];
      } else if (actionType === 'image' && resolved.coverUrl) {
        mediaUrls = [resolved.coverUrl];
      }
    }

    // Clean valid media URLs
    const validMediaUrls: string[] = (mediaUrls || []).filter(
      (url: string) => url && typeof url === 'string' && url.startsWith('http') && !url.includes('release-2026-10-arch')
    );

    let publishedMastodonId: string | undefined;
    let publishedThreadsId: string | undefined;

    // 2. Mastodon Publishing
    if (platforms.includes('mastodon') && mastodonPosts?.length > 0) {
      if (!mastodonToken) throw new Error('Mastodon access token is missing');
      const uploadedMediaIds: string[] = [];

      if (validMediaUrls.length > 0) {
        try {
          const t0 = Date.now();
          const mediaId = await uploadMediaToMastodon(validMediaUrls[0], mastodonInstance, mastodonToken);
          uploadedMediaIds.push(mediaId);
          traces.push({
            step: stepCounter++,
            platform: 'mastodon',
            actionType,
            endpoint: `${mastodonInstance}/api/v2/media`,
            method: 'POST',
            status: 'success',
            httpStatus: 200,
            requestPayload: { file_url: validMediaUrls[0] },
            responsePayload: { id: mediaId },
            durationMs: Date.now() - t0,
          });
        } catch (e) {
          console.warn('Mastodon media upload skipped:', e);
        }
      }

      const res = await fetch(`${mastodonInstance}/api/v1/statuses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${mastodonToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: mastodonPosts[0],
          visibility,
          ...(uploadedMediaIds.length > 0 ? { media_ids: uploadedMediaIds } : {}),
        }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(`Mastodon status error: ${JSON.stringify(resData)}`);
      publishedMastodonId = String(resData.id);
    }

    // 3. Meta Threads Publishing
    if (platforms.includes('threads') && threadsPosts?.length > 0) {
      if (!threadsUserId || !threadsToken) throw new Error('Threads User ID or Access Token is missing');

      const containerEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads`;
      const publishEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`;
      const postText = threadsPosts[0];

      const hasVideo = actionType === 'video' && validMediaUrls.length > 0;
      const hasImage = actionType === 'image' && validMediaUrls.length > 0;
      const mediaType = hasVideo ? 'VIDEO' : hasImage ? 'IMAGE' : 'TEXT';

      const params = new URLSearchParams({
        media_type: mediaType,
        text: postText,
        access_token: threadsToken,
        ...(hasVideo ? { video_url: validMediaUrls[0] } : {}),
        ...(hasImage ? { image_url: validMediaUrls[0] } : {}),
        ...(actionType === 'link' && linkUrl ? { link_attachment: linkUrl } : {}),
      });

      const t0 = Date.now();
      const createRes = await fetch(`${containerEndpoint}?${params.toString()}`, { method: 'POST' });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(`Threads container failed: ${JSON.stringify(createData)}`);
      const containerId = createData.id;

      traces.push({
        step: stepCounter++,
        platform: 'threads',
        actionType,
        endpoint: containerEndpoint,
        method: 'POST',
        status: 'success',
        httpStatus: createRes.status,
        requestPayload: { mediaType, textLength: postText.length, media_url: validMediaUrls[0] || 'none' },
        responsePayload: createData,
        durationMs: Date.now() - t0,
      });

      // Video containers MUST be polled until Meta finishes transcoding
      if (hasVideo || hasImage) {
        await pollThreadsContainerReady(containerId, threadsToken);
      }

      // Publish Container
      const tPublish = Date.now();
      const pubParams = new URLSearchParams({ creation_id: containerId, access_token: threadsToken });
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
        requestPayload: { creation_id: containerId },
        responsePayload: pubData,
        durationMs: Date.now() - tPublish,
      });
    }

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

    return NextResponse.json({ success: true, executedAt: new Date().toISOString(), traces });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Publish execution failed' },
      { status: 500 }
    );
  }
}
```

# .ai_backups\20261027_055616_app_api_pipeline_poll_route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import {
  cleanHtmlToPlainText,
  computeDeterministicHash,
  NormalizedFeedItem,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

export async function POST(req: NextRequest) {
  try {
    const { feedId = 'tiktok-feed', feedName = 'TikTok Feed', bridgeUrl } = await req.json();
    if (!bridgeUrl) return NextResponse.json({ error: 'bridgeUrl is required' }, { status: 400 });

    const res = await fetch(bridgeUrl, {
      headers: { 'User-Agent': 'BridgeRelay-Pipeline/2.0 (+https://rss-bridge.org)' },
    });
    if (!res.ok) return NextResponse.json({ error: `Bridge returned HTTP ${res.status}` }, { status: 502 });

    const text = await res.text();
    const parsed = xmlParser.parse(text);

    const rawList = parsed?.feed?.entry || parsed?.rss?.channel?.item || [];
    const entries: Record<string, any>[] = Array.isArray(rawList) ? rawList : [rawList];

    const items: NormalizedFeedItem[] = entries.slice(0, 20).map((entry: Record<string, any>, idx: number) => {
      let link = '';
      if (typeof entry.link === 'string') {
        link = entry.link;
      } else if (Array.isArray(entry.link)) {
        const alt = entry.link.find((l: any) => l['@_rel'] === 'alternate');
        link = alt?.['@_href'] || entry.link[0]?.['@_href'] || '';
      } else if (entry.link?.['@_href']) {
        link = entry.link['@_href'];
      }
      if (!link) link = String(entry.id?.['#text'] || entry.id || bridgeUrl);

      const rawTitle = String(entry.title?.['#text'] || entry.title || 'TikTok Video');
      const title = cleanHtmlToPlainText(rawTitle, false);
      const rawHtml = String(entry.content?.['#text'] || entry.content || entry['content:encoded'] || entry.description || '');

      const guid = String(entry.id?.['#text'] || entry.id || link || `${feedId}-${idx}`);

      return {
        guid,
        hashId: computeDeterministicHash(guid),
        feedId,
        feedName,
        title: title.startsWith('http') ? 'New TikTok Video' : title,
        rawHtml,
        cleanSummary: cleanHtmlToPlainText(rawHtml),
        link,
        author: '@mollynailsind',
        publishedAt: String(entry.published || entry.updated || new Date().toISOString()),
        tags: ['mollynails', 'tiktok', 'nails'],
        enclosures: [],
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to parse feed' }, { status: 500 });
  }
}
```

# .ai_backups\20261027_055626_lib_pipeline-engine.ts

```ts
export type BridgeFormat = 'Json' | 'Atom' | 'Mrss';
export type InitialRunPolicy = 'seed_only' | 'publish_latest_one' | 'publish_all';
export type TruncationStrategy = 'ellipsis' | 'thread_split' | 'title_and_link_only';
export type SocialActionType = 'text' | 'link' | 'image' | 'video' | 'carousel';

export interface DashboardEnvVar {
  id: string;
  key: string;
  value: string;
  description: string;
  isSecret: boolean;
  category: 'rss_bridge' | 'mastodon' | 'threads' | 'template';
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
  status: 'published_both' | 'published_mastodon' | 'published_threads' | 'seeded_initial' | 'filtered_out' | 'queued';
  reason?: string;
  processedAt: string;
  mastodonStatusId?: string;
  threadsPostId?: string;
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
  { id: 'env-1', key: 'RSS_BRIDGE_BASE_URL', value: 'https://rss-bridge.org/bridge01', description: 'Base URL of RSS-Bridge instance', isSecret: false, category: 'rss_bridge' },
  { id: 'env-2', key: 'THREADS_APP_ID', value: '', description: 'Meta Threads App ID', isSecret: false, category: 'threads' },
  { id: 'env-3', key: 'THREADS_APP_SECRET', value: '', description: 'Meta Threads App Secret', isSecret: true, category: 'threads' },
  { id: 'env-4', key: 'THREADS_USER_ID', value: '', description: 'Meta Threads User ID', isSecret: false, category: 'threads' },
  { id: 'env-5', key: 'THREADS_ACCESS_TOKEN', value: '', description: 'Meta Threads Access Token', isSecret: true, category: 'threads' },
  { id: 'env-6', key: 'MASTODON_INSTANCE_URL', value: 'https://mastodon.social', description: 'Target Mastodon URL', isSecret: false, category: 'mastodon' },
  { id: 'env-7', key: 'MASTODON_ACCESS_TOKEN', value: '', description: 'Mastodon Bearer Token', isSecret: true, category: 'mastodon' },
  { id: 'env-8', key: 'BRAND_SIGNATURE', value: 'via BridgeRelay', description: 'Signature for {BRAND_SIGNATURE}', isSecret: false, category: 'template' },
  { id: 'env-9', key: 'UTM_SUFFIX', value: '?utm_source=syndication', description: 'Tracking suffix for {UTM_SUFFIX}', isSecret: false, category: 'template' },
];

export function resolveEnvVariablesInString(input: string, envVars: DashboardEnvVar[]): string {
  if (!input) return '';
  let output = input;
  for (const env of envVars) {
    if (!env.key) continue;
    output = output
      .replace(new RegExp(`\\{\\{${env.key}\\}\\}`, 'g'), env.value)
      .replace(new RegExp(`\\{${env.key}\\}`, 'g'), env.value);
  }
  return output;
}

export function getEnvValue(envVars: DashboardEnvVar[], key: string, fallback = ''): string {
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
    text = text.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*p\s*>/gi, '\n\n').replace(/<\/\s*div\s*>/gi, '\n');
  }
  text = text.replace(/<[^>]+>/g, '');
  const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
  text = text.replace(/&[a-zA-Z0-9#]+;/g, (m) => entities[m] || m);
  return text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n').trim();
}

export function extractImagesFromHtml(html: string): MediaEnclosure[] {
  if (!html) return [];
  const results: MediaEnclosure[] = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    if (url && !url.startsWith('data:')) {
      results.push({ url, mimeType: url.endsWith('.png') ? 'image/png' : 'image/jpeg', source: 'html_img' });
    }
  }
  return results;
}

export function formatHashtags(tags: string[], extraTags: string[]): string {
  return Array.from(new Set([...tags, ...extraTags]))
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)
    .map((t) => `#${t.replace(/[^a-zA-Z0-9_]/g, '')}`)
    .join(' ');
}

export function computeEffectiveLength(text: string, platform: 'mastodon' | 'threads', countUrlAs23: boolean): number {
  if (platform === 'mastodon' && countUrlAs23) {
    return text.replace(/https?:\/\/[^\s]+/g, 'x'.repeat(23)).length;
  }
  return text.length;
}

export function renderFormattedPreview(
  item: NormalizedFeedItem,
  formatting: FormattingConfig,
  platform: 'mastodon' | 'threads',
  envVars: DashboardEnvVar[] = []
): FormattedPayloadPreview {
  const maxChars = platform === 'mastodon' ? formatting.mastodonMaxChars : formatting.threadsMaxChars;
  const countUrlAs23 = platform === 'mastodon' && formatting.mastodonCountUrlAs23Chars;
  const formattedTags = formatHashtags(item.tags, formatting.defaultHashtags);

  const fullText = resolveEnvVariablesInString(formatting.template, envVars)
    .replace(/{title}/g, item.title)
    .replace(/{summary}/g, item.cleanSummary)
    .replace(/{link}/g, item.link)
    .replace(/{author}/g, item.author)
    .replace(/{tags}/g, formattedTags)
    .trim();

  const len = computeEffectiveLength(fullText, platform, countUrlAs23);
  return {
    platform,
    posts: [fullText],
    effectiveCharCounts: [len],
    maxAllowedChars: maxChars,
    wasTruncated: len > maxChars,
    isThreaded: false,
    mediaAttachments: formatting.includeMediaAttachment && item.enclosures ? item.enclosures.slice(0, 4) : [],
  };
}

export const INITIAL_BRIDGE_FEEDS: BridgeFeedSource[] = [
  {
    id: 'feed-tiktok',
    name: '@mollynailsind TikTok Feed',
    bridgeUrl: 'https://rss-bridge.org/bridge01/?action=display&bridge=TikTokBridge&context=By+user&username=mollynailsind&format=Atom',
    bridgeName: 'TikTokBridge',
    format: 'Atom',
    pollIntervalMinutes: 15,
    initialRunPolicy: 'seed_only',
    enabled: true,
    lastPolledAt: null,
    hasCompletedInitialRun: true,
  },
];

// Defaults directly to the user's real TikTok items
export const INITIAL_NORMALIZED_ITEMS: NormalizedFeedItem[] = [
  {
    guid: 'https://www.tiktok.com/@mollynailsind/video/7152249874161945883',
    hashId: computeDeterministicHash('https://www.tiktok.com/@mollynailsind/video/7152249874161945883'),
    feedId: 'tiktok-feed',
    feedName: '@mollynailsind - TikTok',
    title: 'Molly Nails TikTok Video',
    rawHtml: '<p>2.1M views</p>',
    cleanSummary: 'Molly Nails New TikTok Video',
    link: 'https://www.tiktok.com/@mollynailsind/video/7152249874161945883',
    author: '@mollynailsind',
    publishedAt: '2026-10-27T05:27:42Z',
    tags: ['mollynails', 'tiktok', 'nails'],
    enclosures: [],
  },
  {
    guid: 'https://www.tiktok.com/@mollynailsind/video/7631412125260352788',
    hashId: computeDeterministicHash('https://www.tiktok.com/@mollynailsind/video/7631412125260352788'),
    feedId: 'tiktok-feed',
    feedName: '@mollynailsind - TikTok',
    title: 'Molly Nails TikTok Video 2',
    rawHtml: '<p>13.6K views</p>',
    cleanSummary: 'Molly Nails New TikTok Video',
    link: 'https://www.tiktok.com/@mollynailsind/video/7631412125260352788',
    author: '@mollynailsind',
    publishedAt: '2026-10-27T05:27:42Z',
    tags: ['mollynails', 'tiktok', 'nails'],
    enclosures: [],
  },
];

export const INITIAL_SEEN_STATE: SeenEntry[] = [];
```

# .ai_backups\20261027_055630_lib_pipeline-engine.ts

```ts
export type BridgeFormat = 'Json' | 'Atom' | 'Mrss';
export type InitialRunPolicy = 'seed_only' | 'publish_latest_one' | 'publish_all';
export type TruncationStrategy = 'ellipsis' | 'thread_split' | 'title_and_link_only';
export type SocialActionType = 'text' | 'link' | 'image' | 'video' | 'carousel';

export interface DashboardEnvVar {
  id: string;
  key: string;
  value: string;
  description: string;
  isSecret: boolean;
  category: 'rss_bridge' | 'mastodon' | 'threads' | 'template';
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
  status: 'published_both' | 'published_mastodon' | 'published_threads' | 'seeded_initial' | 'filtered_out' | 'queued';
  reason?: string;
  processedAt: string;
  mastodonStatusId?: string;
  threadsPostId?: string;
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
  { id: 'env-1', key: 'RSS_BRIDGE_BASE_URL', value: 'https://rss-bridge.org/bridge01', description: 'Base URL of RSS-Bridge instance', isSecret: false, category: 'rss_bridge' },
  { id: 'env-2', key: 'THREADS_APP_ID', value: '', description: 'Meta Threads App ID', isSecret: false, category: 'threads' },
  { id: 'env-3', key: 'THREADS_APP_SECRET', value: '', description: 'Meta Threads App Secret', isSecret: true, category: 'threads' },
  { id: 'env-4', key: 'THREADS_USER_ID', value: '', description: 'Meta Threads User ID', isSecret: false, category: 'threads' },
  { id: 'env-5', key: 'THREADS_ACCESS_TOKEN', value: '', description: 'Meta Threads Access Token', isSecret: true, category: 'threads' },
  { id: 'env-6', key: 'MASTODON_INSTANCE_URL', value: 'https://mastodon.social', description: 'Target Mastodon URL', isSecret: false, category: 'mastodon' },
  { id: 'env-7', key: 'MASTODON_ACCESS_TOKEN', value: '', description: 'Mastodon Bearer Token', isSecret: true, category: 'mastodon' },
  { id: 'env-8', key: 'BRAND_SIGNATURE', value: 'via BridgeRelay', description: 'Signature for {BRAND_SIGNATURE}', isSecret: false, category: 'template' },
  { id: 'env-9', key: 'UTM_SUFFIX', value: '?utm_source=syndication', description: 'Tracking suffix for {UTM_SUFFIX}', isSecret: false, category: 'template' },
];

export function resolveEnvVariablesInString(input: string, envVars: DashboardEnvVar[]): string {
  if (!input) return '';
  let output = input;
  for (const env of envVars) {
    if (!env.key) continue;
    output = output
      .replace(new RegExp(`\\{\\{${env.key}\\}\\}`, 'g'), env.value)
      .replace(new RegExp(`\\{${env.key}\\}`, 'g'), env.value);
  }
  return output;
}

export function getEnvValue(envVars: DashboardEnvVar[], key: string, fallback = ''): string {
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
    text = text.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*p\s*>/gi, '\n\n').replace(/<\/\s*div\s*>/gi, '\n');
  }
  text = text.replace(/<[^>]+>/g, '');
  const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
  text = text.replace(/&[a-zA-Z0-9#]+;/g, (m) => entities[m] || m);
  return text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n').trim();
}

export function extractImagesFromHtml(html: string): MediaEnclosure[] {
  if (!html) return [];
  const results: MediaEnclosure[] = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    if (url && !url.startsWith('data:')) {
      results.push({ url, mimeType: url.endsWith('.png') ? 'image/png' : 'image/jpeg', source: 'html_img' });
    }
  }
  return results;
}

export function formatHashtags(tags: string[], extraTags: string[]): string {
  return Array.from(new Set([...tags, ...extraTags]))
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)
    .map((t) => `#${t.replace(/[^a-zA-Z0-9_]/g, '')}`)
    .join(' ');
}

export function computeEffectiveLength(text: string, platform: 'mastodon' | 'threads', countUrlAs23: boolean): number {
  if (platform === 'mastodon' && countUrlAs23) {
    return text.replace(/https?:\/\/[^\s]+/g, 'x'.repeat(23)).length;
  }
  return text.length;
}

export function renderFormattedPreview(
  item: NormalizedFeedItem,
  formatting: FormattingConfig,
  platform: 'mastodon' | 'threads',
  envVars: DashboardEnvVar[] = []
): FormattedPayloadPreview {
  const maxChars = platform === 'mastodon' ? formatting.mastodonMaxChars : formatting.threadsMaxChars;
  const countUrlAs23 = platform === 'mastodon' && formatting.mastodonCountUrlAs23Chars;
  const formattedTags = formatHashtags(item.tags, formatting.defaultHashtags);

  const fullText = resolveEnvVariablesInString(formatting.template, envVars)
    .replace(/{title}/g, item.title)
    .replace(/{summary}/g, item.cleanSummary)
    .replace(/{link}/g, item.link)
    .replace(/{author}/g, item.author)
    .replace(/{tags}/g, formattedTags)
    .trim();

  const len = computeEffectiveLength(fullText, platform, countUrlAs23);
  return {
    platform,
    posts: [fullText],
    effectiveCharCounts: [len],
    maxAllowedChars: maxChars,
    wasTruncated: len > maxChars,
    isThreaded: false,
    mediaAttachments: formatting.includeMediaAttachment && item.enclosures ? item.enclosures.slice(0, 4) : [],
  };
}

export const INITIAL_BRIDGE_FEEDS: BridgeFeedSource[] = [
  {
    id: 'feed-tiktok',
    name: '@mollynailsind TikTok Feed',
    bridgeUrl: 'https://rss-bridge.org/bridge01/?action=display&bridge=TikTokBridge&context=By+user&username=mollynailsind&format=Atom',
    bridgeName: 'TikTokBridge',
    format: 'Atom',
    pollIntervalMinutes: 15,
    initialRunPolicy: 'seed_only',
    enabled: true,
    lastPolledAt: null,
    hasCompletedInitialRun: true,
  },
];

// Defaults directly to the user's real TikTok items
export const INITIAL_NORMALIZED_ITEMS: NormalizedFeedItem[] = [
  {
    guid: 'https://www.tiktok.com/@mollynailsind/video/7152249874161945883',
    hashId: computeDeterministicHash('https://www.tiktok.com/@mollynailsind/video/7152249874161945883'),
    feedId: 'tiktok-feed',
    feedName: '@mollynailsind - TikTok',
    title: 'Molly Nails TikTok Video',
    rawHtml: '<p>2.1M views</p>',
    cleanSummary: 'Molly Nails New TikTok Video',
    link: 'https://www.tiktok.com/@mollynailsind/video/7152249874161945883',
    author: '@mollynailsind',
    publishedAt: '2026-10-27T05:27:42Z',
    tags: ['mollynails', 'tiktok', 'nails'],
    enclosures: [],
  },
  {
    guid: 'https://www.tiktok.com/@mollynailsind/video/7631412125260352788',
    hashId: computeDeterministicHash('https://www.tiktok.com/@mollynailsind/video/7631412125260352788'),
    feedId: 'tiktok-feed',
    feedName: '@mollynailsind - TikTok',
    title: 'Molly Nails TikTok Video 2',
    rawHtml: '<p>13.6K views</p>',
    cleanSummary: 'Molly Nails New TikTok Video',
    link: 'https://www.tiktok.com/@mollynailsind/video/7631412125260352788',
    author: '@mollynailsind',
    publishedAt: '2026-10-27T05:27:42Z',
    tags: ['mollynails', 'tiktok', 'nails'],
    enclosures: [],
  },
];

export const INITIAL_SEEN_STATE: SeenEntry[] = [];
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

# app\api\auth\threads\callback\route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  let code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error || !code) {
    return new NextResponse('<script>window.close();</script>', { headers: { 'Content-Type': 'text/html' } });
  }

  code = code.replace(/#_$/, '');
  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const redirectUri = `${protocol}://${host}/api/auth/threads/callback`;

  try {
    const tokenRes = await fetch('https://graph.threads.net/oauth/access_token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: process.env.THREADS_APP_ID || '',
        client_secret: process.env.THREADS_APP_SECRET || '',
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    const userId = String(tokenData.user_id);
    const accessToken = tokenData.access_token;

    return new NextResponse(
      `<script>
        if (window.opener) {
          window.opener.postMessage({ type: 'THREADS_AUTH_SUCCESS', userId: '${userId}', accessToken: '${accessToken}' }, '*');
          window.close();
        }
      </script>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  } catch {
    return new NextResponse('<script>window.close();</script>', { headers: { 'Content-Type': 'text/html' } });
  }
}

```

# app\api\pipeline\poll\route.ts

```ts
import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import {
  cleanHtmlToPlainText,
  computeDeterministicHash,
  NormalizedFeedItem,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

export async function POST(req: NextRequest) {
  try {
    const { feedId = 'tiktok-feed', feedName = 'TikTok Feed', bridgeUrl } = await req.json();
    if (!bridgeUrl) return NextResponse.json({ error: 'bridgeUrl is required' }, { status: 400 });

    const res = await fetch(bridgeUrl, {
      headers: { 'User-Agent': 'BridgeRelay-Pipeline/2.0 (+https://rss-bridge.org)' },
    });
    if (!res.ok) return NextResponse.json({ error: `Bridge returned HTTP ${res.status}` }, { status: 502 });

    const text = await res.text();
    const parsed = xmlParser.parse(text);

    const rawList = parsed?.feed?.entry || parsed?.rss?.channel?.item || [];
    const entries: Record<string, any>[] = Array.isArray(rawList) ? rawList : [rawList];

    const items: NormalizedFeedItem[] = entries.slice(0, 20).map((entry: Record<string, any>, idx: number) => {
      let link = '';
      if (typeof entry.link === 'string') {
        link = entry.link;
      } else if (Array.isArray(entry.link)) {
        const alt = entry.link.find((l: any) => l['@_rel'] === 'alternate');
        link = alt?.['@_href'] || entry.link[0]?.['@_href'] || '';
      } else if (entry.link?.['@_href']) {
        link = entry.link['@_href'];
      }
      if (!link) link = String(entry.id?.['#text'] || entry.id || bridgeUrl);

      const rawTitle = String(entry.title?.['#text'] || entry.title || 'TikTok Video');
      const title = cleanHtmlToPlainText(rawTitle, false);
      const rawHtml = String(entry.content?.['#text'] || entry.content || entry['content:encoded'] || entry.description || '');

      const guid = String(entry.id?.['#text'] || entry.id || link || `${feedId}-${idx}`);

      return {
        guid,
        hashId: computeDeterministicHash(guid),
        feedId,
        feedName,
        title: title.startsWith('http') ? 'New TikTok Video' : title,
        rawHtml,
        cleanSummary: cleanHtmlToPlainText(rawHtml),
        link,
        author: '@mollynailsind',
        publishedAt: String(entry.published || entry.updated || new Date().toISOString()),
        tags: ['mollynails', 'tiktok', 'nails'],
        enclosures: [],
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to parse feed' }, { status: 500 });
  }
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

// Automatically resolves any TikTok web URL into a direct, unwatermarked MP4 file
async function resolveTikTok(url: string): Promise<{ videoUrl?: string; coverUrl?: string; title?: string }> {
  try {
    const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!res.ok) return {};
    const json = await res.json();
    if (json.code === 0 && json.data) {
      const play = json.data.play || json.data.wmplay || '';
      const cover = json.data.cover || json.data.origin_cover || '';
      return {
        videoUrl: play.startsWith('http') ? play : `https://www.tikwm.com${play}`,
        coverUrl: cover.startsWith('http') ? cover : `https://www.tikwm.com${cover}`,
        title: json.data.title || '',
      };
    }
  } catch (e) {
    console.warn('TikTok resolver failed:', e);
  }
  return {};
}

async function uploadMediaToMastodon(mediaUrl: string, instance: string, token: string): Promise<string> {
  const mediaRes = await fetch(mediaUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BridgeRelay/2.0)', Accept: 'image/*, video/*, */*' },
  });
  if (!mediaRes.ok) throw new Error(`Media download returned HTTP ${mediaRes.status} for ${mediaUrl}`);

  const blob = await mediaRes.blob();
  const ext = (mediaRes.headers.get('content-type') || '').includes('mp4') ? 'mp4' : 'jpg';
  const formData = new FormData();
  formData.append('file', blob, `attachment.${ext}`);
  formData.append('description', 'Syndicated via BridgeRelay');

  const uploadRes = await fetch(`${instance}/api/v2/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!uploadRes.ok) throw new Error(`Mastodon upload failed: ${await uploadRes.text()}`);
  const data = await uploadRes.json();
  return data.id;
}

async function pollThreadsContainerReady(containerId: string, token: string, maxAttempts = 15): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`https://graph.threads.net/v1.0/${containerId}?fields=status,error_message&access_token=${token}`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'FINISHED') return;
      if (data.status === 'ERROR') {
        throw new Error(`Threads video processing error: ${data.error_message || 'Transcoding failed'}`);
      }
    }
  }
  throw new Error('Threads video processing timed out (longer than 45s)');
}

export async function POST(req: NextRequest) {
  try {
    const body: any = await req.json();
    let {
      itemGuid,
      itemTitle = 'TikTok Video',
      feedId = 'tiktok-feed',
      platforms = [],
      actionType = 'video',
      mastodonPosts = [],
      threadsPosts = [],
      linkUrl = '',
      mediaUrls = [],
      visibility = 'public',
      credentials,
    } = body;

    const traces: PublishStepTrace[] = [];
    let stepCounter = 1;

    const mastodonInstance = (credentials?.mastodonInstanceUrl || process.env.MASTODON_INSTANCE_URL || 'https://mastodon.social').replace(/\/$/, '');
    const mastodonToken = (credentials?.mastodonAccessToken || process.env.MASTODON_ACCESS_TOKEN || '').trim();
    const threadsUserId = (credentials?.threadsUserId || process.env.THREADS_USER_ID || '').trim();
    const threadsToken = (credentials?.threadsAccessToken || process.env.THREADS_ACCESS_TOKEN || '').trim();

    // AUTO-RESOLVE TIKTOK: Convert the web link to a playable .mp4 URL
    const targetUrl = linkUrl || itemGuid || '';
    if (targetUrl.includes('tiktok.com/')) {
      const resolved = await resolveTikTok(targetUrl);
      if (actionType === 'video' && resolved.videoUrl) {
        mediaUrls = [resolved.videoUrl];
      } else if (actionType === 'image' && resolved.coverUrl) {
        mediaUrls = [resolved.coverUrl];
      }
    }

    const validMediaUrls: string[] = (mediaUrls || []).filter(
      (url: string) => url && typeof url === 'string' && url.startsWith('http') && !url.includes('release-2026-10-arch')
    );

    let publishedMastodonId: string | undefined;
    let publishedThreadsId: string | undefined;

    // 1. Mastodon
    if (platforms.includes('mastodon') && mastodonPosts?.length > 0) {
      if (!mastodonToken) throw new Error('Mastodon access token is missing');
      const uploadedMediaIds: string[] = [];

      if (validMediaUrls.length > 0) {
        try {
          const t0 = Date.now();
          const mediaId = await uploadMediaToMastodon(validMediaUrls[0], mastodonInstance, mastodonToken);
          uploadedMediaIds.push(mediaId);
          traces.push({
            step: stepCounter++,
            platform: 'mastodon',
            actionType,
            endpoint: `${mastodonInstance}/api/v2/media`,
            method: 'POST',
            status: 'success',
            httpStatus: 200,
            requestPayload: { file_url: validMediaUrls[0] },
            responsePayload: { id: mediaId },
            durationMs: Date.now() - t0,
          });
        } catch (e) {
          console.warn('Mastodon media upload skipped:', e);
        }
      }

      const res = await fetch(`${mastodonInstance}/api/v1/statuses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${mastodonToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: mastodonPosts[0],
          visibility,
          ...(uploadedMediaIds.length > 0 ? { media_ids: uploadedMediaIds } : {}),
        }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(`Mastodon status error: ${JSON.stringify(resData)}`);
      publishedMastodonId = String(resData.id);
    }

    // 2. Meta Threads
    if (platforms.includes('threads') && threadsPosts?.length > 0) {
      if (!threadsUserId || !threadsToken) throw new Error('Threads User ID or Access Token is missing');

      const containerEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads`;
      const publishEndpoint = `https://graph.threads.net/v1.0/${threadsUserId}/threads_publish`;
      const postText = threadsPosts[0];

      const hasVideo = actionType === 'video' && validMediaUrls.length > 0;
      const hasImage = actionType === 'image' && validMediaUrls.length > 0;
      const mediaType = hasVideo ? 'VIDEO' : hasImage ? 'IMAGE' : 'TEXT';

      const params = new URLSearchParams({
        media_type: mediaType,
        text: postText,
        access_token: threadsToken,
        ...(hasVideo ? { video_url: validMediaUrls[0] } : {}),
        ...(hasImage ? { image_url: validMediaUrls[0] } : {}),
        ...(actionType === 'link' && linkUrl ? { link_attachment: linkUrl } : {}),
      });

      const t0 = Date.now();
      const createRes = await fetch(`${containerEndpoint}?${params.toString()}`, { method: 'POST' });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(`Threads container failed: ${JSON.stringify(createData)}`);
      const containerId = createData.id;

      traces.push({
        step: stepCounter++,
        platform: 'threads',
        actionType,
        endpoint: containerEndpoint,
        method: 'POST',
        status: 'success',
        httpStatus: createRes.status,
        requestPayload: { mediaType, textLength: postText.length, media_url: validMediaUrls[0] || 'none' },
        responsePayload: createData,
        durationMs: Date.now() - t0,
      });

      if (hasVideo || hasImage) {
        await pollThreadsContainerReady(containerId, threadsToken);
      }

      const tPublish = Date.now();
      const pubParams = new URLSearchParams({ creation_id: containerId, access_token: threadsToken });
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
        requestPayload: { creation_id: containerId },
        responsePayload: pubData,
        durationMs: Date.now() - tPublish,
      });
    }

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

    return NextResponse.json({ success: true, executedAt: new Date().toISOString(), traces });
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
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  RefreshCw,
  Rss,
  Send,
  XCircle,
} from 'lucide-react';
import {
  DashboardEnvVar,
  FormattingConfig,
  getEnvValue,
  INITIAL_DASHBOARD_ENV_VARS,
  INITIAL_NORMALIZED_ITEMS,
  INITIAL_SEEN_STATE,
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
    threadsDescription: 'Publishes an automated text-only post to Meta Threads.',
    mastodonDescription: 'Publishes an automated status post to Mastodon.',
    defaultTemplate: '{title}\n\n{summary}\n\n{tags}',
  },
  {
    id: 'link',
    title: 'Create a link post',
    threadsDescription: 'Creates a rich link post on Threads with interactive preview card.',
    mastodonDescription: 'Publishes status with sanitized shortlink and hashtags to Mastodon.',
    defaultTemplate: '{title}\n\n{summary}\n\n{link}{UTM_SUFFIX}',
  },
  {
    id: 'image',
    title: 'Create an image post',
    threadsDescription: 'Uploads and attaches the feed enclosure or extracted inline image.',
    mastodonDescription: 'Uploads media via Mastodon /api/v2/media and attaches to the status.',
    defaultTemplate: '{title}\n\n{link}\n{tags}',
  },
  {
    id: 'video',
    title: 'Create a video post',
    threadsDescription: 'Publishes video media container to Meta Threads.',
    mastodonDescription: 'Uploads video attachment to Mastodon with auto-fallback.',
    defaultTemplate: '{title} — Watch via {source}\n\n{link}\n{tags}',
  },
  {
    id: 'carousel',
    title: 'Create a carousel post',
    threadsDescription: 'Attaches 2 to 5 slides using Threads parent/child carousel containers.',
    mastodonDescription: 'Attaches up to 4 media items to a single Mastodon status.',
    defaultTemplate: '{title}\n\n{summary}\n\n{link}\n{tags}',
  },
];

const QUICK_BRIDGE_EXAMPLES = [
  {
    label: 'GitHub Releases Bridge',
    url: '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=GithubReleaseBridge&user=RSS-Bridge&repo=rss-bridge&format=Json',
  },
  {
    label: 'Hacker News Bridge',
    url: '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=HackerNewsBridge&area=newest&min_score=150&format=Atom',
  },
  {
    label: 'YouTube Channel Bridge',
    url: '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=YoutubeBridge&context=By+username&u=fireship&format=Mrss',
  },
  {
    label: 'TikTok Bridge',
    url: '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=TikTokBridge&context=By+user&username=funnykittenstok&format=Atom',
  },
];

const STORAGE_KEY_ENV = 'bridgerelay_ifttt_env_v5';
const STORAGE_KEY_TRIGGER_URL = 'bridgerelay_ifttt_trigger_url_v5';

export default function BridgeRelayStudio() {
  const [viewMode, setViewMode] = useState<IftttViewMode>('applet_home');
  const [activeServiceTab, setActiveServiceTab] = useState<'threads' | 'mastodon' | 'both'>('both');

  const [triggerFeedUrl, setTriggerFeedUrl] = useState<string>(
    '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=GithubReleaseBridge&user=RSS-Bridge&repo=rss-bridge&format=Json'
  );
  const [showUrlHelper, setShowUrlHelper] = useState<boolean>(false);

  const [selectedActionType, setSelectedActionType] = useState<SocialActionType>('text');
  const [actionLinkUrl, setActionLinkUrl] = useState<string>('{link}');
  const [actionMediaUrl, setActionMediaUrl] = useState<string>('');
  const [actionCarouselUrls, setActionCarouselUrls] = useState<string>('');

  const [envVars, setEnvVars] = useState<DashboardEnvVar[]>(INITIAL_DASHBOARD_ENV_VARS);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  const [statusBanner, setStatusBanner] = useState<string>('');

  const [items, setItems] = useState<NormalizedFeedItem[]>(INITIAL_NORMALIZED_ITEMS);
  const [selectedItemGuid, setSelectedItemGuid] = useState<string>(INITIAL_NORMALIZED_ITEMS[0]?.guid || '');
  const [seenLedger, setSeenLedger] = useState<SeenEntry[]>(INITIAL_SEEN_STATE);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [isConnectingThreads, setIsConnectingThreads] = useState<boolean>(false);

  const [verifyStatus, setVerifyStatus] = useState<Record<string, { loading: boolean; verified?: boolean; message?: string }>>({});

  const [formatting, setFormatting] = useState<FormattingConfig>({
    template: '{title}\n\n{summary}\n\n{link}\n{tags}',
    mastodonMaxChars: 500,
    threadsMaxChars: 500,
    mastodonCountUrlAs23Chars: true,
    truncationStrategy: 'ellipsis',
    includeMediaAttachment: true,
    defaultHashtags: ['RSSBridge', 'Syndication'],
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

  useEffect(() => {
    const handleAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === 'THREADS_AUTH_SUCCESS') {
        const { userId, accessToken, username } = event.data;
        updateAndSaveEnvVars((prev) =>
          prev.map((item) => {
            if (item.key === 'THREADS_USER_ID') return { ...item, value: userId };
            if (item.key === 'THREADS_ACCESS_TOKEN') return { ...item, value: accessToken };
            return item;
          })
        );
        setIsConnectingThreads(false);
        setVerifyStatus((s) => ({
          ...s,
          threads: { loading: false, verified: true, message: `Connected as @${username}` },
        }));
        setStatusBanner(`Success! Connected Threads account @${username}`);
      } else if (event.data?.type === 'THREADS_AUTH_ERROR') {
        setIsConnectingThreads(false);
        setStatusBanner(`Threads connection error: ${event.data.error}`);
      }
    };

    window.addEventListener('message', handleAuthMessage);
    return () => window.removeEventListener('message', handleAuthMessage);
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
    setStatusBanner('Saved changes');
    setTimeout(() => setStatusBanner(''), 2500);
  };

  const threadsAppId = getEnvValue(envVars, 'THREADS_APP_ID', '');
  const threadsUserId = getEnvValue(envVars, 'THREADS_USER_ID', '');

  const handleConnectThreads = () => {
    if (!threadsAppId) {
      alert('Please enter your THREADS_APP_ID in the Credentials tab first.');
      setViewMode('connections');
      return;
    }

    setIsConnectingThreads(true);
    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    const popup = window.open(
      `/api/auth/threads/login?client_id=${threadsAppId}`,
      'ThreadsAuthorization',
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,resizable=yes`
    );

    const checkClosed = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(checkClosed);
        setIsConnectingThreads(false);
      }
    }, 1000);
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
    setStatusBanner(`Polling live bridge feed...`);

    try {
      const res = await fetch('/api/pipeline/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedId: 'active-trigger-feed',
          feedName: 'RSS-Bridge Feed',
          bridgeUrl: resolvedUrl,
        }),
      });

      const data = await res.json();
      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        const incoming: NormalizedFeedItem[] = data.items;
        setItems(incoming);
        setSelectedItemGuid(incoming[0].guid);
        setStatusBanner(`Success: Loaded ${incoming.length} items`);
      } else {
        setStatusBanner(data.error ? `Notice: ${data.error}` : 'Feed checked (0 items returned)');
      }
      setViewMode('applet_home');
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Failed to reach feed URL');
      setViewMode('applet_home');
    } finally {
      setIsPolling(false);
    }
  };

  const handleVerifyCredential = async (platform: 'mastodon' | 'threads') => {
    setVerifyStatus((s) => ({ ...s, [platform]: { loading: true } }));
    try {
      const res = await fetch('/api/pipeline/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          mastodonInstanceUrl: getEnvValue(envVars, 'MASTODON_INSTANCE_URL', 'https://mastodon.social'),
          mastodonAccessToken: getEnvValue(envVars, 'MASTODON_ACCESS_TOKEN', ''),
          threadsUserId: getEnvValue(envVars, 'THREADS_USER_ID', ''),
          threadsAccessToken: getEnvValue(envVars, 'THREADS_ACCESS_TOKEN', ''),
        }),
      });
      const data = await res.json();
      if (data.verified) {
        setVerifyStatus((s) => ({
          ...s,
          [platform]: { loading: false, verified: true, message: `Connected as ${data.handle}` },
        }));
      } else {
        setVerifyStatus((s) => ({
          ...s,
          [platform]: { loading: false, verified: false, message: data.message || 'Verification failed' },
        }));
      }
    } catch (err) {
      setVerifyStatus((s) => ({
        ...s,
        [platform]: { loading: false, verified: false, message: err instanceof Error ? err.message : 'Error' },
      }));
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
        : selectedItem.enclosures && selectedItem.enclosures.length > 0
          ? selectedItem.enclosures.map((e) => e.url)
          : actionMediaUrl
            ? [actionMediaUrl]
            : [];

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
            status:
              platforms.length === 2
                ? 'published_both'
                : platforms[0] === 'mastodon'
                  ? 'published_mastodon'
                  : 'published_threads',
            reason: `Published via "${currentActionDefinition.title}" (${data.traces.length} steps)`,
            processedAt: new Date().toISOString(),
          },
          ...prev.filter((s) => s.guid !== selectedItem.guid),
        ]);
        setStatusBanner(`Syndicated to ${platforms.join(' & ')} successfully!`);
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
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-6 lg:px-10 py-3 bg-white border-b border-slate-200">
        <div className="flex items-center gap-3">
          <a
            href="#home"
            onClick={(e) => {
              e.preventDefault();
              setViewMode('applet_home');
            }}
            className="text-lg font-black tracking-tight text-slate-950 flex items-center gap-2"
          >
            <span className="w-8 h-8 rounded-xl bg-orange-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
              BR
            </span>
            BridgeRelay
          </a>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-xs font-bold text-slate-600">
          <button
            type="button"
            onClick={() => setViewMode('applet_home')}
            className={`py-1 border-b-2 transition ${viewMode === 'applet_home' ? 'border-slate-900 text-slate-950' : 'border-transparent hover:text-slate-900'}`}
          >
            Applet
          </button>
          <button
            type="button"
            onClick={() => setViewMode('edit_trigger')}
            className={`py-1 border-b-2 transition ${viewMode === 'edit_trigger' ? 'border-orange-600 text-orange-600' : 'border-transparent hover:text-slate-900'}`}
          >
            Trigger (RSS)
          </button>
          <button
            type="button"
            onClick={() => setViewMode('choose_action')}
            className={`py-1 border-b-2 transition ${viewMode === 'choose_action' ? 'border-slate-900 text-slate-950' : 'border-transparent hover:text-slate-900'}`}
          >
            Actions
          </button>
          <button
            type="button"
            onClick={() => setViewMode('edit_action')}
            className={`py-1 border-b-2 transition ${viewMode === 'edit_action' ? 'border-slate-900 text-slate-950' : 'border-transparent hover:text-slate-900'}`}
          >
            Template
          </button>
          <button
            type="button"
            onClick={() => setViewMode('connections')}
            className={`py-1 border-b-2 transition ${viewMode === 'connections' ? 'border-slate-900 text-slate-950' : 'border-transparent hover:text-slate-900'}`}
          >
            Credentials & OAuth
          </button>
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleConnectThreads}
            disabled={isConnectingThreads}
            className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 border shadow-sm transition ${
              threadsUserId
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                : 'bg-black text-white border-black hover:bg-neutral-800'
            }`}
          >
            <span className="font-extrabold text-xs">@</span>
            <span>
              {isConnectingThreads
                ? 'Connecting...'
                : threadsUserId
                  ? 'Threads Connected'
                  : 'Connect Threads'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleRunAppletNow}
            disabled={isPublishing}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-slate-900 rounded-full hover:bg-slate-800 disabled:opacity-50 shadow-sm"
          >
            {isPublishing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            <span>{isPublishing ? 'Publishing...' : 'Run Now'}</span>
          </button>
        </div>
      </header>

      {statusBanner && (
        <div className="bg-slate-900 text-white text-xs font-semibold text-center py-2 px-4 border-b border-slate-800">
          {statusBanner}
        </div>
      )}

      {/* VIEW: TRIGGER */}
      {viewMode === 'edit_trigger' && (
        <div className="flex-1 bg-gradient-to-b from-[#EA7600] to-[#C95B00] text-white flex flex-col items-center justify-center px-6 py-12">
          <div className="w-full max-w-xl mx-auto flex flex-col items-center">
            <div className="w-full flex items-center justify-start mb-6">
              <button
                type="button"
                onClick={() => setViewMode('applet_home')}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-white/80 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Applet</span>
              </button>
            </div>

            <div className="w-16 h-16 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center mb-4">
              <Rss className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-black text-center mb-1">Edit RSS Trigger</h1>
            <p className="text-xs text-white/80 mb-6 text-center max-w-md">
              Enter your live RSS-Bridge feed URL (Atom, MRSS, or JSON format supported)
            </p>

            <form onSubmit={handleUpdateTrigger} className="w-full space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-white/80 mb-2">
                  Feed URL
                </label>
                <textarea
                  rows={4}
                  required
                  value={triggerFeedUrl}
                  onChange={(e) => setTriggerFeedUrl(e.target.value)}
                  className="w-full bg-white text-slate-900 rounded-xl p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-white"
                />
                <button
                  type="button"
                  onClick={() => setShowUrlHelper((v) => !v)}
                  className="mt-2 text-xs font-bold underline text-white/90 hover:text-white"
                >
                  {showUrlHelper ? 'Hide Presets' : 'Choose from Bridge Presets'}
                </button>
              </div>

              {showUrlHelper && (
                <div className="bg-black/25 rounded-xl p-3 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {QUICK_BRIDGE_EXAMPLES.map((ex) => (
                      <button
                        key={ex.label}
                        type="button"
                        onClick={() => setTriggerFeedUrl(ex.url)}
                        className="px-2.5 py-1 text-xs font-bold bg-white text-slate-900 rounded-lg hover:bg-slate-100"
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
                  className="bg-white text-slate-950 font-black text-sm px-8 py-3 rounded-full hover:bg-slate-100 shadow-md disabled:opacity-60"
                >
                  {isPolling ? 'Fetching Feed...' : 'Save & Check Feed'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW: CHOOSE ACTION */}
      {viewMode === 'choose_action' && (
        <div className="flex-1 flex flex-col bg-white">
          <div className="bg-slate-900 text-white pt-8 pb-10 px-6 flex flex-col items-center">
            <div className="flex items-center gap-1 bg-white/10 p-1 rounded-full mb-6 text-xs font-bold">
              {(['both', 'threads', 'mastodon'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveServiceTab(tab)}
                  className={`px-4 py-1.5 rounded-full capitalize transition ${
                    activeServiceTab === tab ? 'bg-white text-slate-950 shadow-sm' : 'text-white/70 hover:text-white'
                  }`}
                >
                  {tab === 'both' ? 'Both Destinations' : tab}
                </button>
              ))}
            </div>

            <h1 className="text-2xl font-black capitalize">
              {activeServiceTab === 'both' ? 'Cross-Post Actions' : `${activeServiceTab} Actions`}
            </h1>
            <p className="text-xs text-slate-400 mt-1">Select the action type to syndicate feed items</p>
          </div>

          <div className="max-w-4xl w-full mx-auto px-6 py-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {ACTION_CARDS.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => {
                    setSelectedActionType(card.id);
                    setFormatting((prev) => ({ ...prev, template: card.defaultTemplate }));
                    setViewMode('edit_action');
                  }}
                  className={`bg-white border-2 text-left rounded-xl p-5 flex flex-col justify-between transition hover:shadow-md ${
                    selectedActionType === card.id
                      ? 'border-orange-600 bg-orange-50/20'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600">
                      {card.id}
                    </span>
                    <h2 className="text-base font-black text-slate-950 mt-1 mb-2">{card.title}</h2>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {activeServiceTab === 'mastodon' ? card.mastodonDescription : card.threadsDescription}
                    </p>
                  </div>
                  <span className="text-[11px] font-bold text-slate-900 pt-4 underline">Configure template →</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* VIEW: EDIT ACTION */}
      {viewMode === 'edit_action' && (
        <div className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 space-y-6">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMode('choose_action')}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-950"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Actions</span>
            </button>
            <h1 className="text-xl font-black">{currentActionDefinition.title}</h1>
            <button
              type="button"
              onClick={() => setViewMode('applet_home')}
              className="px-4 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-full"
            >
              Save & Return
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <h2 className="text-sm font-black text-slate-950">Post Template</h2>
              <textarea
                rows={6}
                value={formatting.template}
                onChange={(e) => setFormatting((prev) => ({ ...prev, template: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
              />

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1.5">
                  Insert Variables
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {['{title}', '{summary}', '{link}', '{author}', '{source}', '{tags}', '{BRAND_SIGNATURE}', '{UTM_SUFFIX}'].map((tok) => (
                    <button
                      key={tok}
                      type="button"
                      onClick={() => setFormatting((prev) => ({ ...prev, template: `${prev.template} ${tok}` }))}
                      className="px-2 py-1 text-[11px] font-mono font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded border border-slate-200"
                    >
                      + {tok}
                    </button>
                  ))}
                </div>
              </div>

              {selectedActionType === 'link' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Target Link URL</label>
                  <input
                    type="text"
                    value={actionLinkUrl}
                    onChange={(e) => setActionLinkUrl(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs font-mono"
                  />
                </div>
              )}

              {selectedActionType === 'image' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Fallback Image URL (Optional)</label>
                  <input
                    type="text"
                    placeholder="https://example.com/fallback.jpg"
                    value={actionMediaUrl}
                    onChange={(e) => setActionMediaUrl(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs font-mono"
                  />
                </div>
              )}

              {selectedActionType === 'carousel' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Carousel Media URLs (comma-separated)</label>
                  <textarea
                    rows={2}
                    placeholder="https://example.com/1.jpg, https://example.com/2.jpg"
                    value={actionCarouselUrls}
                    onChange={(e) => setActionCarouselUrls(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs font-mono"
                  />
                </div>
              )}
            </div>

            {/* Live Preview */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <h2 className="text-sm font-black text-slate-950">Live Output Preview</h2>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-900">Meta Threads Post</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {threadsPreview?.effectiveCharCounts[0] || 0} / 500 chars
                  </span>
                </div>
                <div className="text-xs whitespace-pre-wrap font-sans bg-white p-3 rounded-lg border border-slate-200">
                  {threadsPreview?.posts[0] || 'No content rendered'}
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-purple-700">Mastodon Post</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {mastodonPreview?.effectiveCharCounts[0] || 0} / 500 chars
                  </span>
                </div>
                <div className="text-xs whitespace-pre-wrap font-sans bg-white p-3 rounded-lg border border-slate-200">
                  {mastodonPreview?.posts[0] || 'No content rendered'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: APPLET HOME */}
      {viewMode === 'applet_home' && (
        <div className="flex-1 max-w-3xl w-full mx-auto px-6 py-10 space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-3xl font-black text-slate-950">Syndication Pipeline</h1>
            <p className="text-xs text-slate-500">Automated RSS-Bridge ingestion to Mastodon & Meta Threads</p>
          </div>

          <div className="space-y-3">
            <div className="bg-gradient-to-r from-[#EA7600] to-[#D66500] text-white rounded-2xl p-5 shadow-sm flex items-center justify-between">
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-wider text-white/80">If This Trigger</div>
                <div className="text-lg font-black">New item in RSS-Bridge feed</div>
                <div className="text-xs font-mono text-white/90 truncate max-w-md">
                  {resolveEnvVariablesInString(triggerFeedUrl, envVars)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewMode('edit_trigger')}
                className="px-4 py-2 bg-white text-slate-950 text-xs font-bold rounded-full hover:bg-slate-100 shadow-sm"
              >
                Edit
              </button>
            </div>

            <div className="bg-slate-950 text-white rounded-2xl p-5 shadow-sm flex items-center justify-between">
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Then That Action</div>
                <div className="text-lg font-black">{currentActionDefinition.title}</div>
                <div className="text-xs text-slate-400">
                  Targeting:{' '}
                  <span className="font-semibold text-white capitalize">
                    {activeServiceTab === 'both' ? 'Mastodon & Threads' : activeServiceTab}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewMode('choose_action')}
                className="px-4 py-2 bg-white text-slate-950 text-xs font-bold rounded-full hover:bg-slate-100 shadow-sm"
              >
                Change
              </button>
            </div>
          </div>

          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={handleRunAppletNow}
              disabled={isPublishing}
              className="bg-slate-900 text-white font-black text-sm px-10 py-3.5 rounded-full hover:bg-slate-800 disabled:opacity-60 shadow-md inline-flex items-center gap-2"
            >
              {isPublishing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>{isPublishing ? 'Executing Pipeline...' : 'Run Applet Now'}</span>
            </button>
          </div>

          {publishTraces.length > 0 && (
            <div className="border border-slate-200 rounded-2xl p-4 space-y-2 bg-white shadow-sm">
              <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                Execution Log ({publishTraces.length} API Calls)
              </h3>
              <div className="space-y-1.5">
                {publishTraces.map((t) => (
                  <div
                    key={t.step}
                    className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs flex items-center justify-between font-mono"
                  >
                    <span className="truncate max-w-sm">
                      <strong className="uppercase font-bold text-slate-700">[{t.platform}]</strong> {t.endpoint}
                    </span>
                    <span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      HTTP {t.httpStatus} ({t.durationMs}ms)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW: CONNECTIONS & ENV */}
      {viewMode === 'connections' && (
        <div className="flex-1 max-w-4xl w-full mx-auto px-6 py-8 space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-black text-slate-950">Credentials & OAuth Connections</h1>
              <p className="text-xs text-slate-500">Authorize Meta Threads with 1-click or configure Mastodon</p>
            </div>
            <button
              type="button"
              onClick={() => setViewMode('applet_home')}
              className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-full"
            >
              Done
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 bg-white border border-slate-200 rounded-2xl space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center font-black text-sm">
                    @
                  </span>
                  <span className="font-bold text-sm">Meta Threads</span>
                </div>
                <button
                  type="button"
                  onClick={handleConnectThreads}
                  disabled={isConnectingThreads}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold shadow-sm ${
                    threadsUserId
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-black text-white hover:bg-neutral-800'
                  }`}
                >
                  {isConnectingThreads ? 'Connecting...' : threadsUserId ? 'Reconnect' : 'Connect with Threads'}
                </button>
              </div>

              <p className="text-xs text-slate-600">
                {threadsUserId
                  ? `Authorized User ID: ${threadsUserId}. Ready for auto-publishing.`
                  : 'Requires THREADS_APP_ID below. Clicking opens the official Meta Threads OAuth login.'}
              </p>
            </div>

            <div className="p-5 bg-white border border-slate-200 rounded-2xl space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">
                    M
                  </span>
                  <span className="font-bold text-sm">Mastodon</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleVerifyCredential('mastodon')}
                  disabled={verifyStatus.mastodon?.loading}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-full border border-slate-200"
                >
                  {verifyStatus.mastodon?.loading ? 'Checking...' : 'Test Connection'}
                </button>
              </div>

              {verifyStatus.mastodon?.message && (
                <div
                  className={`text-xs flex items-center gap-1.5 ${
                    verifyStatus.mastodon.verified ? 'text-emerald-700 font-semibold' : 'text-red-700'
                  }`}
                >
                  {verifyStatus.mastodon.verified ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  <span>{verifyStatus.mastodon.message}</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
              API Keys & Configuration Store
            </div>
            <table className="w-full text-left text-xs">
              <tbody className="divide-y divide-slate-100 font-mono">
                {envVars.map((v) => (
                  <tr key={v.id}>
                    <td className="p-3 font-bold text-slate-900 w-1/3">
                      <div>{v.key}</div>
                      <div className="text-[10px] font-sans font-normal text-slate-500 mt-0.5">{v.description}</div>
                    </td>
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
                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-xs font-mono"
                      />
                    </td>
                    <td className="p-3 text-right">
                      {v.isSecret && (
                        <button
                          type="button"
                          onClick={() => setRevealedSecrets((prev) => ({ ...prev, [v.id]: !prev[v.id] }))}
                          className="p-1 text-slate-500 hover:text-slate-800"
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
export type SocialActionType = 'text' | 'link' | 'image' | 'video' | 'carousel';

export interface DashboardEnvVar {
  id: string;
  key: string;
  value: string;
  description: string;
  isSecret: boolean;
  category: 'rss_bridge' | 'mastodon' | 'threads' | 'template';
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
  status: 'published_both' | 'published_mastodon' | 'published_threads' | 'seeded_initial' | 'filtered_out' | 'queued';
  reason?: string;
  processedAt: string;
  mastodonStatusId?: string;
  threadsPostId?: string;
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
  { id: 'env-1', key: 'RSS_BRIDGE_BASE_URL', value: 'https://rss-bridge.org/bridge01', description: 'Base URL of RSS-Bridge instance', isSecret: false, category: 'rss_bridge' },
  { id: 'env-2', key: 'THREADS_APP_ID', value: '', description: 'Meta Threads App ID', isSecret: false, category: 'threads' },
  { id: 'env-3', key: 'THREADS_APP_SECRET', value: '', description: 'Meta Threads App Secret', isSecret: true, category: 'threads' },
  { id: 'env-4', key: 'THREADS_USER_ID', value: '', description: 'Meta Threads User ID', isSecret: false, category: 'threads' },
  { id: 'env-5', key: 'THREADS_ACCESS_TOKEN', value: '', description: 'Meta Threads Access Token', isSecret: true, category: 'threads' },
  { id: 'env-6', key: 'MASTODON_INSTANCE_URL', value: 'https://mastodon.social', description: 'Target Mastodon URL', isSecret: false, category: 'mastodon' },
  { id: 'env-7', key: 'MASTODON_ACCESS_TOKEN', value: '', description: 'Mastodon Bearer Token', isSecret: true, category: 'mastodon' },
  { id: 'env-8', key: 'BRAND_SIGNATURE', value: 'via BridgeRelay', description: 'Signature for {BRAND_SIGNATURE}', isSecret: false, category: 'template' },
  { id: 'env-9', key: 'UTM_SUFFIX', value: '?utm_source=syndication', description: 'Tracking suffix for {UTM_SUFFIX}', isSecret: false, category: 'template' },
];

export function resolveEnvVariablesInString(input: string, envVars: DashboardEnvVar[]): string {
  if (!input) return '';
  let output = input;
  for (const env of envVars) {
    if (!env.key) continue;
    output = output
      .replace(new RegExp(`\\{\\{${env.key}\\}\\}`, 'g'), env.value)
      .replace(new RegExp(`\\{${env.key}\\}`, 'g'), env.value);
  }
  return output;
}

export function getEnvValue(envVars: DashboardEnvVar[], key: string, fallback = ''): string {
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
    text = text.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*p\s*>/gi, '\n\n').replace(/<\/\s*div\s*>/gi, '\n');
  }
  text = text.replace(/<[^>]+>/g, '');
  const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
  text = text.replace(/&[a-zA-Z0-9#]+;/g, (m) => entities[m] || m);
  return text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n').trim();
}

export function extractImagesFromHtml(html: string): MediaEnclosure[] {
  if (!html) return [];
  const results: MediaEnclosure[] = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    if (url && !url.startsWith('data:')) {
      results.push({ url, mimeType: url.endsWith('.png') ? 'image/png' : 'image/jpeg', source: 'html_img' });
    }
  }
  return results;
}

export function formatHashtags(tags: string[], extraTags: string[]): string {
  return Array.from(new Set([...tags, ...extraTags]))
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)
    .map((t) => `#${t.replace(/[^a-zA-Z0-9_]/g, '')}`)
    .join(' ');
}

export function computeEffectiveLength(text: string, platform: 'mastodon' | 'threads', countUrlAs23: boolean): number {
  if (platform === 'mastodon' && countUrlAs23) {
    return text.replace(/https?:\/\/[^\s]+/g, 'x'.repeat(23)).length;
  }
  return text.length;
}

export function renderFormattedPreview(
  item: NormalizedFeedItem,
  formatting: FormattingConfig,
  platform: 'mastodon' | 'threads',
  envVars: DashboardEnvVar[] = []
): FormattedPayloadPreview {
  const maxChars = platform === 'mastodon' ? formatting.mastodonMaxChars : formatting.threadsMaxChars;
  const countUrlAs23 = platform === 'mastodon' && formatting.mastodonCountUrlAs23Chars;
  const formattedTags = formatHashtags(item.tags, formatting.defaultHashtags);

  const fullText = resolveEnvVariablesInString(formatting.template, envVars)
    .replace(/{title}/g, item.title)
    .replace(/{summary}/g, item.cleanSummary)
    .replace(/{link}/g, item.link)
    .replace(/{author}/g, item.author)
    .replace(/{tags}/g, formattedTags)
    .trim();

  const len = computeEffectiveLength(fullText, platform, countUrlAs23);
  return {
    platform,
    posts: [fullText],
    effectiveCharCounts: [len],
    maxAllowedChars: maxChars,
    wasTruncated: len > maxChars,
    isThreaded: false,
    mediaAttachments: formatting.includeMediaAttachment && item.enclosures ? item.enclosures.slice(0, 4) : [],
  };
}

export const INITIAL_BRIDGE_FEEDS: BridgeFeedSource[] = [
  {
    id: 'feed-tiktok',
    name: '@mollynailsind TikTok Feed',
    bridgeUrl: 'https://rss-bridge.org/bridge01/?action=display&bridge=TikTokBridge&context=By+user&username=mollynailsind&format=Atom',
    bridgeName: 'TikTokBridge',
    format: 'Atom',
    pollIntervalMinutes: 15,
    initialRunPolicy: 'seed_only',
    enabled: true,
    lastPolledAt: null,
    hasCompletedInitialRun: true,
  },
];

// Defaults directly to the user's real TikTok items
export const INITIAL_NORMALIZED_ITEMS: NormalizedFeedItem[] = [
  {
    guid: 'https://www.tiktok.com/@mollynailsind/video/7152249874161945883',
    hashId: computeDeterministicHash('https://www.tiktok.com/@mollynailsind/video/7152249874161945883'),
    feedId: 'tiktok-feed',
    feedName: '@mollynailsind - TikTok',
    title: 'Molly Nails TikTok Video',
    rawHtml: '<p>2.1M views</p>',
    cleanSummary: 'Molly Nails New TikTok Video',
    link: 'https://www.tiktok.com/@mollynailsind/video/7152249874161945883',
    author: '@mollynailsind',
    publishedAt: '2026-10-27T05:27:42Z',
    tags: ['mollynails', 'tiktok', 'nails'],
    enclosures: [],
  },
  {
    guid: 'https://www.tiktok.com/@mollynailsind/video/7631412125260352788',
    hashId: computeDeterministicHash('https://www.tiktok.com/@mollynailsind/video/7631412125260352788'),
    feedId: 'tiktok-feed',
    feedName: '@mollynailsind - TikTok',
    title: 'Molly Nails TikTok Video 2',
    rawHtml: '<p>13.6K views</p>',
    cleanSummary: 'Molly Nails New TikTok Video',
    link: 'https://www.tiktok.com/@mollynailsind/video/7631412125260352788',
    author: '@mollynailsind',
    publishedAt: '2026-10-27T05:27:42Z',
    tags: ['mollynails', 'tiktok', 'nails'],
    enclosures: [],
  },
];

export const INITIAL_SEEN_STATE: SeenEntry[] = [];
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
    ignoreBuildErrors: true,
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

