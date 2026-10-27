import { NextRequest, NextResponse } from 'next/server';
import { getActiveThreadsAccount, isItemSeen, markItemSeen, saveThreadsAccount } from '@/lib/db';
import { fetchAndParseFeed } from '@/lib/rss-poller';
import { publishToThreads } from '@/lib/threads-client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Optional cron secret protection
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const account = getActiveThreadsAccount();
  if (!account) {
    return NextResponse.json({ message: 'No active Threads account connected.' });
  }

  if (!account.autoPostEnabled) {
    return NextResponse.json({ message: 'Automatic posting is paused.' });
  }

  if (!account.feedUrl) {
    return NextResponse.json({ message: 'No feed URL configured.' });
  }

  try {
    const items = await fetchAndParseFeed(account.feedUrl);
    const results = [];

    // Process from oldest to newest to preserve chronological order
    const reversed = [...items].reverse();

    for (const item of reversed) {
      if (isItemSeen(item.hashId)) {
        continue; // Deduplicated
      }

      // Format post content (500 chars limit for Threads)
      const postText = `${item.title}\n\n${item.cleanSummary}`.slice(0, 480);

      try {
        const postId = await publishToThreads(account, {
          text: postText,
          linkAttachment: item.link,
          imageUrl: item.enclosures?.[0]?.url,
        });

        markItemSeen({
          guidHash: item.hashId,
          guid: item.guid,
          feedId: item.feedId,
          title: item.title,
          status: 'published',
          publishedAt: new Date().toISOString(),
          threadsPostId: postId,
        });

        results.push({ guid: item.guid, title: item.title, postId, status: 'published' });
      } catch (postErr) {
        markItemSeen({
          guidHash: item.hashId,
          guid: item.guid,
          feedId: item.feedId,
          title: item.title,
          status: 'failed',
          publishedAt: new Date().toISOString(),
          errorMessage: postErr instanceof Error ? postErr.message : 'Publish failed',
        });
        results.push({ guid: item.guid, status: 'failed', error: String(postErr) });
      }
    }

    account.lastPolledAt = new Date().toISOString();
    account.lastError = undefined;
    saveThreadsAccount(account);

    return NextResponse.json({ success: true, processed: results.length, details: results });
  } catch (error) {
    account.lastError = error instanceof Error ? error.message : 'Feed polling failed';
    saveThreadsAccount(account);
    return NextResponse.json({ error: account.lastError }, { status: 500 });
  }
}