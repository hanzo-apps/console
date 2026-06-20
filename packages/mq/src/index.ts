/**
 * `@hanzo/mq` — BullMQ-API-compatible job-queue facade for Hanzo Console.
 *
 * Was an alias for `npm:bullmq` (redis-backed). Now a thin facade over a
 * pluggable driver: Temporal in production (when `TEMPORAL_ADDRESS` is set), an
 * in-process driver otherwise. This removes the hard Redis dependency from the
 * console queue layer while preserving the exact producer/consumer API, so the
 * ~70 call sites in `packages/shared`, `worker`, and `web` compile unchanged.
 *
 * See docs/architecture/kill-redis-temporal.md for the decision + mapping.
 */
export { Queue } from "./queue";
export { Worker } from "./worker";
export { QueueEvents } from "./queueEvents";
export type { QueueEventsOptions } from "./queueEvents";

export type {
  BackoffOptions,
  BulkJob,
  ConnectionOptions,
  DeduplicationOptions,
  DefaultJobOptions,
  Job,
  JobCounts,
  JobsOptions,
  Processor,
  QueueEventName,
  QueueOptions,
  RateLimiterOptions,
  RepeatOptions,
  WorkerOptions,
} from "./types";

export { getDriver, setDriver } from "./driver";
export type { MqDriver } from "./driver";
