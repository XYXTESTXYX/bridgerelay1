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

  cons