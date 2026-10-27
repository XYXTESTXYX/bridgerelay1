import { NextRequest, NextResponse } from 'next/server';
import { isItemSeen } from '@/lib/db';
import {
  evaluateFilterRules,
  renderFormattedPreview,
  INITIAL_BRIDGE_FEEDS,
  NormalizedFeedItem,
  MediaEnclosure,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${host}`;

  const results = [];

  for (const feed of INITIAL_BRIDGE_FEEDS.filter((f) => f.enabled)) {
    try {
      const pollRes = await fetch(`${baseUrl}/api/pipeline/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedId: feed.id,
          feedName: feed.name,
          bridgeUrl: feed.bridgeUrl.replace(
            '{RSS_BRIDGE_BASE_URL}',
            process.env.RSS_BRIDGE_BASE_URL || 'https://rss-bridge.org/bridge01'
          ),
        }),
      });

      if (!pollRes.ok) continue;
      const data = (await pollRes.json()) as { items?: NormalizedFeedItem[] };
      const items: NormalizedFeedItem[] = data.items || [];

      for (const item of items) {
        if (isItemSeen(item.hashId)) continue;

        const filterCheck = evaluateFilterRules(item, {
          keywordWhitelist: [],
          keywordBlacklist: ['sponsored', 'ad'],
          regexPattern: '',
          regexInvert: false,
          authorWhitelist: [],
          minContentLength: 10,
          maxContentLength: 4000,
          requireMediaAttachment: false,
          stripHtmlPreserveBreaks: true,
          extractInlineImages: true,
        });

        if (!filterCheck.passed) continue;

        const mastoPreview = renderFormattedPreview(
          item,
          {
            template: '{title}\n\n{summary}\n\n{link}\n{tags}',
            mastodonMaxChars: 500,
            threadsMaxChars: 500,
            mastodonCountUrlAs23Chars: true,
            truncationStrategy: 'ellipsis',
            includeMediaAttachment: true,
            defaultHashtags: ['RSSBridge'],
            mastodonVisibility: 'public',
          },
          'mastodon'
        );

        const threadsPreview = renderFormattedPreview(
          item,
          {
            template: '{title}\n\n{summary}\n\n{link}\n{tags}',
            mastodonMaxChars: 500,
            threadsMaxChars: 500,
            mastodonCountUrlAs23Chars: true,
            truncationStrategy: 'ellipsis',
            includeMediaAttachment: true,
            defaultHashtags: ['RSSBridge'],
            mastodonVisibility: 'public',
          },
          'threads'
        );

        const pubRes = await fetch(`${baseUrl}/api/pipeline/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemGuid: item.guid,
            itemTitle: item.title,
            feedId: feed.id,
            platforms: ['mastodon', 'threads'],
            actionType: item.enclosures.length > 0 ? 'image' : 'text',
            mastodonPosts: mastoPreview.posts,
            threadsPosts: threadsPreview.posts,
            mediaUrls: item.enclosures.map((e: MediaEnclosure) => e.url),
          }),
        });

        results.push({ item: item.title, published: pubRes.ok });
        break;
      }
    } catch (e) {
      console.error(`Cron error on feed ${feed.id}:`, e);
    }
  }

  return NextResponse.json({
    status: 'cron_completed',
    processedAt: new Date().toISOString(),
    results,
  });
}