/**
 * BullMQ-compatible type surface used by Hanzo Console.
 *
 * These mirror the subset of `bullmq`'s public types that the console codebase
 * actually consumes, so that producers/consumers compile unchanged when the
 * `@hanzo/mq` alias points at this facade instead of `npm:bullmq`.
 */

/** Backoff strategy for retries. Mirrors BullMQ `BackoffOptions`. */
export interface BackoffOptions {
  type: "exponential" | "fixed" | (string & {});
  delay?: number;
}

/** Cron/repeat options. Mirrors the subset of BullMQ `RepeatOptions` we use. */
export interface RepeatOptions {
  /** Crontab pattern, e.g. every 20 minutes. */
  pattern?: string;
  /** Fixed interval in ms (alternative to pattern). */
  every?: number;
  /** Timezone for the cron pattern. */
  tz?: string;
  /** Identifier used to de-duplicate the schedule. */
  key?: string;
}

/** Deduplication options. Mirrors BullMQ `DeduplicationOptions`. */
export interface DeduplicationOptions {
  id: string;
  ttl?: number;
}

/** Per-job options. Mirrors the subset of BullMQ `JobsOptions` we use. */
export interface JobsOptions {
  jobId?: string;
  delay?: number;
  attempts?: number;
  backoff?: BackoffOptions | number;
  priority?: number;
  removeOnComplete?: boolean | number | { age?: number; count?: number };
  removeOnFail?: boolean | number | { age?: number; count?: number };
  repeat?: RepeatOptions;
  deduplication?: DeduplicationOptions;
  /** @deprecated BullMQ legacy alias retained for source compatibility. */
  repeatJobKey?: string;
}

/** Default options applied to every job added to a queue. */
export type DefaultJobOptions = JobsOptions;

/**
 * Connection placeholder. The facade is connectionless (the active driver owns
 * transport), but the type is retained because callers pass `{ connection }`.
 * Any value is accepted and ignored.
 */
export type ConnectionOptions = unknown;

/** Options accepted by `new Queue(name, opts)`. */
export interface QueueOptions {
  connection?: ConnectionOptions;
  prefix?: string;
  defaultJobOptions?: DefaultJobOptions;
  /** Accepted and ignored — present for BullMQ source compatibility. */
  streams?: unknown;
}

/** Rate limiter. Mirrors BullMQ `RateLimiterOptions`. */
export interface RateLimiterOptions {
  max: number;
  duration: number;
}

/** Options accepted by `new Worker(name, processor, opts)`. */
export interface WorkerOptions {
  connection?: ConnectionOptions;
  prefix?: string;
  concurrency?: number;
  limiter?: RateLimiterOptions;
  autorun?: boolean;
  lockDuration?: number;
  stalledInterval?: number;
  maxStalledCount?: number;
  /** Accepted and ignored — present for BullMQ source compatibility. */
  metrics?: unknown;
}

/**
 * A unit of work handed to a processor. Mirrors the subset of BullMQ `Job` the
 * console processors read (`id`, `name`, `data`, `timestamp`, `attemptsMade`).
 */
export interface Job<DataType = unknown, ReturnType = unknown, NameType extends string = string> {
  id?: string;
  name: NameType;
  data: DataType;
  opts: JobsOptions;
  timestamp: number;
  attemptsMade: number;
  /** Progress accessor; no-op in the facade unless the driver supports it. */
  updateProgress?: (progress: number | object) => Promise<void>;
  /** Append to job log; no-op unless the driver supports it. */
  log?: (row: string) => Promise<number>;
  /** @internal carries the resolved return value for drivers that need it. */
  returnvalue?: ReturnType;
}

/** Processor signature. Mirrors BullMQ `Processor`. */
export type Processor<DataType = unknown, ReturnType = unknown, NameType extends string = string> = (
  job: Job<DataType, ReturnType, NameType>,
) => Promise<ReturnType>;

/** Aggregate job counts. Mirrors BullMQ `JobCounts`. */
export interface JobCounts {
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  waiting: number;
  paused: number;
  "waiting-children"?: number;
  prioritized?: number;
}

/** A single bulk-add entry. Mirrors BullMQ `addBulk` input. */
export interface BulkJob<DataType = unknown, NameType extends string = string> {
  name: NameType;
  data: DataType;
  opts?: JobsOptions;
}

export type QueueEventName =
  | "error"
  | "waiting"
  | "active"
  | "completed"
  | "failed"
  | "progress"
  | "stalled"
  | "drained"
  | "removed"
  | "cleaned"
  | "paused"
  | "resumed"
  | "closing"
  | "closed"
  | "ready"
  | (string & {});
