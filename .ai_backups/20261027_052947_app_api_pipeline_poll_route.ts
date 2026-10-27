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
    const { feedId = 'feed-default', feedName = 'RSS Feed', bridgeUrl } = await req.json();
    if (!bridgeUrl) return NextResponse.json({ error: 'bridgeUrl is required' }, { status: 400 });

    const res = await fetch(bridgeUrl, {
      headers: { 'User-Agent': 'BridgeRelay-Pipeline/2.0 (+https://rss-bridge.org)' },
    });
    if (!res.ok) return NextResponse.json({ error: `Bridge returned HTTP ${res.status}` }, { status: 502 });

    const text = await res.text();

    // 1. JSON Feed Parser
    if (text.trim().startsWith('{')) {
      const parsed = JSON.parse(text);
      const items: NormalizedFeedItem[] = (parsed.items || []).slice(0, 20).map((entry: Record<string, any>, idx: number) => {
        const enclosures: MediaEnclosure[] = [];
        if (Array.isArray(entry.attachments)) {
          for (const att of entry.attachments) {
            if (att?.url) {
              const isVid = String(att.mime_type || '').includes('video') || String(att.url).includes('.mp4');
              enclosures.push({
                url: String(att.url),
                mimeType: isVid ? 'video/mp4' : 'image/jpeg',
                source: 'enclosure',
              });
            }
          }
        }
        if (entry.image) {
          enclosures.push({ url: String(entry.image), mimeType: 'image/jpeg', source: 'enclosure' });
        }

        return {
          guid: String(entry.id || entry.url || `${feedId}-${idx}`),
          hashId: computeDeterministicHash(String(entry.id || entry.url || `${feedId}-${idx}`)),
          feedId,
          feedName,
          title: String(entry.title || 'Untitled Entry'),
          rawHtml: String(entry.content_html || entry.summary || ''),
          cleanSummary: cleanHtmlToPlainText(String(entry.content_html || entry.summary || '')),
          link: String(entry.url || bridgeUrl),
          author: String(entry.author?.name || 'author'),
          publishedAt: String(entry.date_published || new Date().toISOString()),
          tags: Array.isArray(entry.tags) ? entry.tags.map(String) : ['RSSBridge'],
          enclosures,
        };
      });
      return NextResponse.json({ items });
    }

    // 2. RSS / Atom / Media-RSS (MRSS) Parser
    const parsed = xmlParser.parse(text);
    const rawList = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
    const entries: Record<string, any>[] = Array.isArray(rawList) ? rawList : [rawList];

    const items: NormalizedFeedItem[] = entries.slice(0, 20).map((entry: Record<string, any>, idx: number) => {
      const rawTitle = String(entry.title?.['#text'] || entry.title || 'Untitled Entry');
      const title = cleanHtmlToPlainText(rawTitle, false);
      const link = String(entry.link?.['@_href'] || entry.link || bridgeUrl);
      const guid = String(entry.guid?.['#text'] || entry.guid || entry.id || `${feedId}-${idx}`);
      const rawHtml = String(entry['content:encoded'] || entry.content?.['#text'] || entry.description || '');

      const enclosures: MediaEnclosure[] = [];

      // A. Extract <enclosure url="..." type="..." />
      const rawEnc = entry.enclosure;
      if (rawEnc) {
        const encList = Array.isArray(rawEnc) ? rawEnc : [rawEnc];
        for (const enc of encList) {
          if (enc?.['@_url']) {
            const url = String(enc['@_url']);
            const type = String(enc['@_type'] || '');
            const isVid = type.includes('video') || url.includes('.mp4') || url.includes('.mov');
            enclosures.push({
              url,
              mimeType: isVid ? 'video/mp4' : 'image/jpeg',
              source: 'enclosure',
            });
          }
        }
      }

      // B. Extract <media:content url="..." /> (Used by YouTube & TikTok RSS-Bridge)
      const rawMediaContent = entry['media:content'];
      if (rawMediaContent) {
        const mcList = Array.isArray(rawMediaContent) ? rawMediaContent : [rawMediaContent];
        for (const mc of mcList) {
          if (mc?.['@_url']) {
            const url = String(mc['@_url']);
            const type = String(mc['@_type'] || '');
            const isVid = type.includes('video') || url.includes('.mp4');
            enclosures.push({
              url,
              mimeType: isVid ? 'video/mp4' : 'image/jpeg',
              source: 'enclosure',
            });
          }
        }
      }

      // C. Extract <media:thumbnail url="..." />
      const rawThumbnail = entry['media:thumbnail'];
      if (rawThumbnail && enclosures.length === 0) {
        const thumbList = Array.isArray(rawThumbnail) ? rawThumbnail : [rawThumbnail];
        if (thumbList[0]?.['@_url']) {
          enclosures.push({
            url: String(thumbList[0]['@_url']),
            mimeType: 'image/jpeg',
            source: 'enclosure',
          });
        }
      }

      // D. Fallback to HTML images
      for (const img of extractImagesFromHtml(rawHtml)) {
        if (!enclosures.some((e) => e.url === img.url)) {
          enclosures.push(img);
        }
      }

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
        enclosures,
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to poll feed' }, { status: 500 });
  }
}