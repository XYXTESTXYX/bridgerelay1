import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export interface ThreadsAccount {
  userId: string;
  username: string;
  name?: string;
  profilePictureUrl?: string;
  encryptedAccessToken: string; // AES-256-GCM
  iv: string;
  authTag: string;
  tokenExpiresAt: number; // Unix timestamp ms
  connectedAt: string;
  autoPostEnabled: boolean;
  pollIntervalMinutes: number;
  feedUrl: string;
  lastPolledAt?: string;
  lastError?: string;
}

export interface PersistentSeenRecord {
  guidHash: string;
  guid: string;
  feedId: string;
  title: string;
  status: 'published' | 'seeded' | 'filtered_out' | 'failed';
  publishedAt: string;
  threadsPostId?: string;
  errorMessage?: string;
}

export interface DbSchema {
  accounts: Record<string, ThreadsAccount>;
  seenLedger: Record<string, PersistentSeenRecord>;
}

const DATA_DIR =
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join(os.tmpdir(), 'bridgerelay')
    : path.join(process.cwd(), 'data');

const DB_FILE = path.join(DATA_DIR, 'threads_store.json');

function getEncryptionKey(): Buffer {
  const secret = process.env.THREADS_APP_SECRET || process.env.ENCRYPTION_SECRET || 'fallback-dev-secret-32-chars-long!';
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptToken(token: string): { encrypted: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return { encrypted, iv: iv.toString('hex'), authTag };
}

export function decryptToken(encrypted: string, iv: string, authTag: string): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function ensureStore(): DbSchema {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      const initial: DbSchema = { accounts: {}, seenLedger: {} };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial), 'utf-8');
      return initial;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { accounts: {}, seenLedger: {} };
  }
}

function saveStore(data: DbSchema): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write to store:', err);
  }
}

// Account Operations
export function saveThreadsAccount(account: ThreadsAccount): void {
  const store = ensureStore();
  store.accounts[account.userId] = account;
  saveStore(store);
}

export function getActiveThreadsAccount(): ThreadsAccount | null {
  const store = ensureStore();
  const accounts = Object.values(store.accounts);
  return accounts.length > 0 ? accounts[0] : null;
}

export function removeThreadsAccount(userId: string): void {
  const store = ensureStore();
  delete store.accounts[userId];
  saveStore(store);
}

// Deduplication Ledger
export function isItemSeen(guidHash: string): boolean {
  const store = ensureStore();
  return Boolean(store.seenLedger[guidHash]);
}

export function markItemSeen(record: PersistentSeenRecord): void {
  const store = ensureStore();
  store.seenLedger[record.guidHash] = record;
  saveStore(store);
}

export function getSeenRecords(): PersistentSeenRecord[] {
  const store = ensureStore();
  return Object.values(store.seenLedger).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}