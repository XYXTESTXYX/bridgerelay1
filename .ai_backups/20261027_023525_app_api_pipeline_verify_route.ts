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