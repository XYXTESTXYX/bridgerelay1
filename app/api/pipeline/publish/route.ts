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