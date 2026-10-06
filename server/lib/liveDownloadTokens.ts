import { randomBytes } from 'node:crypto';

const INFO_HASH_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TOKEN_PATTERN = /^ld1_[A-Za-z0-9_-]{32}$/;
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_TOKENS = 10_000;
const CLEANUP_INTERVAL_MS = 60_000;

interface TokenRecord {
  userId: number;
  hash: string;
  expiresAt: number;
}

/**
 * Maps opaque, user-scoped IDs to torrent hashes inside this server process.
 * The media response and SSE route use the same process; a restart simply
 * causes the next media response to issue a fresh ID.
 */
export class LiveDownloadTokenRegistry {
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly tokenByUserAndHash = new Map<string, string>();
  private lastCleanup = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly makeToken: () => string = () =>
      `ld1_${randomBytes(24).toString('base64url')}`,
    private readonly ttlMs = DEFAULT_TOKEN_TTL_MS,
    private readonly maxTokens = DEFAULT_MAX_TOKENS
  ) {}

  public issue(downloadId: unknown, userId: number): string | undefined {
    if (!Number.isSafeInteger(userId) || userId < 0) {
      return undefined;
    }
    const hash = this.normalizeHash(downloadId);
    if (!hash) {
      return undefined;
    }

    const now = this.now();
    this.cleanup(now);
    const ownerKey = this.ownerKey(userId, hash);
    const existingToken = this.tokenByUserAndHash.get(ownerKey);
    const existing = existingToken ? this.tokens.get(existingToken) : undefined;
    if (existing && existing.expiresAt > now) {
      existing.expiresAt = now + this.ttlMs;
      this.touch(existingToken!, existing);
      return existingToken;
    }
    if (existingToken) {
      this.delete(existingToken);
    }

    let token = this.makeToken();
    while (this.tokens.has(token)) {
      token = this.makeToken();
    }
    if (!TOKEN_PATTERN.test(token)) {
      return undefined;
    }

    this.tokens.set(token, {
      userId,
      hash,
      expiresAt: now + this.ttlMs,
    });
    this.tokenByUserAndHash.set(ownerKey, token);
    this.trimToLimit();
    return token;
  }

  public resolve(token: unknown, userId: number): string | undefined {
    if (
      typeof token !== 'string' ||
      !TOKEN_PATTERN.test(token) ||
      !Number.isSafeInteger(userId) ||
      userId < 0
    ) {
      return undefined;
    }

    const now = this.now();
    this.cleanup(now);
    const record = this.tokens.get(token);
    if (!record || record.userId !== userId || record.expiresAt <= now) {
      if (record?.expiresAt !== undefined && record.expiresAt <= now) {
        this.delete(token);
      }
      return undefined;
    }

    record.expiresAt = now + this.ttlMs;
    this.touch(token, record);
    return record.hash;
  }

  private normalizeHash(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const hash = value.trim().toLowerCase();
    return INFO_HASH_PATTERN.test(hash) ? hash : undefined;
  }

  private ownerKey(userId: number, hash: string): string {
    return `${userId}:${hash}`;
  }

  private touch(token: string, record: TokenRecord): void {
    this.tokens.delete(token);
    this.tokens.set(token, record);
  }

  private cleanup(now: number): void {
    if (now - this.lastCleanup < CLEANUP_INTERVAL_MS) return;
    this.lastCleanup = now;
    for (const [token, record] of this.tokens) {
      if (record.expiresAt <= now) {
        this.delete(token);
      }
    }
  }

  private trimToLimit(): void {
    while (this.tokens.size > this.maxTokens) {
      const oldestToken = this.tokens.keys().next().value;
      if (!oldestToken) return;
      this.delete(oldestToken);
    }
  }

  private delete(token: string): void {
    const record = this.tokens.get(token);
    if (!record) return;
    this.tokens.delete(token);
    const ownerKey = this.ownerKey(record.userId, record.hash);
    if (this.tokenByUserAndHash.get(ownerKey) === token) {
      this.tokenByUserAndHash.delete(ownerKey);
    }
  }
}

const liveDownloadTokens = new LiveDownloadTokenRegistry();

export const issueLiveDownloadToken = (
  downloadId: unknown,
  userId: number
): string | undefined => liveDownloadTokens.issue(downloadId, userId);

export const resolveLiveDownloadToken = (
  token: unknown,
  userId: number
): string | undefined => liveDownloadTokens.resolve(token, userId);
