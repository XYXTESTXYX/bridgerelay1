'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  RefreshCw,
  Rss,
  Send,
  XCircle,
} from 'lucide-react';
import {
  DashboardEnvVar,
  FormattingConfig,
  getEnvValue,
  INITIAL_DASHBOARD_ENV_VARS,
  INITIAL_NORMALIZED_ITEMS,
  INITIAL_SEEN_STATE,
  NormalizedFeedItem,
  renderFormattedPreview,
  resolveEnvVariablesInString,
  SeenEntry,
  SocialActionType,
} from '@/lib/pipeline-engine';
import type { PublishStepTrace } from '@/app/api/pipeline/publish/route';

export type IftttViewMode =
  | 'edit_trigger'
  | 'choose_action'
  | 'edit_action'
  | 'applet_home'
  | 'connections';

interface ActionCardDefinition {
  id: SocialActionType;
  title: string;
  threadsDescription: string;
  mastodonDescription: string;
  defaultTemplate: string;
}

const ACTION_CARDS: ActionCardDefinition[] = [
  {
    id: 'text',
    title: 'Create a text post',
    threadsDescription: 'Publishes an automated text-only post to Meta Threads.',
    mastodonDescription: 'Publishes an automated status post to Mastodon.',
    defaultTemplate: '{title}\n\n{summary}\n\n{tags}',
  },
  {
    id: 'link',
    title: 'Create a link post',
    threadsDescription: 'Creates a rich link post on Threads with interactive preview card.',
    mastodonDescription: 'Publishes status with sanitized shortlink and hashtags to Mastodon.',
    defaultTemplate: '{title}\n\n{summary}\n\n{link}{UTM_SUFFIX}',
  },
  {
    id: 'image',
    title: 'Create an image post',
    threadsDescription: 'Uploads and attaches the feed enclosure or extracted inline image.',
    mastodonDescription: 'Uploads media via Mastodon /api/v2/media and attaches to the status.',
    defaultTemplate: '{title}\n\n{link}\n{tags}',
  },
  {
    id: 'video',
    title: 'Create a video post',
    threadsDescription: 'Publishes video media container to Meta Threads.',
    mastodonDescription: 'Uploads video attachment to Mastodon with auto-fallback.',
    defaultTemplate: '{title} — Watch via {source}\n\n{link}\n{tags}',
  },
  {
    id: 'carousel',
    title: 'Create a carousel post',
    threadsDescription: 'Attaches 2 to 5 slides using Threads parent/child carousel containers.',
    mastodonDescription: 'Attaches up to 4 media items to a single Mastodon status.',
    defaultTemplate: '{title}\n\n{summary}\n\n{link}\n{tags}',
  },
];

const QUICK_BRIDGE_EXAMPLES = [
  {
    label: 'GitHub Releases Bridge',
    url: '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=GithubReleaseBridge&user=RSS-Bridge&repo=rss-bridge&format=Json',
  },
  {
    label: 'Hacker News Bridge',
    url: '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=HackerNewsBridge&area=newest&min_score=150&format=Atom',
  },
  {
    label: 'YouTube Channel Bridge',
    url: '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=YoutubeBridge&context=By+username&u=fireship&format=Mrss',
  },
  {
    label: 'TikTok Bridge',
    url: '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=TikTokBridge&context=By+user&username=funnykittenstok&format=Atom',
  },
];

const STORAGE_KEY_ENV = 'bridgerelay_ifttt_env_v5';
const STORAGE_KEY_TRIGGER_URL = 'bridgerelay_ifttt_trigger_url_v5';

export default function BridgeRelayStudio() {
  const [viewMode, setViewMode] = useState<IftttViewMode>('applet_home');
  const [activeServiceTab, setActiveServiceTab] = useState<'threads' | 'mastodon' | 'both'>('both');

  const [triggerFeedUrl, setTriggerFeedUrl] = useState<string>(
    '{RSS_BRIDGE_BASE_URL}/?action=display&bridge=GithubReleaseBridge&user=RSS-Bridge&repo=rss-bridge&format=Json'
  );
  const [showUrlHelper, setShowUrlHelper] = useState<boolean>(false);

  const [selectedActionType, setSelectedActionType] = useState<SocialActionType>('text');
  const [actionLinkUrl, setActionLinkUrl] = useState<string>('{link}');
  const [actionMediaUrl, setActionMediaUrl] = useState<string>('');
  const [actionCarouselUrls, setActionCarouselUrls] = useState<string>('');

  const [envVars, setEnvVars] = useState<DashboardEnvVar[]>(INITIAL_DASHBOARD_ENV_VARS);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  const [statusBanner, setStatusBanner] = useState<string>('');

  const [items, setItems] = useState<NormalizedFeedItem[]>(INITIAL_NORMALIZED_ITEMS);
  const [selectedItemGuid, setSelectedItemGuid] = useState<string>(INITIAL_NORMALIZED_ITEMS[0]?.guid || '');
  const [seenLedger, setSeenLedger] = useState<SeenEntry[]>(INITIAL_SEEN_STATE);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [isConnectingThreads, setIsConnectingThreads] = useState<boolean>(false);

  const [verifyStatus, setVerifyStatus] = useState<Record<string, { loading: boolean; verified?: boolean; message?: string }>>({});

  const [formatting, setFormatting] = useState<FormattingConfig>({
    template: '{title}\n\n{summary}\n\n{link}\n{tags}',
    mastodonMaxChars: 500,
    threadsMaxChars: 500,
    mastodonCountUrlAs23Chars: true,
    truncationStrategy: 'ellipsis',
    includeMediaAttachment: true,
    defaultHashtags: ['RSSBridge', 'Syndication'],
    mastodonVisibility: 'public',
  });

  const [publishTraces, setPublishTraces] = useState<PublishStepTrace[]>([]);

  useEffect(() => {
    try {
      const savedEnv = localStorage.getItem(STORAGE_KEY_ENV);
      if (savedEnv) {
        const parsed = JSON.parse(savedEnv);
        if (Array.isArray(parsed) && parsed.length > 0) setEnvVars(parsed);
      }
      const savedUrl = localStorage.getItem(STORAGE_KEY_TRIGGER_URL);
      if (savedUrl) setTriggerFeedUrl(savedUrl);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const handleAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === 'THREADS_AUTH_SUCCESS') {
        const { userId, accessToken, username } = event.data;
        updateAndSaveEnvVars((prev) =>
          prev.map((item) => {
            if (item.key === 'THREADS_USER_ID') return { ...item, value: userId };
            if (item.key === 'THREADS_ACCESS_TOKEN') return { ...item, value: accessToken };
            return item;
          })
        );
        setIsConnectingThreads(false);
        setVerifyStatus((s) => ({
          ...s,
          threads: { loading: false, verified: true, message: `Connected as @${username}` },
        }));
        setStatusBanner(`Success! Connected Threads account @${username}`);
      } else if (event.data?.type === 'THREADS_AUTH_ERROR') {
        setIsConnectingThreads(false);
        setStatusBanner(`Threads connection error: ${event.data.error}`);
      }
    };

    window.addEventListener('message', handleAuthMessage);
    return () => window.removeEventListener('message', handleAuthMessage);
  }, []);

  const updateAndSaveEnvVars = (updater: (prev: DashboardEnvVar[]) => DashboardEnvVar[]) => {
    setEnvVars((prev) => {
      const next = updater(prev);
      try {
        localStorage.setItem(STORAGE_KEY_ENV, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    setStatusBanner('Saved changes');
    setTimeout(() => setStatusBanner(''), 2500);
  };

  const threadsAppId = getEnvValue(envVars, 'THREADS_APP_ID', '');
  const threadsUserId = getEnvValue(envVars, 'THREADS_USER_ID', '');

  const handleConnectThreads = () => {
    if (!threadsAppId) {
      alert('Please enter your THREADS_APP_ID in the Credentials tab first.');
      setViewMode('connections');
      return;
    }

    setIsConnectingThreads(true);
    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    const popup = window.open(
      `/api/auth/threads/login?client_id=${threadsAppId}`,
      'ThreadsAuthorization',
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,resizable=yes`
    );

    const checkClosed = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(checkClosed);
        setIsConnectingThreads(false);
      }
    }, 1000);
  };

  const selectedItem = useMemo(() => {
    return items.find((i) => i.guid === selectedItemGuid) || items[0];
  }, [items, selectedItemGuid]);

  const mastodonPreview = useMemo(() => {
    if (!selectedItem) return null;
    return renderFormattedPreview(selectedItem, formatting, 'mastodon', envVars);
  }, [selectedItem, formatting, envVars]);

  const threadsPreview = useMemo(() => {
    if (!selectedItem) return null;
    return renderFormattedPreview(selectedItem, formatting, 'threads', envVars);
  }, [selectedItem, formatting, envVars]);

  const currentActionDefinition = useMemo(() => {
    return ACTION_CARDS.find((c) => c.id === selectedActionType) || ACTION_CARDS[0];
  }, [selectedActionType]);

  const handleUpdateTrigger = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem(STORAGE_KEY_TRIGGER_URL, triggerFeedUrl);
    } catch {
      // ignore
    }

    setIsPolling(true);
    const resolvedUrl = resolveEnvVariablesInString(triggerFeedUrl, envVars);
    setStatusBanner(`Polling live bridge feed...`);

    try {
      const res = await fetch('/api/pipeline/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedId: 'active-trigger-feed',
          feedName: 'RSS-Bridge Feed',
          bridgeUrl: resolvedUrl,
        }),
      });

      const data = await res.json();
      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        const incoming: NormalizedFeedItem[] = data.items;
        setItems(incoming);
        setSelectedItemGuid(incoming[0].guid);
        setStatusBanner(`Success: Loaded ${incoming.length} items`);
      } else {
        setStatusBanner(data.error ? `Notice: ${data.error}` : 'Feed checked (0 items returned)');
      }
      setViewMode('applet_home');
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Failed to reach feed URL');
      setViewMode('applet_home');
    } finally {
      setIsPolling(false);
    }
  };

  const handleVerifyCredential = async (platform: 'mastodon' | 'threads') => {
    setVerifyStatus((s) => ({ ...s, [platform]: { loading: true } }));
    try {
      const res = await fetch('/api/pipeline/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          mastodonInstanceUrl: getEnvValue(envVars, 'MASTODON_INSTANCE_URL', 'https://mastodon.social'),
          mastodonAccessToken: getEnvValue(envVars, 'MASTODON_ACCESS_TOKEN', ''),
          threadsUserId: getEnvValue(envVars, 'THREADS_USER_ID', ''),
          threadsAccessToken: getEnvValue(envVars, 'THREADS_ACCESS_TOKEN', ''),
        }),
      });
      const data = await res.json();
      if (data.verified) {
        setVerifyStatus((s) => ({
          ...s,
          [platform]: { loading: false, verified: true, message: `Connected as ${data.handle}` },
        }));
      } else {
        setVerifyStatus((s) => ({
          ...s,
          [platform]: { loading: false, verified: false, message: data.message || 'Verification failed' },
        }));
      }
    } catch (err) {
      setVerifyStatus((s) => ({
        ...s,
        [platform]: { loading: false, verified: false, message: err instanceof Error ? err.message : 'Error' },
      }));
    }
  };

  const handleRunAppletNow = async () => {
    if (!selectedItem || !mastodonPreview || !threadsPreview) return;
    setIsPublishing(true);

    const platforms: ('mastodon' | 'threads')[] =
      activeServiceTab === 'both'
        ? ['threads', 'mastodon']
        : activeServiceTab === 'mastodon'
          ? ['mastodon']
          : ['threads'];

    const mediaUrls =
      selectedActionType === 'carousel'
        ? actionCarouselUrls.split(',').map((s) => s.trim()).filter(Boolean)
        : selectedItem.enclosures && selectedItem.enclosures.length > 0
          ? selectedItem.enclosures.map((e) => e.url)
          : actionMediaUrl
            ? [actionMediaUrl]
            : [];

    try {
      const res = await fetch('/api/pipeline/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemGuid: selectedItem.guid,
          itemTitle: selectedItem.title,
          feedId: selectedItem.feedId,
          platforms,
          actionType: selectedActionType,
          mastodonPosts: mastodonPreview.posts,
          threadsPosts: threadsPreview.posts,
          linkUrl: resolveEnvVariablesInString(
            actionLinkUrl.replace('{link}', selectedItem.link),
            envVars
          ),
          mediaUrls,
          visibility: formatting.mastodonVisibility,
          credentials: {
            mastodonInstanceUrl: getEnvValue(envVars, 'MASTODON_INSTANCE_URL', 'https://mastodon.social'),
            mastodonAccessToken: getEnvValue(envVars, 'MASTODON_ACCESS_TOKEN', ''),
            threadsUserId: getEnvValue(envVars, 'THREADS_USER_ID', ''),
            threadsAccessToken: getEnvValue(envVars, 'THREADS_ACCESS_TOKEN', ''),
          },
        }),
      });

      const data = await res.json();
      if (data.traces && Array.isArray(data.traces)) {
        setPublishTraces(data.traces);
        setSeenLedger((prev) => [
          {
            guid: selectedItem.guid,
            hashId: selectedItem.hashId,
            feedId: selectedItem.feedId,
            title: selectedItem.title,
            status:
              platforms.length === 2
                ? 'published_both'
                : platforms[0] === 'mastodon'
                  ? 'published_mastodon'
                  : 'published_threads',
            reason: `Published via "${currentActionDefinition.title}" (${data.traces.length} steps)`,
            processedAt: new Date().toISOString(),
          },
          ...prev.filter((s) => s.guid !== selectedItem.guid),
        ]);
        setStatusBanner(`Syndicated to ${platforms.join(' & ')} successfully!`);
        setViewMode('applet_home');
      } else if (data.error) {
        setStatusBanner(`Error: ${data.error}`);
      }
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-6 lg:px-10 py-3 bg-white border-b border-slate-200">
        <div className="flex items-center gap-3">
          <a
            href="#home"
            onClick={(e) => {
              e.preventDefault();
              setViewMode('applet_home');
            }}
            className="text-lg font-black tracking-tight text-slate-950 flex items-center gap-2"
          >
            <span className="w-8 h-8 rounded-xl bg-orange-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
              BR
            </span>
            BridgeRelay
          </a>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-xs font-bold text-slate-600">
          <button
            type="button"
            onClick={() => setViewMode('applet_home')}
            className={`py-1 border-b-2 transition ${viewMode === 'applet_home' ? 'border-slate-900 text-slate-950' : 'border-transparent hover:text-slate-900'}`}
          >
            Applet
          </button>
          <button
            type="button"
            onClick={() => setViewMode('edit_trigger')}
            className={`py-1 border-b-2 transition ${viewMode === 'edit_trigger' ? 'border-orange-600 text-orange-600' : 'border-transparent hover:text-slate-900'}`}
          >
            Trigger (RSS)
          </button>
          <button
            type="button"
            onClick={() => setViewMode('choose_action')}
            className={`py-1 border-b-2 transition ${viewMode === 'choose_action' ? 'border-slate-900 text-slate-950' : 'border-transparent hover:text-slate-900'}`}
          >
            Actions
          </button>
          <button
            type="button"
            onClick={() => setViewMode('edit_action')}
            className={`py-1 border-b-2 transition ${viewMode === 'edit_action' ? 'border-slate-900 text-slate-950' : 'border-transparent hover:text-slate-900'}`}
          >
            Template
          </button>
          <button
            type="button"
            onClick={() => setViewMode('connections')}
            className={`py-1 border-b-2 transition ${viewMode === 'connections' ? 'border-slate-900 text-slate-950' : 'border-transparent hover:text-slate-900'}`}
          >
            Credentials & OAuth
          </button>
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleConnectThreads}
            disabled={isConnectingThreads}
            className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 border shadow-sm transition ${
              threadsUserId
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                : 'bg-black text-white border-black hover:bg-neutral-800'
            }`}
          >
            <span className="font-extrabold text-xs">@</span>
            <span>
              {isConnectingThreads
                ? 'Connecting...'
                : threadsUserId
                  ? 'Threads Connected'
                  : 'Connect Threads'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleRunAppletNow}
            disabled={isPublishing}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-slate-900 rounded-full hover:bg-slate-800 disabled:opacity-50 shadow-sm"
          >
            {isPublishing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            <span>{isPublishing ? 'Publishing...' : 'Run Now'}</span>
          </button>
        </div>
      </header>

      {statusBanner && (
        <div className="bg-slate-900 text-white text-xs font-semibold text-center py-2 px-4 border-b border-slate-800">
          {statusBanner}
        </div>
      )}

      {/* VIEW: TRIGGER */}
      {viewMode === 'edit_trigger' && (
        <div className="flex-1 bg-gradient-to-b from-[#EA7600] to-[#C95B00] text-white flex flex-col items-center justify-center px-6 py-12">
          <div className="w-full max-w-xl mx-auto flex flex-col items-center">
            <div className="w-full flex items-center justify-start mb-6">
              <button
                type="button"
                onClick={() => setViewMode('applet_home')}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-white/80 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Applet</span>
              </button>
            </div>

            <div className="w-16 h-16 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center mb-4">
              <Rss className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-black text-center mb-1">Edit RSS Trigger</h1>
            <p className="text-xs text-white/80 mb-6 text-center max-w-md">
              Enter your live RSS-Bridge feed URL (Atom, MRSS, or JSON format supported)
            </p>

            <form onSubmit={handleUpdateTrigger} className="w-full space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-white/80 mb-2">
                  Feed URL
                </label>
                <textarea
                  rows={4}
                  required
                  value={triggerFeedUrl}
                  onChange={(e) => setTriggerFeedUrl(e.target.value)}
                  className="w-full bg-white text-slate-900 rounded-xl p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-white"
                />
                <button
                  type="button"
                  onClick={() => setShowUrlHelper((v) => !v)}
                  className="mt-2 text-xs font-bold underline text-white/90 hover:text-white"
                >
                  {showUrlHelper ? 'Hide Presets' : 'Choose from Bridge Presets'}
                </button>
              </div>

              {showUrlHelper && (
                <div className="bg-black/25 rounded-xl p-3 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {QUICK_BRIDGE_EXAMPLES.map((ex) => (
                      <button
                        key={ex.label}
                        type="button"
                        onClick={() => setTriggerFeedUrl(ex.url)}
                        className="px-2.5 py-1 text-xs font-bold bg-white text-slate-900 rounded-lg hover:bg-slate-100"
                      >
                        {ex.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-center">
                <button
                  type="submit"
                  disabled={isPolling}
                  className="bg-white text-slate-950 font-black text-sm px-8 py-3 rounded-full hover:bg-slate-100 shadow-md disabled:opacity-60"
                >
                  {isPolling ? 'Fetching Feed...' : 'Save & Check Feed'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW: CHOOSE ACTION */}
      {viewMode === 'choose_action' && (
        <div className="flex-1 flex flex-col bg-white">
          <div className="bg-slate-900 text-white pt-8 pb-10 px-6 flex flex-col items-center">
            <div className="flex items-center gap-1 bg-white/10 p-1 rounded-full mb-6 text-xs font-bold">
              {(['both', 'threads', 'mastodon'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveServiceTab(tab)}
                  className={`px-4 py-1.5 rounded-full capitalize transition ${
                    activeServiceTab === tab ? 'bg-white text-slate-950 shadow-sm' : 'text-white/70 hover:text-whi