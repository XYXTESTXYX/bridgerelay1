import { NextRequest, NextResponse } from 'next/server';
import { getActiveThreadsAccount, removeThreadsAccount, saveThreadsAccount, getSeenRecords } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const account = getActiveThreadsAccount();
  if (!account) {
    return NextResponse.json({ connected: false, seenLedger: getSeenRecords().slice(0, 20) });
  }

  // Return public account info only — never send tokens or secrets to the client
  return NextResponse.json({
    connected: true,
    account: {
      userId: account.userId,
      username: account.username,
      name: account.name,
      profilePictureUrl: account.profilePictureUrl,
      connectedAt: account.connectedAt,
      autoPostEnabled: account.autoPostEnabled,
      feedUrl: account.feedUrl,
      lastPolledAt: account.lastPolledAt,
      lastError: account.lastError,
    },
    seenLedger: getSeenRecords().slice(0, 20),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const account = getActiveThreadsAccount();

  if (!account) {
    return NextResponse.json({ error: 'No connected account' }, { status: 400 });
  }

  if (body.action === 'disconnect') {
    removeThreadsAccount(account.userId);
    return NextResponse.json({ success: true, message: 'Account disconnected.' });
  }

  if (body.action === 'update_settings') {
    if (typeof body.autoPostEnabled === 'boolean') account.autoPostEnabled = body.autoPostEnabled;
    if (body.feedUrl) account.feedUrl = body.feedUrl;
    saveThreadsAccount(account);
    return NextResponse.json({ success: true, account });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}