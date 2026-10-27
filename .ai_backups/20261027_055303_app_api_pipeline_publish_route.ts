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