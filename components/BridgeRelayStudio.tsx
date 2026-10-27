'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Rss,
  Send,
  Trash2,
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

  const [selectedActionType, setSelectedActionType] = useState<SocialActionType>('image');
  const [actionLinkUrl, setActionLinkUrl] = useState<string>('{link}');
  const [actionMediaUrl, setActionMediaUrl] = useState<string>(
    'https://rss-bridge.org/static/release-2026-10-arch.png'
  );
  const [actionCarouselUrls, setActionCarouselUrls] = useState<string>(
    'https://rss-bridge.org/static/release-2026-10-arch.png'
  );

  const [envVars, setEnvVars] = useState<DashboardEnvVar[]>(INITIAL_DASHBOARD_ENV_VARS);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  const [newVarKey, setNewVarKey] = useState<string>('');
  const [newVarValue, setNewVarValue] = useState<string>('');
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

  // Load from local storage
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

  // Listen for OAuth message from Threads popup
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

  // 1-Click Threads Connect Popup
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
        : selectedItem.enclosures.length > 0
          ? selectedItem.enclosures.map((e) => e.url)
          : [actionMediaUrl];

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
      {/* Top Navigation */}
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
          {/* 1-Click Threads Connect Button */}
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
                    activeServiceTab === tab ? 'bg-white text-slate-950 shadow-sm' : 'text-white/70 hover:text-white'
                  }`}
                >
                  {tab === 'both' ? 'Both Destinations' : tab}
                </button>
              ))}
            </div>

            <h1 className="text-2xl font-black capitalize">
              {activeServiceTab === 'both' ? 'Cross-Post Actions' : `${activeServiceTab} Actions`}
            </h1>
            <p className="text-xs text-slate-400 mt-1">Select the action type to syndicate feed items</p>
          </div>

          <div className="max-w-4xl w-full mx-auto px-6 py-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {ACTION_CARDS.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => {
                    setSelectedActionType(card.id);
                    setFormatting((prev) => ({ ...prev, template: card.defaultTemplate }));
                    setViewMode('edit_action');
                  }}
                  className={`bg-white border-2 text-left rounded-xl p-5 flex flex-col justify-between transition hover:shadow-md ${
                    selectedActionType === card.id
                      ? 'border-orange-600 bg-orange-50/20'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600">
                      {card.id}
                    </span>
                    <h2 className="text-base font-black text-slate-950 mt-1 mb-2">{card.title}</h2>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {activeServiceTab === 'mastodon' ? card.mastodonDescription : card.threadsDescription}
                    </p>
                  </div>
                  <span className="text-[11px] font-bold text-slate-900 pt-4 underline">Configure template →</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* VIEW: EDIT ACTION */}
      {viewMode === 'edit_action' && (
        <div className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 space-y-6">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMode('choose_action')}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-950"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Actions</span>
            </button>
            <h1 className="text-xl font-black">{currentActionDefinition.title}</h1>
            <button
              type="button"
              onClick={() => setViewMode('applet_home')}
              className="px-4 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-full"
            >
              Save & Return
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <h2 className="text-sm font-black text-slate-950">Post Template</h2>
              <textarea
                rows={6}
                value={formatting.template}
                onChange={(e) => setFormatting((prev) => ({ ...prev, template: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
              />

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1.5">
                  Insert Variables
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {['{title}', '{summary}', '{link}', '{author}', '{source}', '{tags}', '{BRAND_SIGNATURE}', '{UTM_SUFFIX}'].map((tok) => (
                    <button
                      key={tok}
                      type="button"
                      onClick={() => setFormatting((prev) => ({ ...prev, template: `${prev.template} ${tok}` }))}
                      className="px-2 py-1 text-[11px] font-mono font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded border border-slate-200"
                    >
                      + {tok}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Live Preview */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <h2 className="text-sm font-black text-slate-950">Live Output Preview</h2>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-900">Meta Threads Post</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {threadsPreview?.effectiveCharCounts[0] || 0} / 500 chars
                  </span>
                </div>
                <div className="text-xs whitespace-pre-wrap font-sans bg-white p-3 rounded-lg border border-slate-200">
                  {threadsPreview?.posts[0] || 'No content rendered'}
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-purple-700">Mastodon Post</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {mastodonPreview?.effectiveCharCounts[0] || 0} / 500 chars
                  </span>
                </div>
                <div className="text-xs whitespace-pre-wrap font-sans bg-white p-3 rounded-lg border border-slate-200">
                  {mastodonPreview?.posts[0] || 'No content rendered'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: APPLET HOME */}
      {viewMode === 'applet_home' && (
        <div className="flex-1 max-w-3xl w-full mx-auto px-6 py-10 space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-3xl font-black text-slate-950">Syndication Pipeline</h1>
            <p className="text-xs text-slate-500">Automated RSS-Bridge ingestion to Mastodon & Meta Threads</p>
          </div>

          <div className="space-y-3">
            {/* Trigger card */}
            <div className="bg-gradient-to-r from-[#EA7600] to-[#D66500] text-white rounded-2xl p-5 shadow-sm flex items-center justify-between">
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-wider text-white/80">If This Trigger</div>
                <div className="text-lg font-black">New item in RSS-Bridge feed</div>
                <div className="text-xs font-mono text-white/90 truncate max-w-md">
                  {resolveEnvVariablesInString(triggerFeedUrl, envVars)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewMode('edit_trigger')}
                className="px-4 py-2 bg-white text-slate-950 text-xs font-bold rounded-full hover:bg-slate-100 shadow-sm"
              >
                Edit
              </button>
            </div>

            {/* Action card */}
            <div className="bg-slate-950 text-white rounded-2xl p-5 shadow-sm flex items-center justify-between">
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Then That Action</div>
                <div className="text-lg font-black">{currentActionDefinition.title}</div>
                <div className="text-xs text-slate-400">
                  Targeting:{' '}
                  <span className="font-semibold text-white capitalize">
                    {activeServiceTab === 'both' ? 'Mastodon & Threads' : activeServiceTab}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewMode('choose_action')}
                className="px-4 py-2 bg-white text-slate-950 text-xs font-bold rounded-full hover:bg-slate-100 shadow-sm"
              >
                Change
              </button>
            </div>
          </div>

          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={handleRunAppletNow}
              disabled={isPublishing}
              className="bg-slate-900 text-white font-black text-sm px-10 py-3.5 rounded-full hover:bg-slate-800 disabled:opacity-60 shadow-md inline-flex items-center gap-2"
            >
              {isPublishing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>{isPublishing ? 'Executing Pipeline...' : 'Run Applet Now'}</span>
            </button>
          </div>

          {publishTraces.length > 0 && (
            <div className="border border-slate-200 rounded-2xl p-4 space-y-2 bg-white shadow-sm">
              <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                Execution Log ({publishTraces.length} API Calls)
              </h3>
              <div className="space-y-1.5">
                {publishTraces.map((t) => (
                  <div
                    key={t.step}
                    className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs flex items-center justify-between font-mono"
                  >
                    <span className="truncate max-w-sm">
                      <strong className="uppercase font-bold text-slate-700">[{t.platform}]</strong> {t.endpoint}
                    </span>
                    <span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      HTTP {t.httpStatus} ({t.durationMs}ms)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW: CONNECTIONS & ENV */}
      {viewMode === 'connections' && (
        <div className="flex-1 max-w-4xl w-full mx-auto px-6 py-8 space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-black text-slate-950">Credentials & OAuth Connections</h1>
              <p className="text-xs text-slate-500">Authorize Meta Threads with 1-click or configure Mastodon</p>
            </div>
            <button
              type="button"
              onClick={() => setViewMode('applet_home')}
              className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-full"
            >
              Done
            </button>
          </div>

          {/* Quick OAuth Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Threads 1-Click Card */}
            <div className="p-5 bg-white border border-slate-200 rounded-2xl space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center font-black text-sm">
                    @
                  </span>
                  <span className="font-bold text-sm">Meta Threads</span>
                </div>
                <button
                  type="button"
                  onClick={handleConnectThreads}
                  disabled={isConnectingThreads}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold shadow-sm ${
                    threadsUserId
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-black text-white hover:bg-neutral-800'
                  }`}
                >
                  {isConnectingThreads ? 'Connecting...' : threadsUserId ? 'Reconnect' : 'Connect with Threads'}
                </button>
              </div>

              <p className="text-xs text-slate-600">
                {threadsUserId
                  ? `Authorized User ID: ${threadsUserId}. Ready for auto-publishing.`
                  : 'Requires THREADS_APP_ID below. Clicking opens the official Meta Threads OAuth login.'}
              </p>
            </div>

            {/* Mastodon Credentials Card */}
            <div className="p-5 bg-white border border-slate-200 rounded-2xl space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">
                    M
                  </span>
                  <span className="font-bold text-sm">Mastodon</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleVerifyCredential('mastodon')}
                  disabled={verifyStatus.mastodon?.loading}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-full border border-slate-200"
                >
                  {verifyStatus.mastodon?.loading ? 'Checking...' : 'Test Connection'}
                </button>
              </div>

              {verifyStatus.mastodon?.message && (
                <div
                  className={`text-xs flex items-center gap-1.5 ${
                    verifyStatus.mastodon.verified ? 'text-emerald-700 font-semibold' : 'text-red-700'
                  }`}
                >
                  {verifyStatus.mastodon.verified ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  <span>{verifyStatus.mastodon.message}</span>
                </div>
              )}
            </div>
          </div>

          {/* Variables table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
              API Keys & Configuration Store
            </div>
            <table className="w-full text-left text-xs">
              <tbody className="divide-y divide-slate-100 font-mono">
                {envVars.map((v) => (
                  <tr key={v.id}>
                    <td className="p-3 font-bold text-slate-900 w-1/3">
                      <div>{v.key}</div>
                      <div className="text-[10px] font-sans font-normal text-slate-500 mt-0.5">{v.description}</div>
                    </td>
                    <td className="p-3">
                      <input
                        type={v.isSecret && !revealedSecrets[v.id] ? 'password' : 'text'}
                        value={v.value}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateAndSaveEnvVars((prev) =>
                            prev.map((item) => (item.id === v.id ? { ...item, value: val } : item))
                          );
                        }}
                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-xs font-mono"
                      />
                    </td>
                    <td className="p-3 text-right">
                      {v.isSecret && (
                        <button
                          type="button"
                          onClick={() => setRevealedSecrets((prev) => ({ ...prev, [v.id]: !prev[v.id] }))}
                          className="p-1 text-slate-500 hover:text-slate-800"
                        >
                          {revealedSecrets[v.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}