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
