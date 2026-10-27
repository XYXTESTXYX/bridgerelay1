import fs from 'node:fs';
import path from 'node:path';

export interface PersistentSeenRecord {
  guidHash: string;
  guid: string;
  feedId: string;
  title: string;
  status: 'published' | 'seeded' | 'filtered_out';
  publishedAt: string;
  mastodonStatusId?: string;
  threadsPostId?: string;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'seen_ledger.json');

function ensureStoreExists(): Record<string, PersistentSeenRecord> {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({}), 'utf-8');
    return {};
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function isItemSeen(guidHash: string): boolean {
  const store = ensureStoreExists();
  return Boolean(store[guidHash]);
}

export function markItemSeen(record: PersistentSeenRecord): void {
  const store = ensureStoreExists();
  store[record.guidHash] = record;
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export function getSeenRecords(): PersistentSeenRecord[] {
  const store = ensureStoreExists();
  return Object.values(store).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}