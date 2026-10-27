import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import {
  cleanHtmlToPlainText,
  computeDeterministicHash,
  extractImagesFromHtml,
  MediaEnclosure,
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
    const { feedId = 'feed-default', feedName = 'TikTok Feed', bridgeUrl } = await req.json();
    if (!bridgeUrl) return NextResponse.json({ error: 'bridgeUrl is required' }, { status: 400 });

    const res = await fetch(bridgeUrl, {
      headers: { 'User-Agent': 'BridgeRelay-Pipeline/2.0 (+https://rss-bridge.org)' },
    });
    if (!res.ok) return NextResponse.json({ error: `Bridge returned HTTP ${res.status}` }, { status: 502 });

    const text = await res.text();
    const parsed = xmlParser.parse(text);

    // Support Atom <feed><entry> and RSS <channel><item>
    const rawList = parsed?.feed?.entry || parsed?.rss?.channel?.item || [];
    const entries: Record<string, any>[] = Array.isArray(rawList) ? rawList : [rawList];

    const items: NormalizedFeedItem[] = entries.slice(0, 20).map((entry: Record<string, any>, idx: number) => {
      // 1. Extract clean canonical Link
      let link = '';
      if (typeof entry.link === 'string') {
        link = entry.link;
      } else if (Array.isArray(entry.link)) {
        const alt = entry.link.find((l: any) => l['@_rel'] === 'alternate');
        link = alt?.['@_href'] || entry.link[0]?.['@_href'] || '';
      } else if (entry.link?.['@_href']) {
        link = entry.link['@_href'];
      }
      if (!link) link = String(entry.id?.['#text'] || entry.id || bridgeUrl);

      // 2. Extract Title and Content
      const rawTitle = String(entry.title?.['#text'] || entry.title || 'TikTok Video');
      const title = cleanHtmlToPlainText(rawTitle, false);
      const rawHtml = String(entry.content?.['#text'] || entry.content || entry['content:encoded'] || entry.description || '');

      // 3. Extract Enclosures (Handling Atom <link rel="enclosure" href="...">)
      const enclosures: MediaEnclosure[] = [];
      if (Array.isArray(entry.link)) {
        for (const l of entry.link) {
          if (l['@_rel'] === 'enclosure' && l['@_href']) {
            const url = String(l['@_href']);
            // Ignore tiny 100x100 avatar thumbnails that Meta Threads blocks
            if (!url.includes('100:100')) {
              enclosures.push({
                url,
                mimeType: l['@_type'] || 'image/jpeg',
                source: 'enclosure',
              });
            }
          }
        }
      }

      // Also check standard RSS <enclosure>
      if (entry.enclosure?.['@_url']) {
        enclosures.push({
          url: String(entry.enclosure['@_url']),
          mimeType: entry.enclosure['@_type'] || 'image/jpeg',
          source: 'enclosure',
        });
      }

      const guid = String(entry.id?.['#text'] || entry.id || link || `${feedId}-${idx}`);

      return {
        guid,
        hashId: computeDeterministicHash(guid),
        feedId,
        feedName,
        title: title.startsWith('http') ? 'New TikTok Video' : title,
        rawHtml,
        cleanSummary: cleanHtmlToPlainText(rawHtml),
        link,
        author: '@mollynailsind',
        publishedAt: String(entry.published || entry.updated || new Date().toISOString()),
        tags: ['TikTok', 'Nails', 'Beauty'],
        enclosures,
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to parse feed' }, { status: 500 });
  }
}