/**
 * Connectionless replacement for the former ioredis-backed Redis layer.
 *
 * The CTO mandate is "kill redis, we don't use that anymore." The console queue
 * layer now runs on `@hanzo/mq` (Temporal / in-process driver), and caches/locks
 * run in-process or on the app DB. This module keeps the *export surface* the
 * rest of the codebase imports — `createNewRedisInstance`, `redis`,
 * `getQueuePrefix`, `redisQueueRetryOptions`, `scanKeys`, `safeMultiDel` — so
 * the ~30 queue definitions and the cache callers compile and run unchanged,
 * but with ZERO `ioredis` dependency.
 *
 * Two roles are served by one in-process implementation:
 *   1. Queue connection sentinel — `createNewRedisInstance()` returns a truthy
 *      object so the `const q = conn ? new Queue(...) : null` guards in every
 *      `XxxQueue.getInstance()` keep producing real `@hanzo/mq` queues. The
 *      facade ignores the connection; the active driver owns transport.
 *   2. Cache store — the same object implements the small ioredis subset the
 *      caches call (`get/set/setex/del/exists/smembers/sadd/keys`), backed by a
 *      bounded TTL map. Per-process by design: the app DB is SQLite
 *      (single-writer, co-located), so a cross-process cache buys little; short
 *      TTLs bound staleness. (Cross-process *locks* moved to the app DB —
 *      see worker AdvisoryLock — not this in-process store.)
 */
import { env } from "../../env";
import { logger } from "../logger";

const MAX_CACHE_ENTRIES = 50_000;

interface Entry {
  value: string;
  /** Epoch ms when this entry expires, or null for no expiry. */
  expiresAt: number | null;
}

/**
 * Minimal in-process implementation of the ioredis methods the console uses.
 * Strings + sets only; TTL via lazy expiry on read plus a bounded LRU-ish cap.
 */
export class InProcessRedis {
  /** Marks this as the connectionless replacement (diagnostics only). */
  public readonly inProcess = true;
  /** ioredis-compatible status; always "ready" so callers proceed. */
  public readonly status: string = "ready";

  private store = new Map<string, Entry>();
  private sets = new Map<string, Set<string>>();
  private readonly keyPrefix: string;

  constructor(opts: { keyPrefix?: string } = {}) {
    this.keyPrefix = opts.keyPrefix ?? "";
  }

  private k(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}${key}` : key;
  }

  private isExpired(e: Entry): boolean {
    return e.expiresAt != null && e.expiresAt <= Date.now();
  }

  private evictIfNeeded(): void {
    if (this.store.size <= MAX_CACHE_ENTRIES) return;
    // Drop the oldest insertion (Map preserves insertion order).
    const oldest = this.store.keys().next().value;
    if (oldest !== undefined) this.store.delete(oldest);
  }

  async get(key: string): Promise<string | null> {
    const e = this.store.get(this.k(key));
    if (!e) return null;
    if (this.isExpired(e)) {
      this.store.delete(this.k(key));
      return null;
    }
    return e.value;
  }

  /**
   * Supports the call shapes used in the codebase:
   *   set(key, value)
   *   set(key, value, "EX", seconds)
   *   set(key, value, "PX", ms)
   *   set(key, value, "EX", seconds, "NX")  // returns "OK" or null
   */
  async set(key: string, value: string, ...args: Array<string | number>): Promise<"OK" | null> {
    let expiresAt: number | null = null;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      const token = String(args[i]).toUpperCase();
      if (token === "EX") {
        expiresAt = Date.now() + Number(args[++i]) * 1000;
      } else if (token === "PX") {
        expiresAt = Date.now() + Number(args[++i]);
      } else if (token === "NX") {
        nx = true;
      } else if (token === "XX") {
        if (!this.store.has(this.k(key))) return null;
      }
    }
    if (nx) {
      const existing = this.store.get(this.k(key));
      if (existing && !this.isExpired(existing)) return null;
    }
    this.store.set(this.k(key), { value, expiresAt });
    this.evictIfNeeded();
    return "OK";
  }

  async setex(key: string, seconds: number, value: string): Promise<"OK"> {
    this.store.set(this.k(key), { value, expiresAt: Date.now() + seconds * 1000 });
    this.evictIfNeeded();
    return "OK";
  }

  async del(...keys: Array<string | string[]>): Promise<number> {
    const flat = keys.flat();
    let n = 0;
    for (const key of flat) {
      if (this.store.delete(this.k(key))) n++;
      if (this.sets.delete(this.k(key))) n++;
    }
    return n;
  }

  async exists(...keys: string[]): Promise<number> {
    let n = 0;
    for (const key of keys) {
      const e = this.store.get(this.k(key));
      if (e && !this.isExpired(e)) n++;
    }
    return n;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const e = this.store.get(this.k(key));
    if (!e || this.isExpired(e)) return 0;
    e.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async sadd(key: string, ...members: Array<string | string[]>): Promise<number> {
    const set = this.sets.get(this.k(key)) ?? new Set<string>();
    let added = 0;
    for (const m of members.flat()) {
      if (!set.has(m)) {
        set.add(m);
        added++;
      }
    }
    this.sets.set(this.k(key), set);
    return added;
  }

  async srem(key: string, ...members: Array<string | string[]>): Promise<number> {
    const set = this.sets.get(this.k(key));
    if (!set) return 0;
    let removed = 0;
    for (const m of members.flat()) {
      if (set.delete(m)) removed++;
    }
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(this.k(key)) ?? []);
  }

  async keys(pattern: string): Promise<string[]> {
    // Translate a glob-ish redis pattern to a RegExp. Supports `*` and `?`.
    const stripped = this.keyPrefix && pattern.startsWith(this.keyPrefix);
    const re = new RegExp(
      "^" +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".") +
        "$",
    );
    const out: string[] = [];
    for (const [storedKey, e] of this.store.entries()) {
      if (this.isExpired(e)) continue;
      const candidate = this.keyPrefix && !stripped ? storedKey : storedKey;
      if (re.test(candidate)) out.push(candidate);
    }
    return out;
  }

  async scan(
    cursor: string | number,
    ...args: Array<string | number>
  ): Promise<[string, string[]]> {
    // One-shot scan: ignore COUNT, honor MATCH, always return cursor "0".
    let match = "*";
    for (let i = 0; i < args.length; i++) {
      if (String(args[i]).toUpperCase() === "MATCH") match = String(args[++i]);
    }
    return ["0", await this.keys(match)];
  }

  /**
   * Evaluate the small Lua scripts the codebase uses. We do not run Lua; we
   * pattern-match the two scripts in use (atomic check-and-delete for locks).
   * Any other script resolves to null (no-op) — safe because callers treat a
   * null/0 result as "not acted".
   */
  async eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown> {
    const keys = args.slice(0, numKeys).map(String);
    const argv = args.slice(numKeys).map(String);
    // RedisLock release: delete key iff value matches.
    if (script.includes('redis.call("get"') && script.includes('redis.call("del"')) {
      const current = await this.get(keys[0]);
      if (current === argv[0]) {
        await this.del(keys[0]);
        return 1;
      }
      return 0;
    }
    return null;
  }

  async ping(): Promise<"PONG"> {
    return "PONG";
  }

  disconnect(): void {
    this.store.clear();
    this.sets.clear();
  }

  async quit(): Promise<"OK"> {
    this.disconnect();
    return "OK";
  }

  /** Clear the entire in-process store (ioredis FLUSHALL parity; used by tests). */
  async flushall(): Promise<"OK"> {
    this.store.clear();
    this.sets.clear();
    return "OK";
  }

  /** ioredis EventEmitter parity — no events ever fire in-process. */
  on(): this {
    return this;
  }
}

/**
 * Stable name for "the cache/lock client" across the codebase. Formerly this
 * was `Redis | Cluster` from ioredis; it is now the connectionless in-process
 * implementation. Callers that only need the type should import this.
 */
export type RedisClient = InProcessRedis;

/**
 * Retained for source compatibility. BullMQ used these ioredis retry options;
 * `@hanzo/mq` ignores connection options, so this is an inert object.
 */
export const redisQueueRetryOptions: Record<string, unknown> = {};

/**
 * Returns a connectionless sentinel. Truthy so `conn ? new Queue(...) : null`
 * guards keep producing queues; also usable as an in-process cache client.
 */
export const createNewRedisInstance = (
  additionalOptions: { keyPrefix?: string } = {},
): InProcessRedis => {
  return new InProcessRedis({ keyPrefix: additionalOptions.keyPrefix ?? env.REDIS_KEY_PREFIX ?? undefined });
};

/**
 * Queue key prefix. With the Temporal/in-process backend there is no Redis
 * keyspace to namespace, but we keep the value so queue/task-queue names remain
 * stable across the migration. `REDIS_KEY_PREFIX` is honored if still set.
 */
export const getQueuePrefix = (_queueName: string): string | undefined => {
  return env.REDIS_KEY_PREFIX ?? undefined;
};

/** Delete many keys. Operates on the in-process client. */
export const safeMultiDel = async (client: InProcessRedis | null, keys: string[]): Promise<void> => {
  if (!client || keys.length === 0) return;
  await client.del(keys);
};

/** Scan keys matching a pattern. Operates on the in-process client. */
export const scanKeys = async (client: InProcessRedis | null, pattern: string): Promise<string[]> => {
  if (!client) return [];
  return client.keys(pattern);
};

const createCacheClient = (): InProcessRedis => {
  try {
    return new InProcessRedis({ keyPrefix: env.REDIS_KEY_PREFIX ?? undefined });
  } catch (e) {
    logger.error("Failed to initialize in-process cache", e);
    return new InProcessRedis();
  }
};

declare global {
  // eslint-disable-next-line no-var
  var redis: undefined | InProcessRedis;
}

/** Process-wide cache/lock singleton (replaces the former ioredis singleton). */
export const redis: InProcessRedis = globalThis.redis ?? createCacheClient();

if (env.NODE_ENV !== "production") globalThis.redis = redis;
