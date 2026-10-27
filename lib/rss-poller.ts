import { XMLParser } from 'fast-xml-parser';
import { cleanHtmlToPlainText, computeDeterministicHash, NormalizedFeedItem } from './pipeline-engine';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

function isSafeUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.endsWith('.local')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function fetchAndParseFeed(feedUrl: string, feedId = 'default-feed'): Promise<NormalizedFeedItem[]> {
  if (!isSafeUrl(feedUrl)) {
    throw new Error('Invalid or restricted feed URL.');
  }

  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': 'BridgeRelay-ThreadsPoster/3.0 (+https://github.com)' },
  });
  if (!res.ok) throw new Error(`Feed server returned HTTP ${res.status}`);

  const text = await res.text();

  // 1. JSON Feed support
  if (text.trim().startsWith('{')) {
    const parsed = JSON.parse(text);
    return (parsed.items || []).slice(0, 15).map((entry: Record<string, any>, idx: number) => {
      const link = String(entry.url || feedUrl);
      const guid = String(entry.id || link || `${feedId}-${idx}`);
      const rawHtml = String(entry.content_html || entry.summary || '');
      return {
        guid,
        hashId: computeDeterministicHash(guid),
        feedId,
        feedName: 'RSS Feed',
        title: String(entry.title || 'Untitled Post'),
        rawHtml,
        cleanSummary: cleanHtmlToPlainText(rawHtml),
        link,
        author: String(entry.author?.name || 'author'),
        publishedAt: String(entry.date_published || new Date().toISOString()),
        tags: [],
        enclosures: entry.image ? [{ url: entry.image, mimeType: 'image/jpeg', source: 'enclosure' }] : [],
      };
    });
  }

  // 2. XML / Atom / RSS / MRSS support
  const parsed = xmlParser.parse(text);
  const rawList = parsed?.feed?.entry || parsed?.rss?.channel?.item || [];
  const entries: Record<string, any>[] = Array.isArray(rawList) ? rawList : [rawList];

  return entries.slice(0, 15).map((entry: Record<string, any>, idx: number) => {
    let link = '';
    if (typeof entry.link === 'string') {
      link = entry.link;
    } else if (Array.isArray(entry.link)) {
      const alt = entry.link.find((l: any) => l['@_rel'] === 'alternate');
      link = alt?.['@_href'] || entry.link[0]?.['@_href'] || '';
    } else if (entry.link?.['@_href']) {
      link = entry.link['@_href'];
    }
    if (!link) link = String(entry.id?.['#text'] || entry.id || feedUrl);

    const rawTitle = String(entry.title?.['#text'] || entry.title || 'New Post');
    const title = cleanHtmlToPlainText(rawTitle, false);
    const rawHtml = String(entry.content?.['#text'] || entry.content || entry['content:encoded'] || entry.description || '');

    const enclosures = [];
    if (entry.enclosure?.['@_url']) {
      enclosures.push({
        url: String(entry.enclosure['@_url']),
        mimeType: entry.enclosure['@_type'] || 'image/jpeg',
        source: 'enclosure' as const,
      });
    }

    const guid = String(entry.id?.['#text'] || entry.id || link || `${feedId}-${idx}`);

    return {
      guid,
      hashId: computeDeterministicHash(guid),
      feedId,
      feedName: 'RSS Feed',
      title: title.startsWith('http') ? 'Update' : title,
      rawHtml,
      cleanSummary: cleanHtmlToPlainText(rawHtml),
      link,
      author: 'creator',
      publishedAt: String(entry.published || entry.updated || entry.pubDate || new Date().toISOString()),
      tags: [],
      enclosures,
    };
  });
}