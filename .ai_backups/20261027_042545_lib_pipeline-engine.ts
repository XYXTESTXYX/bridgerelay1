export type BridgeFormat = 'Json' | 'Atom' | 'Mrss';

export type InitialRunPolicy = 'seed_only' | 'publish_latest_one' | 'publish_all';

export type TruncationStrategy = 'ellipsis' | 'thread_split' | 'title_and_link_only';

export type SocialActionType = 'text' | 'link' | 'image' | 'video' | 'carousel';

export interface DashboardEnvVar {
  id: string;
  key: string;
  value: string;
  description: string;
  isSecret: boolean;
  category: 'rss_bridge' | 'mastodon' | 'threads' | 'template';
}

export interface MediaEnclosure {
  url: string;
  mimeType: string;
  source: 'enclosure' | 'html_img';
  altText?: string;
}

export interface NormalizedFeedItem {
  guid: string;
  hashId: string;
  feedId: string;
  feedName: string;
  title: string;
  rawHtml: string;
  cleanSummary: string;
  link: string;
  author: string;
  publishedAt: string;
  tags: string[];
  enclosures: MediaEnclosure[];
}

export interface BridgeFeedSource {
  id: string;
  name: string;
  bridgeUrl: string;
  bridgeName: string;
  format: BridgeFormat;
  pollIntervalMinutes: number;
  initialRunPolicy: InitialRunPolicy;
  enabled: boolean;
  lastPolledAt: string | null;
  hasCompletedInitialRun: boolean;
}

export interface FilterRulesConfig {
  keywordWhitelist: string[];
  keywordBlacklist: string[];
  regexPattern: string;
  regexInvert: boolean;
  authorWhitelist: string[];
  minContentLength: number;
  maxContentLength: number;
  requireMediaAttachment: boolean;
  stripHtmlPreserveBreaks: boolean;
  extractInlineImages: boolean;
}

export interface FormattingConfig {
  template: string;
  mastodonMaxChars: number;
  threadsMaxChars: number;
  mastodonCountUrlAs23Chars: boolean;
  truncationStrategy: TruncationStrategy;
  includeMediaAttachment: boolean;
  defaultHashtags: string[];
  mastodonVisibility: 'public' | 'unlisted' | 'private';
}

export interface SeenEntryRecord {
  guid: string;
  hashId: string;
  feedId: string;
  title: string;
  status:
    | 'published_both'
    | 'published_mastodon'
    | 'published_threads'
    | 'seeded_initial'
    | 'filtered_out'
    | 'queued';
  reason?: string;
  processedAt: string;
  mastodonStatusId?: string;
  threadsPostId?: string;
}

export type SeenEntry = SeenEntryRecord;

export interface FilterEvaluationResult {
  passed: boolean;
  reasons: string[];
  matchedWhitelist: string[];
  triggeredBlacklist: string[];
  regexMatched: boolean;
}

export interface FormattedPayloadPreview {
  platform: 'mastodon' | 'threads';
  posts: string[];
  effectiveCharCounts: number[];
  maxAllowedChars: number;
  wasTruncated: boolean;
  isThreaded: boolean;
  mediaAttachments: MediaEnclosure[];
}

export const INITIAL_DASHBOARD_ENV_VARS: DashboardEnvVar[] = [
  {
    id: 'env-1',
    key: 'RSS_BRIDGE_BASE_URL',
    value: 'https://rss-bridge.org/bridge01',
    description: 'Base URL of your RSS-Bridge instance',
    isSecret: false,
    category: 'rss_bridge',
  },
  {
    id: 'env-2',
    key: 'THREADS_APP_ID',
    value: '',
    description: 'Meta Threads App ID (Client ID) from developers.facebook.com',
    isSecret: false,
    category: 'threads',
  },
  {
    id: 'env-3',
    key: 'THREADS_APP_SECRET',
    value: '',
    description: 'Meta Threads App Secret from App Settings > Basic',
    isSecret: true,
    category: 'threads',
  },
  {
    id: 'env-4',
    key: 'THREADS_USER_ID',
    value: '',
    description: 'Auto-populated when clicking "Connect with Threads"',
    isSecret: false,
    category: 'threads',
  },
  {
    id: 'env-5',
    key: 'THREADS_ACCESS_TOKEN',
    value: '',
    description: 'Auto-populated 60-day token when clicking "Connect with Threads"',
    isSecret: true,
    category: 'threads',
  },
  {
    id: 'env-6',
    key: 'MASTODON_INSTANCE_URL',
    value: 'https://mastodon.social',
    description: 'Target Mastodon server URL',
    isSecret: false,
    category: 'mastodon',
  },
  {
    id: 'env-7',
    key: 'MASTODON_ACCESS_TOKEN',
    value: '',
    description: 'Mastodon bearer token with write:statuses and write:media scopes',
    isSecret: true,
    category: 'mastodon',
  },
  {
    id: 'env-8',
    key: 'BRAND_SIGNATURE',
    value: 'via BridgeRelay',
    description: 'Optional signature variable usable as {BRAND_SIGNATURE}',
    isSecret: false,
    category: 'template',
  },
  {
    id: 'env-9',
    key: 'UTM_SUFFIX',
    value: '?utm_source=syndication',
    description: 'Tracking suffix usable as {UTM_SUFFIX}',
    isSecret: false,
    category: 'template',
  },
];

export function resolveEnvVariablesInString(input: string, envVars: DashboardEnvVar[]): string {
  if (!input) return '';
  let output = input;
  for (const env of envVars) {
    if (!env.key) continue;
    const doubleBrace = new RegExp(`\\{\\{${env.key}\\}\\}`, 'g');
    const singleBrace = new RegExp(`\\{${env.key}\\}`, 'g');
    const dollarBrace = new RegExp(`\\$\\{${env.key}\\}`, 'g');
    output = output
      .replace(doubleBrace, env.value)
      .replace(singleBrace, env.value)
      .replace(dollarBrace, env.value);
  }
  return output;
}

export function getEnvValue(envVars: DashboardEnvVar[], key: string, fallback = ''): string {
  const found = envVars.find((e) => e.key === key);
  return found ? found.value : fallback;
}

export function computeDeterministicHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0, ch; i < input.length; i++) {
    ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(12, '0');
  return `sha_${hex.slice(0, 12)}`;
}

export function cleanHtmlToPlainText(html: string, preserveBreaks = true): string {
  if (!html) return '';
  let text = html;

  if (preserveBreaks) {
    text = text
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*p\s*>/gi, '\n\n')
      .replace(/<\/\s*div\s*>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '• ')
      .replace(/<\/\s*li\s*>/gi, '\n');
  }

  text = text.replace(/<[^>]+>/g, '');

  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
  };

  text = text.replace(/&[a-zA-Z0-9#]+;/g, (match) => entities[match] ?? match);

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractImagesFromHtml(html: string): MediaEnclosure[] {
  if (!html) return [];
  const results: MediaEnclosure[] = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    if (!url || url.startsWith('data:')) continue;
    const altMatch = match[0].match(/alt=["']([^"']*)["']/i);
    results.push({
      url,
      mimeType: url.endsWith('.png')
        ? 'image/png'
        : url.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg',
      source: 'html_img',
      altText: altMatch?.[1] || undefined,
    });
  }
  return results;
}

export function extractMediaFromHtml(html: string): MediaEnclosure[] {
  if (!html) return [];
  const results: MediaEnclosure[] = [];

  // 1. Extract HTML5 <video> / <source> tags
  const videoRegex = /<(?:video|source)[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let vMatch: RegExpExecArray | null;
  while ((vMatch = videoRegex.exec(html)) !== null) {
    const url = vMatch[1];
    if (url && (url.includes('.mp4') || url.includes('.mov') || url.includes('video'))) {
      results.push({
        url,
        mimeType: 'video/mp4',
        source: 'html_img',
      });
    }
  }

  // 2. Extract <img> tags
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    if (!url || url.startsWith('data:')) continue;
    const altMatch = match[0].match(/alt=["']([^"']*)["']/i);
    results.push({
      url,
      mimeType: url.endsWith('.png') ? 'image/png' : 'image/jpeg',
      source: 'html_img',
      altText: altMatch?.[1] || undefined,
    });
  }

  return results;
}

export function evaluateFilterRules(
  item: NormalizedFeedItem,
  rules: FilterRulesConfig
): FilterEvaluationResult {
  const reasons: string[] = [];
  const matchedWhitelist: string[] = [];
  const triggeredBlacklist: string[] = [];

  const searchableCorpus = `${item.title}\n${item.cleanSummary}\n${item.tags.join(' ')}`.toLowerCase();

  if (rules.keywordWhitelist.length > 0) {
    for (const kw of rules.keywordWhitelist) {
      const normalized = kw.trim().toLowerCase();
      if (normalized && searchableCorpus.includes(normalized)) {
        matchedWhitelist.push(kw.trim());
      }
    }
    if (matchedWhitelist.length === 0) {
      reasons.push(
        `Did not match any required whitelist keyword (${rules.keywordWhitelist.join(', ')})`
      );
    }
  }

  if (rules.keywordBlacklist.length > 0) {
    for (const kw of rules.keywordBlacklist) {
      const normalized = kw.trim().toLowerCase();
      if (normalized && searchableCorpus.includes(normalized)) {
        triggeredBlacklist.push(kw.trim());
      }
    }
    if (triggeredBlacklist.length > 0) {
      reasons.push(`Triggered blacklist keyword: ${triggeredBlacklist.join(', ')}`);
    }
  }

  let regexMatched = true;
  if (rules.regexPattern.trim().length > 0) {
    try {
      const regex = new RegExp(rules.regexPattern.trim(), 'i');
      const rawTest = regex.test(`${item.title}\n${item.cleanSummary}`);
      regexMatched = rules.regexInvert ? !rawTest : rawTest;
      if (!regexMatched) {
        reasons.push(
          rules.regexInvert
            ? `Excluded because content matched inverted regex /${rules.regexPattern}/i`
            : `Did not match required regex /${rules.regexPattern}/i`
        );
      }
    } catch {
      reasons.push(`Invalid regular expression syntax: ${rules.regexPattern}`);
      regexMatched = false;
    }
  }

  if (rules.authorWhitelist.length > 0) {
    const normalizedAuthor = item.author.toLowerCase();
    const authorAllowed = rules.authorWhitelist.some(
      (a) => a.trim() && normalizedAuthor.includes(a.trim().toLowerCase())
    );
    if (!authorAllowed) {
      reasons.push(`Author "${item.author}" is not in author whitelist`);
    }
  }

  const contentLen = item.cleanSummary.length + item.title.length;
  if (rules.minContentLength > 0 && contentLen < rules.minContentLength) {
    reasons.push(
      `Content length (${contentLen} chars) is below minimum (${rules.minContentLength} chars)`
    );
  }
  if (rules.maxContentLength > 0 && contentLen > rules.maxContentLength) {
    reasons.push(
      `Content length (${contentLen} chars) exceeds maximum (${rules.maxContentLength} chars)`
    );
  }

  if (rules.requireMediaAttachment && item.enclosures.length === 0) {
    reasons.push('Entry does not contain a required media enclosure or inline image');
  }

  return {
    passed: reasons.length === 0,
    reasons,
    matchedWhitelist,
    triggeredBlacklist,
    regexMatched,
  };
}

export function formatHashtags(tags: string[], extraTags: string[]): string {
  const combined = Array.from(new Set([...tags, ...extraTags]))
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)
    .map((t) => {
      const cleaned = t.replace(/[^a-zA-Z0-9\s_-]/g, '');
      if (cleaned.includes(' ') || cleaned.includes('-')) {
        return (
          '#' +
          cleaned
            .split(/[\s-]+/)
            .filter(Boolean)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join('')
        );
      }
      return `#${cleaned}`;
    });

  return combined.join(' ');
}

export function computeEffectiveLength(
  text: string,
  platform: 'mastodon' | 'threads',
  countUrlAs23: boolean
): number {
  if (platform === 'mastodon' && countUrlAs23) {
    const urlRegex = /https?:\/\/[^\s]+/g;
    const replaced = text.replace(urlRegex, 'x'.repeat(23));
    return replaced.length;
  }
  return text.length;
}

export function renderFormattedPreview(
  item: NormalizedFeedItem,
  formatting: FormattingConfig,
  platform: 'mastodon' | 'threads',
  envVars: DashboardEnvVar[] = []
): FormattedPayloadPreview {
  const maxChars =
    platform === 'mastodon' ? formatting.mastodonMaxChars : formatting.threadsMaxChars;
  const countUrlAs23 = platform === 'mastodon' && formatting.mastodonCountUrlAs23Chars;
  const formattedTags = formatHashtags(item.tags, formatting.defaultHashtags);

  const renderWithSummary = (summaryText: string) => {
    const withEnv = resolveEnvVariablesInString(formatting.template, envVars);
    return withEnv
      .replace(/\{title\}/g, item.title)
      .replace(/\{summary\}/g, summaryText)
      .replace(/\{link\}/g, item.link)
      .replace(/\{author\}/g, item.author)
      .replace(/\{source\}/g, item.feedName)
      .replace(/\{tags\}/g, formattedTags)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const fullText = renderWithSummary(item.cleanSummary);
  const fullLen = computeEffectiveLength(fullText, platform, countUrlAs23);
  const mediaAttachments = formatting.includeMediaAttachment ? item.enclosures.slice(0, 4) : [];

  if (fullLen <= maxChars) {
    return {
      platform,
      posts: [fullText],
      effectiveCharCounts: [fullLen],
      maxAllowedChars: maxChars,
      wasTruncated: false,
      isThreaded: false,
      mediaAttachments,
    };
  }

  if (formatting.truncationStrategy === 'title_and_link_only') {
    const compact = `${item.title}\n\n${item.link}${formattedTags ? `\n\n${formattedTags}` : ''}`.trim();
    const compactLen = computeEffectiveLength(compact, platform, countUrlAs23);
    return {
      platform,
      posts: [compact],
      effectiveCharCounts: [compactLen],
      maxAllowedChars: maxChars,
      wasTruncated: true,
      isThreaded: false,
      mediaAttachments,
    };
  }

  if (formatting.truncationStrategy === 'thread_split') {
    const sentences = item.cleanSummary.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) || [item.cleanSummary];
    const chunks: string[] = [];
    let currentChunk = `${item.title}\n\n`;

    for (const sentence of sentences) {
      const candidate = `${currentChunk}${sentence}`.trim();
      if (computeEffectiveLength(candidate, platform, countUrlAs23) > maxChars - 18) {
        if (currentChunk.trim().length > 0) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = sentence.trim() + ' ';
      } else {
        currentChunk = candidate + ' ';
      }
    }

    const footer = `\n\n${item.link}${formattedTags ? `\n${formattedTags}` : ''}`;
    if (computeEffectiveLength(currentChunk.trim() + footer, platform, countUrlAs23) <= maxChars - 10) {
      chunks.push((currentChunk.trim() + footer).trim());
    } else {
      if (currentChunk.trim()) chunks.push(currentChunk.trim());
      chunks.push(`${item.title}\n${footer}`.trim());
    }

    const total = chunks.length;
    const numberedPosts = chunks.map((c, idx) => (total > 1 ? `${c}\n\n(${idx + 1}/${total})` : c));
    return {
      platform,
      posts: numberedPosts,
      effectiveCharCounts: numberedPosts.map((p) =>
        computeEffectiveLength(p, platform, countUrlAs23)
      ),
      maxAllowedChars: maxChars,
      wasTruncated: false,
      isThreaded: numberedPosts.length > 1,
      mediaAttachments,
    };
  }

  const emptySummaryShell = renderWithSummary('');
  const shellLen = computeEffectiveLength(emptySummaryShell, platform, countUrlAs23);
  const availableForSummary = Math.max(24, maxChars - shellLen - 5);

  let truncatedSummary = item.cleanSummary.slice(0, availableForSummary);
  const lastSpace = truncatedSummary.lastIndexOf(' ');
  if (lastSpace > availableForSummary * 0.6) {
    truncatedSummary = truncatedSummary.slice(0, lastSpace);
  }
  truncatedSummary = `${truncatedSummary.replace(/[.,;:\s]+$/, '')}…`;

  const finalPost = renderWithSummary(truncatedSummary);
  const finalLen = computeEffectiveLength(finalPost, platform, countUrlAs23);

  return {
    platform,
    posts: [finalPost],
    effectiveCharCounts: [finalLen],
    maxAllowedChars: maxChars,
    wasTruncated: true,
    isThreaded: false,
    mediaAttachments,
  };
}

export const INITIAL_BRIDGE_FEEDS: BridgeFeedSource[] = [
  {
    id: 'feed-github-releases',
    name: 'GitHub Releases Feed',
    bridgeUrl:
      '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=GithubReleaseBridge&user=RSS-Bridge&repo=rss-bridge&format=Json',
    bridgeName: 'GithubReleaseBridge',
    format: 'Json',
    pollIntervalMinutes: 30,
    initialRunPolicy: 'seed_only',
    enabled: true,
    lastPolledAt: '2026-10-26T16:15:00Z',
    hasCompletedInitialRun: true,
  },
  {
    id: 'feed-hn-frontpage',
    name: 'HackerNews Top Items',
    bridgeUrl:
      '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=HackerNewsBridge&area=newest&min_score=150&format=Atom',
    bridgeName: 'HackerNewsBridge',
    format: 'Atom',
    pollIntervalMinutes: 15,
    initialRunPolicy: 'publish_latest_one',
    enabled: true,
    lastPolledAt: '2026-10-26T16:30:00Z',
    hasCompletedInitialRun: true,
  },
];

export const INITIAL_NORMALIZED_ITEMS: NormalizedFeedItem[] = [
  {
    guid: 'https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-10-24',
    hashId: computeDeterministicHash('https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-10-24'),
    feedId: 'feed-github-releases',
    feedName: 'GitHub Releases Feed',
    title: 'RSS-Bridge Release: Native JSON Attachment Normalizer & Rate-Limit Cache',
    rawHtml:
      '<p>This release introduces deterministic ETag caching across 42 bridges, stricter HTML sanitization for Atom and MRSS outputs, and native media enclosure extraction for multi-image posts.</p>',
    cleanSummary:
      'This release introduces deterministic ETag caching across 42 bridges, stricter HTML sanitization for Atom and MRSS outputs, and native media enclosure extraction for multi-image posts.',
    link: 'https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-10-24',
    author: 'rss-bridge-maintainers',
    publishedAt: '2026-10-26T15:42:00Z',
    tags: ['RSSBridge', 'OpenSource', 'Syndication'],
    enclosures: [],
  },
];

export const INITIAL_SEEN_STATE: SeenEntry[] = [];