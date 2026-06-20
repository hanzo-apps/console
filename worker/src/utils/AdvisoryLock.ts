import { randomUUID } from "crypto";
import { prisma, Prisma } from "@hanzo/console/src/db";
import { logger } from "@hanzo/console/src/server";

export type LockAcquireResult = "acquired" | "held_by_other" | "skipped";

/**
 * Behavior when the lock store is unavailable or errors during acquisition.
 * - "proceed": run without the lock (optimistic, non-critical sections)
 * - "fail": treat as failure to acquire (pessimistic, critical sections)
 */
export type OnUnavailableBehavior = "proceed" | "fail";

/**
 * Cross-process advisory lock backed by the application database.
 *
 * Replaces the former Redis-backed `RedisLock` (the "kill redis" mandate). The
 * app DB (SQLite in single-node, Postgres in multi-instance) is the natural
 * coordination point now that Redis is gone. Semantics match the old lock:
 *   - unique ownership token prevents releasing another worker's lock
 *   - atomic acquire via INSERT ... ON CONFLICT, taking over only expired locks
 *   - TTL expiry as a safety net (a crashed holder's lock self-heals)
 *   - configurable behavior when the store is unavailable
 *
 * The lock table is created on first use (no migration required) and is
 * portable across SQLite and Postgres.
 */
export class AdvisoryLock {
  private readonly lockKey: string;
  private readonly lockValue: string;
  private readonly ttlSeconds: number;
  private readonly name: string;
  private readonly onUnavailable: OnUnavailableBehavior;

  private static schemaReady: Promise<void> | null = null;

  public get key(): string {
    return this.lockKey;
  }

  constructor(
    lockKey: string,
    options: {
      ttlSeconds: number;
      name?: string;
      onUnavailable?: OnUnavailableBehavior;
    },
  ) {
    this.lockKey = lockKey;
    this.lockValue = randomUUID();
    this.ttlSeconds = options.ttlSeconds;
    this.name = options.name ?? lockKey;
    this.onUnavailable = options.onUnavailable ?? "proceed";
  }

  /** Create the lock table once per process (idempotent, portable). */
  private static ensureSchema(): Promise<void> {
    if (!AdvisoryLock.schemaReady) {
      AdvisoryLock.schemaReady = prisma
        .$executeRawUnsafe(
          `CREATE TABLE IF NOT EXISTS mq_advisory_lock (
             lock_key TEXT PRIMARY KEY,
             owner TEXT NOT NULL,
             expires_at BIGINT NOT NULL
           )`,
        )
        .then(() => undefined)
        .catch((error) => {
          // Reset so a later attempt can retry; surface the failure to callers.
          AdvisoryLock.schemaReady = null;
          throw error;
        });
    }
    return AdvisoryLock.schemaReady;
  }

  /**
   * Execute a callback under the advisory lock.
   * Returns null if the lock could not be acquired, otherwise the callback result.
   */
  public async withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    const lockResult = await this.acquire();
    const shouldProceed =
      lockResult === "acquired" || (lockResult === "skipped" && this.onUnavailable === "proceed");

    if (!shouldProceed) {
      return null;
    }

    try {
      return await fn();
    } finally {
      if (lockResult === "acquired") {
        await this.release();
      }
    }
  }

  /**
   * Attempt to acquire the lock.
   * - "acquired": got it
   * - "held_by_other": another live holder owns it
   * - "skipped": store unavailable; proceeding without the lock
   */
  public async acquire(): Promise<LockAcquireResult> {
    try {
      await AdvisoryLock.ensureSchema();
    } catch (error) {
      logger.warn(`[${this.name}] Lock store unavailable, allowing processing`, error);
      return "skipped";
    }

    // Small jitter to reduce thundering-herd on simultaneous worker start.
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));

    const now = Date.now();
    const expiresAt = now + this.ttlSeconds * 1000;

    try {
      // Atomic: insert if absent, or take over only if the existing lock expired.
      // ON CONFLICT ... WHERE is supported by both SQLite and Postgres.
      const affected = await prisma.$executeRaw`
        INSERT INTO mq_advisory_lock (lock_key, owner, expires_at)
        VALUES (${this.lockKey}, ${this.lockValue}, ${expiresAt})
        ON CONFLICT (lock_key) DO UPDATE
          SET owner = ${this.lockValue}, expires_at = ${expiresAt}
          WHERE mq_advisory_lock.expires_at < ${now}
      `;

      if (affected && affected > 0) {
        logger.debug(`[${this.name}] Acquired lock with TTL ${this.ttlSeconds}s`);
        return "acquired";
      }
      return "held_by_other";
    } catch (error) {
      logger.error(`[${this.name}] Failed to acquire lock due to an error`, error);
      return "skipped";
    }
  }

  /** Release the lock if (and only if) we still own it. */
  public async release(): Promise<boolean> {
    try {
      const affected = await prisma.$executeRaw`
        DELETE FROM mq_advisory_lock
        WHERE lock_key = ${this.lockKey} AND owner = ${this.lockValue}
      `;
      if (affected && affected > 0) {
        logger.debug(`[${this.name}] Released lock`);
        return true;
      }
      logger.warn(`[${this.name}] Lock was not released (not owned or already expired)`);
      return false;
    } catch (error) {
      // Log but don't throw — the lock self-heals via TTL.
      logger.error(`[${this.name}] Failed to release lock`, error);
      return false;
    }
  }
}

// `Prisma` is imported to keep the raw-SQL tagged-template typing available and
// to make the app-DB dependency explicit; the value is intentionally referenced.
void Prisma;
