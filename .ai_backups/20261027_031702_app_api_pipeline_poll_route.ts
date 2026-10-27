import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const clientId = searchParams.get('client_id') || process.env.THREADS_APP_ID || '';

  if (!clientId) {
    return NextResponse.json(
      { error: 'Missing Threads App ID (client_id)' },
      { status: 400 }
    );
  }

  // Determine current origin for callback
  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const redirectUri = `${protocol}://${host}/api/auth/threads/callback`;

  // Required scopes for basic profile and publishing posts
  const scope = 'threads_basic,threads_content_publish';
  const state = searchParams.get('state') || 'bridgerelay_oauth';

  const authUrl = new URL('https://threads.net/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('state', state);

  return NextResponse.redirect(authUrl.toString());
}