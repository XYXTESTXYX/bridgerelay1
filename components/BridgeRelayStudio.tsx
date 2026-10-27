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

  // Defaults to text to prevent 404 media errors on unseeded/text items
  const [selectedActionType, setSelectedActionType] = useState<SocialActionType>('text');
  const [actionLinkUrl, setActionLinkUrl] = useState<string>('{link}');
  const [actionMediaUrl, setActionMediaUrl] = useState<string>('');
  const [actionCarouselUrls, setActionCarouselUrls] = useState<string>('');

  const [envVars, setEnvVars] = useState<DashboardEnvVar[]>(INITIAL_DASHBOARD_ENV_VARS);
  const [revealedSecrets, setRevealedSec