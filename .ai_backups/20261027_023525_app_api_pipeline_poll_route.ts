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
  cdataPropName: '__cdata',
});

function getText(node: unknown): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj.__cdata) return String(obj.__cdata);
    if (obj['#text']) return String(obj['#text']);
  }
  return String(node);
}

export function parseXmlFeed(xmlText: string, feedId: string, feedName: string): NormalizedFeedItem[] {
  const items: NormalizedFeedItem[] = [];
  const parsed = xmlParser.parse(xmlText);

  // 1. RSS 2.0 / MRSS channel items
  let rawList = parsed?.rss?.channel?.item;
  // 2. Atom feed entries
  if (!rawList) {
    rawList = parsed?.feed?.entry;
  }

  if (!rawList) return [];
  const entries = Array.isArray(rawList) ? rawList : [rawList];

  for (const entry of entries.slice(0, 20)) {
    const rawTitle = getText(entry.title) || 'Untitled Feed Entry';
    const title = cleanHtmlToPlainText(rawTitle, false);

    let link = '';
    if (typeof entry.link === 'string') {
      link = entry.link;
    } else if (entry.link?.['@_href']) {
      link = entry.link['@_href'];
    } else if (Array.isArray(entry.link)) {
      const alt = entry.link.find((l: Record<string, string>) => l['@_rel'] === 'alternate');
      link = alt?.['@_href'] || entry.link[0]?.['@_href'] || getText(entry.link[0]);
    }

    const rawGuid = getText(entry.guid) || getText(entry.id) || link || `${feedId}-${title}`;
    const rawHtml =
      getText(entry['content:encoded']) ||
      getText(entry.content) ||
      getText(entry.description) ||
      getText(entry.summary) ||
      '';

    const author =
      cleanHtmlToPlainText(
        getText(entry.author?.name) || getText(entry.author) || getText(entry['dc:creator']),
        false
      ) || 'bridge-author';

    const pubDate =
      getText(entry.pubDate) ||
      getText(entry.published) ||
      getText(entry.updated) ||
      new Date().toISOString();

    const tags: string[] = [];
    const rawCats = entry.category;
    if (rawCats) {
      const catList = Array.isArray(rawCats) ? rawCats : [rawCats];
      for (const cat of catList) {
        const val = typeof cat === 'string' ? cat : cat['@_term'] || getText(cat);
        if (val && tags.length < 6) tags.push(val);
      }
    }

    const enclosures: MediaEnclosure[] = [];
    const rawEnc = entry.enclosure;
    if (rawEnc) {
      const encList = Array.isArray(rawEnc) ? rawEnc : [rawEnc];
      for (const enc of encList) {
        if (enc?.['@_url']) {
          enclosures.push({
            url: enc['@_url'],
            mimeType: enc['@_type'] || 'image/jpeg',
            source: 'enclosure',
          });
        }
      }
    }

    for (const img of extractImagesFromHtml(rawHtml)) {
      if (!enclosures.some((e) => e.url === img.url)) {
        enclosures.push(img);
      }
    }

    items.push({
      guid: rawGuid,
      hashId: computeDeterministicHash(rawGuid),
      feedId,
      feedName,
      title,
      rawHtml,
      cleanSummary: cleanHtmlToPlainText(rawHtml, true),
      link: link || 'https://rss-bridge.org',
      author,
      publishedAt: Number.isNaN(Date.parse(pubDate))
        ? new Date().toISOString()
        : new Date(pubDate).toISOString(),
      tags: tags.length > 0 ? tags : ['Syndicated'],
      enclosures,
    });
  }

  return items;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { feedId, feedName, bridgeUrl } = body as {
      feedId: string;
      feedName: string;
      bridgeUrl: string;
    };

    if (!bridgeUrl) {
      return NextResponse.json({ error: 'bridgeUrl is required' }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(bridgeUrl, {
      headers: {
        'User-Agent': 'BridgeRelay-Pipeline/2.0 (+https://rss-bridge.org)',
        Accept: 'application/json, application/atom+xml, application/rss+xml, text/xml, */*',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream bridge returned HTTP ${res.status}: ${res.statusText}` },
        { status: 502 }
      );
    }

    const text = await res.text();

    if (text.trim().startsWith('{')) {
      const parsed = JSON.parse(text);
      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
      const normalized: NormalizedFeedItem[] = rawItems.slice(0, 20).map((entry: Record<string, unknown>, idx: number) => {
        const guid = String(entry.id || entry.url || `${feedId}-${idx}`);
        const rawHtml = String(entry.content_html || entry.content_text || entry.summary || '');
        const enclosures: MediaEnclosure[] = [];

        if (Array.isArray(entry.attachments)) {
          for (const att of entry.attachments) {
            if (att && typeof att === 'object' && 'url' in att) {
              enclosures.push({
                url: String((att as { url: string }).url),
                mimeType: String((att as { mime_type?: string }).mime_type || 'image/jpeg'),
                source: 'enclosure',
              });
            }
          }
        }
        for (const img of extractImagesFromHtml(rawHtml)) {
          if (!enclosures.some((e) => e.url === img.url)) enclosures.push(img);
        }

        const authorObj = entry.author as { name?: string } | undefined;
        return {
          guid,
          hashId: computeDeterministicHash(guid),
          feedId,
          feedName,
          title: cleanHtmlToPlainText(String(entry.title || 'Untitled Entry'), false),
          rawHtml,
          cleanSummary: cleanHtmlToPlainText(rawHtml, true),
          link: String(entry.url || bridgeUrl),
          author: authorObj?.name || 'bridge-author',
          publishedAt: String(entry.date_modified || entry.date_published || new Date().toISOString()),
          tags: Array.isArray(entry.tags) ? entry.tags.map(String) : ['RSSBridge'],
          enclosures,
        };
      });

      return NextResponse.json({
        source: 'live_bridge',
        items: normalized,
        polledAt: new Date().toISOString(),
      });
    }

    const xmlItems = parseXmlFeed(text, feedId, feedName);
    return NextResponse.json({
      source: 'live_bridge',
      items: xmlItems,
      polledAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to poll feed' },
      { status: 500 }
    );
  }
}