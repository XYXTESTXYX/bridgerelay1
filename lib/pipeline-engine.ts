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
    id: 'env-5