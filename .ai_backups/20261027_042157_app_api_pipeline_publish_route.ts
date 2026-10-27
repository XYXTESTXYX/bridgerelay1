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