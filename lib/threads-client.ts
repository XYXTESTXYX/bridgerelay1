import { decryptToken, encryptToken, saveThreadsAccount, ThreadsAccount } from './db';

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

export interface ThreadsPublishOptions {
  text: string;
  linkAttachment?: string;
  imageUrl?: string;
  videoUrl?: string;
}

/**
 * Exchanges short-lived OAuth authorization token for a 60-day long-lived token
 */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const clientSecret = process.env.THREADS_APP_SECRET;
  if (!clientSecret) throw new Error('THREADS_APP_SECRET environment variable is missing');

  const params = new URLSearchParams({
    grant_type: 'th_exchange_token',
    client_secret: clientSecret,
    access_token: shortLivedToken,
  });

  const res = await fetch(`https://graph.threads.net/access_token?${params.toString()}`, { method: 'GET' });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Failed to exchange long-lived token: ${JSON.stringify(data)}`);
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 5184000, // 60 days
  };
}

/**
 * Refreshes an existing long-lived token if within 7 days of expiration
 */
export async function ensureFreshAccessToken(account: ThreadsAccount): Promise<string> {
  const token = decryptToken(account.encryptedAccessToken, account.iv, account.authTag);
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  if (account.tokenExpiresAt - now < sevenDaysMs) {
    try {
      const params = new URLSearchParams({
        grant_type: 'th_refresh_token',
        access_token: token,
      });
      const res = await fetch(`https://graph.threads.net/refresh_access_token?${params.toString()}`, { method: 'GET' });
      const data = await res.json();
      if (res.ok && data.access_token) {
        const encrypted = encryptToken(data.access_token);
        account.encryptedAccessToken = encrypted.encrypted;
        account.iv = encrypted.iv;
        account.authTag = encrypted.authTag;
        account.tokenExpiresAt = Date.now() + (data.expires_in || 5184000) * 1000;
        saveThreadsAccount(account);
        return data.access_token;
      }
    } catch (err) {
      console.warn('Failed to refresh Threads token; proceeding with current token:', err);
    }
  }

  return token;
}

export async function fetchThreadsProfile(accessToken: string): Promise<{ id: string; username: string; name?: string; threads_profile_picture_url?: string }> {
  const res = await fetch(`${THREADS_API_BASE}/me?fields=id,username,name,threads_profile_picture_url&access_token=${accessToken}`);
  const data = await res.json();
  if (!res.ok) throw new Error(`Failed to fetch Threads profile: ${JSON.stringify(data)}`);
  return data;
}

async function pollThreadsContainerReady(containerId: string, accessToken: string, maxAttempts = 15): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${THREADS_API_BASE}/${containerId}?fields=status,error_message&access_token=${accessToken}`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'FINISHED') return;
      if (data.status === 'ERROR') throw new Error(`Threads container rejected: ${data.error_message || 'Transcode failure'}`);
    }
  }
  throw new Error('Threads media processing timed out');
}

/**
 * Executes official 2-step publish container flow to Meta Threads
 */
export async function publishToThreads(account: ThreadsAccount, options: ThreadsPublishOptions): Promise<string> {
  const token = await ensureFreshAccessToken(account);
  const containerUrl = `${THREADS_API_BASE}/${account.userId}/threads`;
  const publishUrl = `${THREADS_API_BASE}/${account.userId}/threads_publish`;

  const isVideo = Boolean(options.videoUrl);
  const isImage = Boolean(options.imageUrl) && !isVideo;
  const mediaType = isVideo ? 'VIDEO' : isImage ? 'IMAGE' : 'TEXT';

  const params = new URLSearchParams({
    media_type: mediaType,
    text: options.text,
    access_token: token,
  });

  if (isImage && options.imageUrl) params.append('image_url', options.imageUrl);
  if (isVideo && options.videoUrl) params.append('video_url', options.videoUrl);
  if (!isImage && !isVideo && options.linkAttachment) params.append('link_attachment', options.linkAttachment);

  // Step 1: Create container
  const createRes = await fetch(`${containerUrl}?${params.toString()}`, { method: 'POST' });
  const createData = await createRes.json();
  if (!createRes.ok || !createData.id) {
    throw new Error(`Threads container creation failed (${createRes.status}): ${JSON.stringify(createData)}`);
  }

  const containerId = createData.id;

  // Step 2: Poll status if media attached
  if (isImage || isVideo) {
    await pollThreadsContainerReady(containerId, token);
  }

  // Step 3: Publish
  const pubParams = new URLSearchParams({
    creation_id: containerId,
    access_token: token,
  });
  const pubRes = await fetch(`${publishUrl}?${pubParams.toString()}`, { method: 'POST' });
  const pubData = await pubRes.json();
  if (!pubRes.ok || !pubData.id) {
    throw new Error(`Threads publish failed: ${JSON.stringify(pubData)}`);
  }

  return pubData.id;
}