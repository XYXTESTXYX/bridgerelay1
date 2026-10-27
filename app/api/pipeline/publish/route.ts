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
  const mediaRes = await fetch(mediaUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; BridgeRelay/2.0; +https://rss-bridge.org)',
      Accept: 'image/*, video/*, */*',
    },
  });

  if (!mediaRes.ok) {
    throw new Error(`Media download returned HTTP ${mediaRes.status} for ${mediaUrl}`);
  }

  const blob = await mediaRes.blob();
  const contentType = mediaRes.headers.get('content-type') || 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';

  const formData = new FormData();
  formData.append('file', blob, `attachment.${ext}`);
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
  maxAttempts = 8
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusRes = await fetch(
      `https://graph.threads.net/v1.0/${containerId}?fields=status,error_message&access_token=${threadsToken}`
    );
    if (statusRes.ok) {
      const data = await statusRes.json();
      if (data.status === 'FINISHED') return;
      if (data.status === 'ERROR') {
        throw new Error(`Threads container error: ${data.error_message || 'Container processing failed'}`);
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
      mastodonPosts = [],
      threadsPosts = [],
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

    // Filter out invalid or dummy URLs before processing
    const validMediaUrls = mediaUrls.filter(
      (url) => url && typeof url === 'string' && url.startsWith('http') && !url.includes('release-2026-10-arch')
    );

    // 1. Mastodon
    if (platforms.includes('mastodon') && mastodonPosts?.length > 0) {
      if (!mastodonToken) throw new Error('Mastodon access token is missing');

      const uploadedMediaIds: string[] = [];
      if (
        (actionType === 'image' || actionType === 'video' || actionType === 'carousel') &&
        validMediaUrls.length > 0
      ) {
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
      const publishEndpoint = `https://graph.threads.net/v1.0/${thread