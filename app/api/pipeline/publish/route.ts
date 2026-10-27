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
      'User-Agent': 'Mozilla/5.0 (compatible; BridgeRelay/2.0)',
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
      const data = await status