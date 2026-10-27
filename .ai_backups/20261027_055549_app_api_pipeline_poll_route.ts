import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import {
  cleanHtmlToPlainText,
  computeDeterministicHash,
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

// Resolves a TikTok web URL into direct MP4 video and cover image URLs
async function resolveTikTokMedia(tiktokUrl: string): Promise<{ videoUrl?: string; coverUrl?: string; title?: string }> {
  try {
    const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BridgeRelay/2.0)' },
    });
    if (!res.ok) return {};
    const json = await res.json();
    if (json.code === 0 && json.data) {
      return {
        videoUrl: json.data.play || json.data.wmplay,
        coverUrl: json.data.cover || json.data.origin_cover,
        title: json.data.title,
      };
    }
  } catch (err) {
    console.warn(`Failed to resolve TikTok media for ${tiktokUrl}:`, err);
  }
  return {};
}

export async function POST(req: NextRequest) {
  try {
    const { feedId = 'tiktok-feed', feedName = 'TikTok Feed', bridgeUrl } = await req.json();
    if (!bridgeUrl) return NextResponse.json({ error: 'bridgeUrl is required' }, { status: 400 });

    const res = await fetch(bridgeUrl, {
      headers: { 'User-Agent': 'BridgeRelay-Pipeline/2.0 (+https://rss-bridge.org)' },
    });
    if (!res.ok) return NextResponse.json({ error: `Bridge returned HTTP ${res.status}` }, { status: 502 });

    const text = await res.text();
    const parsed = xmlParser.parse(text);

    const rawList = parsed?.feed?.entry || parsed?.rss?.channel?.item || [];
    const entries: Record<string, any>[] = Array.isArray(rawList) ? rawList : [rawList];

    // Process items (resolving TikTok MP4 video links)
    const items: NormalizedFeedItem[] = [];

    for (let idx = 0; idx < Math.min(entries.length, 10); idx++) {
      const entry = entries[idx];

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

      const rawTitle = String(entry.title?.['#text'] || entry.title || 'TikTok Video');
      let title = cleanHtmlToPlainText(rawTitle, false);
      const rawHtml = String(entry.content?.['#text'] || entry.content || entry['content:encoded'] || entry.description || '');

      const enclosures: MediaEnclosure[] = [];

      // If it's a TikTok URL, resolve the real MP4 video and high-res cover
      if (link.includes('tiktok.com/')) {
        const resolved = await resolveTikTokMedia(link);
        if (resolved.videoUrl) {
          enclosures.push({
            url: resolved.videoUrl,
            mimeType: 'video/mp4',
            source: 'enclosure',
          });
        }
        if (resolved.coverUrl) {
          enclosures.push({
            url: resolved.coverUrl,
            mimeType: 'image/jpeg',
            source: 'enclosure',
          });
        }
        if (resolved.title) {
          title = resolved.title;
        }
      }

      const guid = String(entry.id?.['#text'] || entry.id || link || `${feedId}-${idx}`);

      items.push({
        guid,
        hashId: computeDeterministicHash(guid),
        feedId,
        feedName,
        title: title.startsWith('http') ? 'TikTok Video' : title,
        rawHtml,
        cleanSummary: title,
        link,
        author: '@mollynailsind',
        publishedAt: String(entry.published || entry.updated || new Date().toISOString()),
        tags: ['TikTok', 'Reel', 'Viral'],
        enclosures,
      });
    }

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to parse feed' }, { status: 500 });
  }
}