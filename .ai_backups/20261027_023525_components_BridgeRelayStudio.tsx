'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Plus,
  Rss,
  Send,
  Trash2,
} from 'lucide-react';
import {
  BridgeFeedSource,
  DashboardEnvVar,
  FilterRulesConfig,
  FormattingConfig,
  getEnvValue,
  INITIAL_BRIDGE_FEEDS,
  INITIAL_DASHBOARD_ENV_VARS,
  INITIAL_NORMALIZED_ITEMS,
  INITIAL_SEEN_STATE,
  InitialRunPolicy,
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
    threadsDescription: 'This action will create a text post on Threads.',
    mastodonDescription: 'This action will create a text post on Mastodon.',
    defaultTemplate: '{title}\n\n{summary}\n\n{tags}',
  },
  {
    id: 'link',
    title: 'Create a link post',
    threadsDescription: 'This action will create a link post on Threads.',
    mastodonDescription: 'This action will create a link post on Mastodon.',
    defaultTemplate: '{title}\n\n{summary}\n\n{link}{UTM_SUFFIX}',
  },
  {
    id: 'image',
    title: 'Create an image post',
    threadsDescription: 'This action will create an image post on Threads.',
    mastodonDescription: 'This action will create an image post on Mastodon.',
    defaultTemplate: '{title}\n\n{link}\n{tags}',
  },
  {
    id: 'video',
    title: 'Create a video post',
    threadsDescription: 'This action will create a video post on Threads.',
    mastodonDescription: 'This action will create a video post on Mastodon.',
    defaultTemplate: '{title} — Watch via {source}\n\n{link}\n{tags}',
  },
  {
    id: 'carousel',
    title: 'Create a carousel (multiple media) post',
    threadsDescription:
      'This action will create a carousel (multiple media) post on Threads. At least two items are required in the carousel.',
    mastodonDescription:
      'This action will create a multi-image carousel post on Mastodon (up to 4 media attachments).',
    defaultTemplate: '{title}\n\n{summary}\n\n{link}\n{tags}',
  },
];

const QUICK_BRIDGE_EXAMPLES = [
  {
    label: 'TikTok Bridge (By user)',
    url: 'https://rss-bridge.org/bridge01/?action=display&bridge=TikTokBridge&context=By+user&username=funnykittenstok&format=Atom',
  },
  {
    label: 'GitHub Releases Bridge',
    url: 'https://rss-bridge.org/bridge01/?action=display&bridge=GithubReleaseBridge&user=RSS-Bridge&repo=rss-bridge&format=Json',
  },
  {
    label: 'Instagram User Bridge',
    url: 'https://rss-bridge.org/bridge01/?action=display&bridge=InstagramBridge&context=Username&u=natgeo&media_type=all&format=Atom',
  },
  {
    label: 'YouTube Channel Bridge',
    url: 'https://rss-bridge.org/bridge01/?action=display&bridge=YoutubeBridge&context=By+username&u=fireship&format=Mrss',
  },
  {
    label: 'Hacker News Bridge',
    url: 'https://rss-bridge.org/bridge01/?action=display&bridge=HackerNewsBridge&area=newest&min_score=150&format=Atom',
  },
];

const STORAGE_KEY_ENV = 'bridgerelay_ifttt_env_v3';
const STORAGE_KEY_TRIGGER_URL = 'bridgerelay_ifttt_trigger_url_v3';

export default function BridgeRelayStudio() {
  const [viewMode, setViewMode] = useState<IftttViewMode>('choose_action');
  const [activeServiceTab, setActiveServiceTab] = useState<'threads' | 'mastodon' | 'both'>('threads');

  const [triggerFeedUrl, setTriggerFeedUrl] = useState<string>(
    'https://rss-bridge.org/bridge01/?action=display&bridge=TikTokBridge&context=By+user&username=funnykittenstok&format=Atom'
  );
  const [showUrlHelper, setShowUrlHelper] = useState<boolean>(false);
  const [initialRunPolicy, setInitialRunPolicy] = useState<InitialRunPolicy>('seed_only');
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState<number>(15);

  const [selectedActionType, setSelectedActionType] = useState<SocialActionType>('image');
  const [actionLinkUrl, setActionLinkUrl] = useState<string>('{link}');
  const [actionMediaUrl, setActionMediaUrl] = useState<string>(
    'https://rss-bridge.org/static/release-2026-10-arch.png'
  );
  const [actionCarouselUrls, setActionCarouselUrls] = useState<string>(
    'https://rss-bridge.org/static/slide-1.jpg, https://rss-bridge.org/static/slide-2.jpg'
  );

  const [envVars, setEnvVars] = useState<DashboardEnvVar[]>(INITIAL_DASHBOARD_ENV_VARS);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  const [newVarKey, setNewVarKey] = useState<string>('');
  const [newVarValue, setNewVarValue] = useState<string>('');
  const [statusBanner, setStatusBanner] = useState<string>('');

  const [items, setItems] = useState<NormalizedFeedItem[]>(INITIAL_NORMALIZED_ITEMS);
  const [selectedItemGuid, setSelectedItemGuid] = useState<string>(INITIAL_NORMALIZED_ITEMS[0].guid);
  const [seenLedger, setSeenLedger] = useState<SeenEntry[]>(INITIAL_SEEN_STATE);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);

  const [formatting, setFormatting] = useState<FormattingConfig>({
    template: '{title}\n\n{summary}\n\n{link}\n{tags}',
    mastodonMaxChars: 500,
    threadsMaxChars: 500,
    mastodonCountUrlAs23Chars: true,
    truncationStrategy: 'ellipsis',
    includeMediaAttachment: true,
    defaultHashtags: ['RSSBridge'],
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
    setStatusBanner('Saved credentials in dashboard');
    setTimeout(() => setStatusBanner(''), 2500);
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
    setStatusBanner(`Updating trigger & polling ${resolvedUrl}...`);

    try {
      const res = await fetch('/api/pipeline/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedId: 'ifttt-active-trigger',
          feedName: 'RSS-Bridge Trigger',
          bridgeUrl: resolvedUrl,
        }),
      });
      const data = await res.json();
      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        const incoming: NormalizedFeedItem[] = data.items;
        setItems((prev) => {
          const existing = new Set(prev.map((i) => i.guid));
          const fresh = incoming.filter((i) => !existing.has(i.guid));
          return [...fresh, ...prev];
        });
        setSelectedItemGuid(incoming[0].guid);
      }
      setStatusBanner('Trigger updated! Choose your action below.');
      setViewMode('choose_action');
    } catch {
      setStatusBanner('Trigger URL saved.');
      setViewMode('choose_action');
    } finally {
      setIsPolling(false);
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
            status: platforms.length === 2 ? 'published_both' : platforms[0] === 'mastodon' ? 'published_mastodon' : 'published_threads',
            reason: `Published via "${currentActionDefinition.title}" (${data.traces.length} API steps)`,
            processedAt: new Date().toISOString(),
          },
          ...prev.filter((s) => s.guid !== selectedItem.guid),
        ]);
        setStatusBanner(`Published to ${platforms.join(' & ')}!`);
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
    <div className="min-h-screen flex flex-col bg-white text-[#191919]">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-6 lg:px-10 py-4 bg-white border-b border-slate-200">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setViewMode('applet_home');
          }}
          className="text-xl font-extrabold tracking-tight text-[#191919]"
        >
          BridgeRelay
        </a>

        <nav className="hidden md:flex items-center gap-7 text-sm font-semibold text-slate-600">
          <button
            type="button"
            onClick={() => setViewMode('edit_trigger')}
            className={`py-1 border-b-2 ${viewMode === 'edit_trigger' ? 'border-[#EA7600] text-[#EA7600]' : 'border-transparent hover:text-black'}`}
          >
            Edit Trigger (RSS)
          </button>
          <button
            type="button"
            onClick={() => setViewMode('choose_action')}
            className={`py-1 border-b-2 ${viewMode === 'choose_action' ? 'border-black text-black' : 'border-transparent hover:text-black'}`}
          >
            Threads & Mastodon Actions
          </button>
          <button
            type="button"
            onClick={() => setViewMode('edit_action')}
            className={`py-1 border-b-2 ${viewMode === 'edit_action' ? 'border-black text-black' : 'border-transparent hover:text-black'}`}
          >
            Configure Post Ingredients
          </button>
          <button
            type="button"
            onClick={() => setViewMode('applet_home')}
            className={`py-1 border-b-2 ${viewMode === 'applet_home' ? 'border-black text-black' : 'border-transparent hover:text-black'}`}
          >
            Applet
          </button>
          <button
            type="button"
            onClick={() => setViewMode('connections')}
            className={`py-1 border-b-2 ${viewMode === 'connections' ? 'border-black text-black' : 'border-transparent hover:text-black'}`}
          >
            Dashboard Variables ({envVars.length})
          </button>
        </nav>

        <button
          type="button"
          onClick={handleRunAppletNow}
          disabled={isPublishing}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-extrabold text-white bg-[#191919] rounded-full hover:bg-neutral-800 disabled:opacity-60"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{isPublishing ? 'Publishing...' : 'Run Applet Now'}</span>
        </button>
      </header>

      {statusBanner && (
        <div className="bg-emerald-800 text-white text-xs font-semibold text-center py-2 px-4">
          {statusBanner}
        </div>
      )}

      {/* VIEW: TRIGGER */}
      {viewMode === 'edit_trigger' && (
        <div className="flex-1 bg-[#E56B00] text-white flex flex-col items-center justify-center px-6 py-14">
          <div className="w-full max-w-xl mx-auto flex flex-col items-center">
            <div className="w-full flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => setViewMode('applet_home')}
                className="inline-flex items-center gap-1.5 text-sm font-bold text-white/90 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
            </div>

            <h1 className="text-4xl font-extrabold text-center mb-6">Edit trigger</h1>
            <Rss className="w-24 h-24 text-white mb-6" />

            <form onSubmit={handleUpdateTrigger} className="w-full space-y-6">
              <div>
                <label className="block text-base font-extrabold text-white mb-2">Feed URL</label>
                <textarea
                  rows={4}
                  required
                  value={triggerFeedUrl}
                  onChange={(e) => setTriggerFeedUrl(e.target.value)}
                  className="w-full bg-white text-[#191919] rounded-2xl p-4 text-base focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowUrlHelper((v) => !v)}
                  className="mt-2 text-xs font-bold underline"
                >
                  {showUrlHelper ? 'Hide Presets' : 'Choose from Bridge Presets'}
                </button>
              </div>

              {showUrlHelper && (
                <div className="bg-black/20 rounded-2xl p-4 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {QUICK_BRIDGE_EXAMPLES.map((ex) => (
                      <button
                        key={ex.label}
                        type="button"
                        onClick={() => setTriggerFeedUrl(ex.url)}
                        className="px-3 py-1.5 text-xs font-bold bg-white text-black rounded-lg"
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
                  className="bg-white text-[#191919] font-extrabold text-xl px-12 py-4 rounded-full"
                >
                  {isPolling ? 'Checking Feed...' : 'Update trigger'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW: CHOOSE ACTION */}
      {viewMode === 'choose_action' && (
        <div className="flex-1 flex flex-col bg-white">
          <div className="bg-[#191919] text-white pt-10 pb-12 px-6 flex flex-col items-center">
            <div className="flex items-center gap-2 bg-white/10 p-1 rounded-full mb-8">
              {(['threads', 'mastodon', 'both'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveServiceTab(tab)}
                  className={`px-4 py-1.5 text-xs font-bold rounded-full capitalize ${activeServiceTab === tab ? 'bg-white text-black' : 'text-white/80'}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-3 text-3xl font-extrabold border-4 border-white">
              {activeServiceTab === 'mastodon' ? 'M' : '@'}
            </div>
            <h1 className="text-3xl font-extrabold capitalize">{activeServiceTab} Actions</h1>
          </div>

          <div className="max-w-5xl w-full mx-auto px-6 py-10">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {ACTION_CARDS.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => {
                    setSelectedActionType(card.id);
                    setFormatting((prev) => ({ ...prev, template: card.defaultTemplate }));
                    setViewMode('edit_action');
                  }}
                  className={`bg-[#191919] text-white rounded-2xl p-6 flex flex-col justify-between text-left min-h-[180px] hover:bg-neutral-900 ${selectedActionType === card.id ? 'ring-4 ring-[#EA7600]' : ''}`}
                >
                  <div>
                    <h2 className="text-xl font-extrabold text-white mb-2">{card.title}</h2>
                    <p className="text-xs text-white/80">
                      {activeServiceTab === 'mastodon' ? card.mastodonDescription : card.threadsDescription}
                    </p>
                  </div>
                  <span className="text-[10px] text-white/50 pt-4">Click to configure</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* VIEW: EDIT ACTION */}
      {viewMode === 'edit_action' && (
        <div className="flex-1 bg-[#191919] text-white flex flex-col items-center px-6 py-10">
          <div className="w-full max-w-2xl mx-auto space-y-6">
            <button
              type="button"
              onClick={() => setViewMode('choose_action')}
              className="inline-flex items-center gap-1.5 text-sm font-bold text-white/80"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to actions</span>
            </button>

            <h1 className="text-3xl font-extrabold text-center">{currentActionDefinition.title}</h1>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold mb-2">Post Template</label>
                <textarea
                  rows={4}
                  value={formatting.template}
                  onChange={(e) => setFormatting((prev) => ({ ...prev, template: e.target.value }))}
                  className="w-full bg-white text-black rounded-xl p-3 text-sm focus:outline-none"
                />
                <div className="flex flex-wrap gap-1 mt-2">
                  {['{title}', '{summary}', '{link}', '{author}', '{tags}'].map((tok) => (
                    <button
                      key={tok}
                      type="button"
                      onClick={() => setFormatting((prev) => ({ ...prev, template: `${prev.template} ${tok}` }))}
                      className="px-2 py-1 text-xs font-bold bg-white text-black rounded"
                    >
                      + {tok}
                    </button>
                  ))}
                </div>
              </div>

              {selectedActionType === 'image' && (
                <div>
                  <label className="block text-sm font-bold mb-1">Fallback Image URL</label>
                  <input
                    type="text"
                    value={actionMediaUrl}
                    onChange={(e) => setActionMediaUrl(e.target.value)}
                    className="w-full bg-white text-black rounded-lg p-2.5 text-xs font-mono"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-center gap-4">
              <button
                type="button"
                onClick={() => setViewMode('applet_home')}
                className="bg-white text-black font-extrabold text-lg px-10 py-3 rounded-full"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: APPLET HOME */}
      {viewMode === 'applet_home' && (
        <div className="flex-1 max-w-3xl w-full mx-auto px-6 py-10 space-y-8">
          <h1 className="text-3xl font-extrabold text-center">Your Active Applet</h1>

          <div className="space-y-4">
            <div className="bg-[#E56B00] text-white rounded-2xl p-6 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-white/70">If This</div>
                <div className="text-xl font-extrabold">New feed item (RSS)</div>
                <div className="text-xs font-mono truncate max-w-md mt-1">{triggerFeedUrl}</div>
              </div>
              <button
                type="button"
                onClick={() => setViewMode('edit_trigger')}
                className="px-4 py-2 bg-white text-black text-xs font-bold rounded-full"
              >
                Edit
              </button>
            </div>

            <div className="bg-[#191919] text-white rounded-2xl p-6 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-white/70">Then That</div>
                <div className="text-xl font-extrabold">{currentActionDefinition.title}</div>
              </div>
              <button
                type="button"
                onClick={() => setViewMode('choose_action')}
                className="px-4 py-2 bg-white text-black text-xs font-bold rounded-full"
              >
                Change
              </button>
            </div>
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleRunAppletNow}
              disabled={isPublishing}
              className="bg-[#191919] text-white font-extrabold text-lg px-10 py-4 rounded-full"
            >
              {isPublishing ? 'Publishing...' : 'Run Applet Now'}
            </button>
          </div>

          {publishTraces.length > 0 && (
            <div className="border border-slate-200 rounded-2xl p-4 space-y-2 bg-slate-50">
              <h3 className="text-xs font-extrabold">Last Execution Log ({publishTraces.length} API Calls)</h3>
              {publishTraces.map((t) => (
                <div key={t.step} className="p-2.5 bg-white border border-slate-200 rounded-lg text-xs flex justify-between">
                  <span className="font-mono">{t.platform}: {t.endpoint}</span>
                  <span className="font-bold text-emerald-700">HTTP {t.httpStatus}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW: CONNECTIONS & ENV */}
      {viewMode === 'connections' && (
        <div className="flex-1 max-w-4xl w-full mx-auto px-6 py-10 space-y-6">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-extrabold">Credentials & Variables</h1>
            <button
              type="button"
              onClick={() => setViewMode('applet_home')}
              className="px-4 py-2 bg-black text-white text-xs font-bold rounded-full"
            >
              Done
            </button>
          </div>

          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="p-3">Variable</th>
                  <th className="p-3">Value</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {envVars.map((v) => (
                  <tr key={v.id}>
                    <td className="p-3 font-mono font-bold">{v.key}</td>
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
                        className="w-full p-1.5 border border-slate-300 rounded font-mono text-xs"
                      />
                    </td>
                    <td className="p-3 text-right">
                      {v.isSecret && (
                        <button
                          type="button"
                          onClick={() => setRevealedSecrets((prev) => ({ ...prev, [v.id]: !prev[v.id] }))}
                          className="p-1 text-slate-500"
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