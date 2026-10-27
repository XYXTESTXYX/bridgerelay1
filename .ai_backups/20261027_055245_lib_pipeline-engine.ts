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
  status: 'published_both' | 'published_mastodon' | 'published_threads' | 'seeded_initial' | 'filtered_out' | 'queued';
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
  { id: 'env-1', key: 'RSS_BRIDGE_BASE_URL', value: 'https://rss-bridge.org/bridge01', description: 'Base URL of RSS-Bridge instance', isSecret: false, category: 'rss_bridge' },
  { id: 'env-2', key: 'THREADS_APP_ID', value: '', description: 'Meta Threads App ID', isSecret: false, category: 'threads' },
  { id: 'env-3', key: 'THREADS_APP_SECRET', value: '', description: 'Meta Threads App Secret', isSecret: true, category: 'threads' },
  { id: 'env-4', key: 'THREADS_USER_ID', value: '', description: 'Meta Threads User ID', isSecret: false, category: 'threads' },
  { id: 'env-5', key: 'THREADS_ACCESS_TOKEN', value: '', description: 'Meta Threads Access Token', isSecret: true, category: 'threads' },
  { id: 'env-6', key: 'MASTODON_INSTANCE_URL', value: 'https://mastodon.social', description: 'Target Mastodon URL', isSecret: false, category: 'mastodon' },
  { id: 'env-7', key: 'MASTODON_ACCESS_TOKEN', value: '', description: 'Mastodon Bearer Token', isSecret: true, category: 'mastodon' },
  { id: 'env-8', key: 'BRAND_SIGNATURE', value: 'via BridgeRelay', description: 'Signature for {BRAND_SIGNATURE}', isSecret: false, category: 'template' },
  { id: 'env-9', key: 'UTM_SUFFIX', value: '?utm_source=syndication', description: 'Tracking suffix for {UTM_SUFFIX}', isSecret: false, category: 'template' },
];

export function resolveEnvVariablesInString(input: string, envVars: DashboardEnvVar[]): string {
  if (!input) return '';
  let output = input;
  for (const env of envVars) {
    if (!env.key) continue;
    output = output
      .replace(new RegExp(`\\{\\{${env.key}\\}\\}`, 'g'), env.value)
      .replace(new RegExp(`\\{${env.key}\\}`, 'g'), env.value);
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
    text = text.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*p\s*>/gi, '\n\n').replace(/<\/\s*div\s*>/gi, '\n');
  }
  text = text.replace(/<[^>]+>/g, '');
  const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
  text = text.replace(/&[a-zA-Z0-9#]+;/g, (m) => entities[m] || m);
  return text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n').trim();
}

export function extractImagesFromHtml(html: string): MediaEnclosure[] {
  if (!html) return [];
  const results: MediaEnclosure[] = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    if (url && !url.startsWith('data:')) {
      results.push({ url, mimeType: url.endsWith('.png') ? 'image/png' : 'image/jpeg', source: 'html_img' });
    }
  }
  return results;
}

export function formatHashtags(tags: string[], extraTags: string[]): string {
  return Array.from(new Set([...tags, ...extraTags]))
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)
    .map((t) => `#${t.replace(/[^a-zA-Z0-9_]/g, '')}`)
    .join(' ');
}

export function computeEffectiveLength(text: string, platform: 'mastodon' | 'threads', countUrlAs23: boolean): number {
  if (platform === 'mastodon' && countUrlAs23) {
    return text.replace(/https?:\/\/[^\s]+/g, 'x'.repeat(23)).length;
  }
  return text.length;
}

export function renderFormattedPreview(
  item: NormalizedFeedItem,
  formatting: FormattingConfig,
  platform: 'mastodon' | 'threads',
  envVars: DashboardEnvVar[] = []
): FormattedPayloadPreview {
  const maxChars = platform === 'mastodon' ? formatting.mastodonMaxChars : formatting.threadsMaxChars;
  const countUrlAs23 = platform === 'mastodon' && formatting.mastodonCountUrlAs23Chars;
  const formattedTags = formatHashtags(item.tags, formatting.defaultHashtags);

  const fullText = resolveEnvVariablesInString(formatting.template, envVars)
    .replace(/{title}/g, item.title)
    .replace(/{summary}/g, item.cleanSummary)
    .replace(/{link}/g, item.link)
    .replace(/{author}/g, item.author)
    .replace(/{tags}/g, formattedTags)
    .trim();

  const len = computeEffectiveLength(fullText, platform, countUrlAs23);
  return {
    platform,
    posts: [fullText],
    effectiveCharCounts: [len],
    maxAllowedChars: maxChars,
    wasTruncated: len > maxChars,
    isThreaded: false,
    mediaAttachments: formatting.includeMediaAttachment && item.enclosures ? item.enclosures.slice(0, 4) : [],
  };
}

export const INITIAL_BRIDGE_FEEDS: BridgeFeedSource[] = [
  {
    id: 'feed-github-releases',
    name: 'GitHub Releases Feed',
    bridgeUrl: '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=GithubReleaseBridge&user=RSS-Bridge&repo=rss-bridge&format=Json',
    bridgeName: 'GithubReleaseBridge',
    format: 'Json',
    pollIntervalMinutes: 30,
    initialRunPolicy: 'seed_only',
    enabled: true,
    lastPolledAt: null,
    hasCompletedInitialRun: true,
  },
];

export const INITIAL_NORMALIZED_ITEMS: NormalizedFeedItem[] = [
  {
    guid: 'https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-10-24',
    hashId: computeDeterministicHash('https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-10-24'),
    feedId: 'feed-github-releases',
    feedName: 'GitHub Releases Feed',
    title: 'RSS-Bridge Release: Native JSON Normalizer',
    rawHtml: '<p>Release details for RSS-Bridge.</p>',
    cleanSummary: 'Release details for RSS-Bridge.',
    link: 'https://github.com/RSS-Bridge/rss-bridge/releases/tag/2026-10-24',
    author: 'rss-bridge-maintainers',
    publishedAt: '2026-10-26T15:42:00Z',
    tags: ['RSSBridge', 'OpenSource'],
    enclosures: [],
  },
];

export const INITIAL_SEEN_STATE: SeenEntry[] = [];
