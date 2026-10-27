import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import {
  cleanHtmlToPlainText,
  computeDeterministicHash,
  extractImagesFromHtml,
  NormalizedFeedItem,
} from '@/lib/pipeline-engine';

export const dynamic = 'force-dynamic';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

export async function POST(req: NextRequest) {
  try {
    const { feedId = 'feed-default', feedName = 'RSS Feed', bridgeUrl } = await req.json();
    if (!bridgeUrl) return NextResponse.json({ error: 'bridgeUrl is required' }, { status: 400 });

    const res = await fetch(bridgeUrl, {
      headers: { 'User-Agent': 'BridgeRelay-Pipeline/2.0' },
    });
    if (!res.ok) return NextResponse.json({ error: `Bridge returned HTTP ${res.status}` }, { status: 502 });

    const text = await res.text();
    if (text.trim().startsWith('{')) {
      const parsed = JSON.parse(text);
      const items = (parsed.items || []).slice(0, 20).map((entry, idx) => ({
        guid: String(entry.id || entry.url || `${feedId}-${idx}`),
        hashId: computeDeterministicHash(String(entry.id || entry.url || `${feedId}-${idx}`)),
        feedId,
        feedName,
        title: String(entry.title || 'Untitled Entry'),
        rawHtml: String(entry.content_html || entry.summary || ''),
        cleanSummary: cleanHtmlToPlainText(String(entry.content_html || entry.summary || '')),
        link: String(entry.url || bridgeUrl),
        author: entry.author?.name || 'author',
        publishedAt: String(entry.date_published || new Date().toISOString()),
        tags: Array.isArray(entry.tags) ? entry.tags.map(String) : ['RSSBridge'],
        enclosures: [],
      }));
      return NextResponse.json({ items });
    }

    const parsed = xmlParser.parse(text);
    const rawList = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
    const entries = Array.isArray(rawList) ? rawList : [rawList];

    const items: NormalizedFeedItem[] = entries.slice(0, 20).map((entry, idx) => {
      const rawTitle = String(entry.title?.['#text'] || entry.title || 'Untitled Entry');
      const title = cleanHtmlToPlainText(rawTitle, false);
      const link = String(entry.link?.['@_href'] || entry.link || bridgeUrl);
      const guid = String(entry.guid?.['#text'] || entry.guid || entry.id || `${feedId}-${idx}`);
      const rawHtml = String(entry['content:encoded'] || entry.content?.['#text'] || entry.description || '');

      return {
        guid,
        hashId: computeDeterministicHash(guid),
        feedId,
        feedName,
        title,
        rawHtml,
        cleanSummary: cleanHtmlToPlainText(rawHtml),
        link,
        author: 'bridge-author',
        publishedAt: new Date().toISOString(),
        tags: ['Syndicated'],
        enclosures: extractImagesFromHtml(rawHtml),
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to poll feed' }, { status: 500 });
  }
}
