import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  let code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  if (error || !code) {
    const errorMsg = errorDescription || error || 'Authorization was cancelled or denied.';
    return new NextResponse(
      `<!DOCTYPE html><html><body>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'THREADS_AUTH_ERROR', error: ${JSON.stringify(errorMsg)} }, '*');
            window.close();
          } else {
            document.body.innerText = 'Authorization failed: ' + ${JSON.stringify(errorMsg)};
          }
        </script>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  // Meta often appends '#_' to the code, strip it if present
  code = code.replace(/#_$/, '');

  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const redirectUri = `${protocol}://${host}/api/auth/threads/callback`;

  // Get App ID & Secret from cookie, query state, or server environment
  const clientSecret = process.env.THREADS_APP_SECRET || '';
  const clientId = process.env.THREADS_APP_ID || '';

  try {
    // 1. Exchange authorization code for Short-Lived Access Token & User ID
    const tokenFormData = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    });

    const tokenRes = await fetch('https://graph.threads.net/oauth/access_token', {
      method: 'POST',
      body: tokenFormData,
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_message || tokenData.error?.message || 'Failed to exchange authorization code');
    }

    const shortLivedToken = tokenData.access_token;
    const userId = String(tokenData.user_id);

    // 2. Exchange Short-Lived Token for 60-day Long-Lived Token
    let finalAccessToken = shortLivedToken;
    try {
      const longLivedUrl = `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${clientSecret}&access_token=${shortLivedToken}`;
      const longLivedRes = await fetch(longLivedUrl);
      const longLivedData = await longLivedRes.json();
      if (longLivedRes.ok && longLivedData.access_token) {
        finalAccessToken = longLivedData.access_token;
      }
    } catch {
      // Fallback to short-lived token if exchange failed
    }

    // 3. Fetch user profile handle
    let username = userId;
    try {
      const userRes = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${finalAccessToken}`);
      if (userRes.ok) {
        const userData = await userRes.json();
        if (userData.username) username = userData.username;
      }
    } catch {
      // Ignore profile fetch error
    }

    // Return HTML to post message to main window and self-close
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head><title>Threads Connected</title></head>
        <body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #000; color: #fff;">
          <div style="text-align: center;">
            <h2>Connected @${username}!</h2>
            <p style="color: #888;">Saving credentials to BridgeRelay...</p>
          </div>
          <script>
            const payload = {
              type: 'THREADS_AUTH_SUCCESS',
              userId: ${JSON.stringify(userId)},
              accessToken: ${JSON.stringify(finalAccessToken)},
              username: ${JSON.stringify(username)}
            };
            if (window.opener) {
              window.opener.postMessage(payload, '*');
              setTimeout(() => window.close(), 1000);
            } else {
              window.location.href = '/?threads_connected=true';
            }
          </script>
        </body>
      </html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'OAuth exchange failed';
    return new NextResponse(
      `<!DOCTYPE html><html><body>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'THREADS_AUTH_ERROR', error: ${JSON.stringify(errorMsg)} }, '*');
            window.close();
          } else {
            alert(${JSON.stringify(errorMsg)});
          }
        </script>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}