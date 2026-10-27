'use client';

import React, { useState, useEffect } from 'react';
import {
  Rss,
  RefreshCw,
  Send,
  Power,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';

interface AccountInfo {
  userId: string;
  username: string;
  name?: string;
  profilePictureUrl?: string;
  connectedAt: string;
  autoPostEnabled: boolean;
  feedUrl: string;
  lastPolledAt?: string;
  lastError?: string;
}

interface SeenRecord {
  guidHash: string;
  guid: string;
  title: string;
  status: 'published' | 'seeded' | 'filtered_out' | 'failed';
  publishedAt: string;
  threadsPostId?: string;
  errorMessage?: string;
}

export default function BridgeRelayStudio() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [seenLedger, setSeenLedger] = useState<SeenRecord[]>([]);
  const [feedUrlInput, setFeedUrlInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const loadStatus = async () => {
    try {
      const res = await fetch('/api/pipeline/account');
      const data = await res.json();
      if (data.connected && data.account) {
        setAccount(data.account);
        setFeedUrlInput(data.account.feedUrl);
      } else {
        setAccount(null);
      }
      if (data.seenLedger) setSeenLedger(data.seenLedger);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();

    const handleAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === 'THREADS_AUTH_SUCCESS') {
        setStatusMessage(`Successfully connected @${event.data.username}`);
        loadStatus();
      } else if (event.data?.type === 'THREADS_AUTH_ERROR') {
        setStatusMessage(`Connection failed: ${event.data.message}`);
      }
    };
    window.addEventListener('message', handleAuthMessage);
    return () => window.removeEventListener('message', handleAuthMessage);
  }, []);

  const handleConnect = () => {
    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    window.open(
      '/api/auth/threads/login',
      'ThreadsAuth',
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,resizable=yes`
    );
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect this Threads account?')) return;
    setActionLoading(true);
    await fetch('/api/pipeline/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disconnect' }),
    });
    setAccount(null);
    setActionLoading(false);
  };

  const handleToggleAutoPost = async () => {
    if (!account) return;
    setActionLoading(true);
    const updated = !account.autoPostEnabled;
    await fetch('/api/pipeline/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_settings', autoPostEnabled: updated }),
    });
    setAccount({ ...account, autoPostEnabled: updated });
    setActionLoading(false);
  };

  const handleSaveFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    await fetch('/api/pipeline/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_settings', feedUrl: feedUrlInput }),
    });
    setStatusMessage('Feed URL updated!');
    setTimeout(() => setStatusMessage(''), 3000);
    setActionLoading(false);
  };

  const handleRunNow = async () => {
    setActionLoading(true);
    setStatusMessage('Checking feed and posting new items...');
    try {
      const res = await fetch('/api/pipeline/cron');
      const data = await res.json();
      if (data.success) {
        setStatusMessage(`Finished: published ${data.processed} item(s).`);
      } else {
        setStatusMessage(data.error || data.message || 'Complete');
      }
      await loadStatus();
    } catch {
      setStatusMessage('Error executing cron check');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      <header className="px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center font-black text-sm">
            @
          </div>
          <span className="font-extrabold text-base tracking-tight">Threads Auto-Relay</span>
        </div>

        {account ? (
          <div className="flex items-center gap-3">
            <div className="text-right text-xs">
              <div className="font-bold text-slate-900">@{account.username}</div>
              <div className="text-slate-500 text-[10px]">Connected</div>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={actionLoading}
              className="p-1.5 text-slate-400 hover:text-red-600 rounded"
              title="Disconnect"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={handleConnect}
            className="px-4 py-2 bg-black hover:bg-neutral-800 text-white rounded-full text-xs font-bold transition shadow-sm"
          >
            Connect Threads
          </button>
        )}
      </header>

      {statusMessage && (
        <div className="bg-slate-900 text-white text-xs py-2 px-4 text-center font-semibold">
          {statusMessage}
        </div>
      )}

      <main className="max-w-3xl w-full mx-auto p-6 space-y-6 flex-1">
        {loading ? (
          <div className="py-20 text-center text-slate-400 text-sm">Loading settings...</div>
        ) : !account ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4 shadow-sm">
            <div className="w-16 h-16 bg-black text-white rounded-full flex items-center justify-center mx-auto text-2xl font-black">
              @
            </div>
            <h2 className="text-xl font-black text-slate-950">Connect Your Threads Account</h2>
            <p className="text-xs text-slate-600 max-w-md mx-auto">
              Authorize your Threads account with 1-click using official OAuth 2.0. No access tokens or user IDs to copy and paste.
            </p>
            <button
              onClick={handleConnect}
              className="px-6 py-3 bg-black hover:bg-neutral-800 text-white text-sm font-bold rounded-full shadow-md transition"
            >
              Connect Threads with OAuth
            </button>
          </div>
        ) : (
          <>
            {/* Auto-posting Status */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${account.autoPostEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}
                  />
                  <h3 className="font-extrabold text-sm">
                    {account.autoPostEnabled ? 'Automatic Posting is Active' : 'Automatic Posting is Paused'}
                  </h3>
                </div>
                <p className="text-xs text-slate-500">
                  {account.lastPolledAt ? `Last checked: ${new Date(account.lastPolledAt).toLocaleTimeString()}` : 'Scheduled via cron'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleAutoPost}
                  disabled={actionLoading}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                    account.autoPostEnabled
                      ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                      : 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                  }`}
                >
                  <Power className="w-3.5 h-3.5 inline mr-1" />
                  {account.autoPostEnabled ? 'Pause' : 'Resume'}
                </button>

                <button
                  onClick={handleRunNow}
                  disabled={actionLoading}
                  className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-full text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
                >
                  {actionLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  <span>Check & Post Now</span>
                </button>
              </div>
            </div>

            {/* RSS Source Configuration */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex items-center gap-2">
                <Rss className="w-5 h-5 text-orange-600" />
                <h3 className="text-sm font-extrabold text-slate-950">Active RSS Feed Source</h3>
              </div>

              <form onSubmit={handleSaveFeed} className="space-y-3">
                <input
                  type="url"
                  required
                  value={feedUrlInput}
                  onChange={(e) => setFeedUrlInput(e.target.value)}
                  placeholder="https://example.com/feed.xml"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Supports RSS, Atom, and JSON Feeds.</span>
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-slate-800 shadow-sm"
                  >
                    Save Feed URL
                  </button>
                </div>
              </form>
            </div>

            {/* Recent Publications / Deduplication Ledger */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-extrabold uppercase text-slate-500 tracking-wider">
                Publication History & Duplicate Detection
              </h3>

              {seenLedger.length === 0 ? (
                <div className="text-xs text-slate-400 py-4 text-center">No articles posted yet.</div>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">
                  {seenLedger.map((item) => (
                    <div key={item.guidHash} className="py-2.5 flex items-center justify-between gap-4">
                      <div className="truncate">
                        <div className="font-semibold text-slate-900 truncate">{item.title}</div>
                        <div className="text-[10px] text-slate-400 font-mono truncate">{item.guid}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {item.status === 'published' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[11px] font-bold">
                            <CheckCircle2 className="w-3 h-3" /> Published
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-700 bg-red-50 px-2 py-0.5 rounded text-[11px] font-bold">
                            <AlertTriangle className="w-3 h-3" /> Failed
                          </span>
                        )}
                        {item.threadsPostId && (
                          <a
                            href={`https://threads.net/t/${item.threadsPostId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-black"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}