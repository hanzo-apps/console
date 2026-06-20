/**
 * Driver seam for `@hanzo/mq`.
 *
 * A driver owns the actual durable transport. The facade (`Queue`, `Worker`,
 * `QueueEvents`) is thin and delegates to the active driver. This is the one
 * place to swap backends: Temporal today; `hanzoai/tasks` (native ZAP) once it
 * ships a TS client + a working execution engine.
 *
 * Selection (decomplected, one rule): if `TEMPORAL_ADDRESS` is set the Temporal
 * driver is used; otherwise the in-process memory driver is used so local dev,
 * unit tests, and the Next.js build are hermetic and require zero infra.
 */
import type { BulkJob, Job, JobCounts, JobsOptions, Processor, WorkerOptions } from "./types";

export interface AddedJobRef {
  id: string;
  name: string;
}

export interface MqDriver {
  readonly kind: "memory" | "temporal";

  /** Enqueue a single job onto a queue. */
  add(queueName: string, jobName: string, data: unknown, opts: JobsOptions): Promise<AddedJobRef>;

  /** Enqueue many jobs onto a queue. */
  addBulk(queueName: string, jobs: BulkJob[]): Promise<AddedJobRef[]>;

  /** Start a consumer for a queue. Resolves once the worker is running. */
  startWorker(queueName: string, processor: Processor, opts: WorkerOptions): Promise<void>;

  /** Stop a consumer started via {@link startWorker}. */
  stopWorker(queueName: string): Promise<void>;

  /** Whether a worker for this queue is currently running. */
  isWorkerRunning(queueName: string): boolean;

  /** Count of jobs in a given state (best-effort; 0 if the driver can't tell). */
  count(queueName: string): Promise<number>;

  /** Aggregate counts by state. */
  getJobCounts(queueName: string): Promise<JobCounts>;

  /** Fetch jobs (best-effort; may be empty for drivers without introspection). */
  getJobs(queueName: string): Promise<Job[]>;

  /** Fetch a single job by id (best-effort). */
  getJob(queueName: string, jobId: string): Promise<Job | undefined>;

  /** Remove a job by id (best-effort). */
  remove(queueName: string, jobId: string): Promise<void>;

  /** Drain pending jobs from a queue (best-effort). */
  drain(queueName: string): Promise<void>;

  /** Remove all data for a queue (best-effort). */
  obliterate(queueName: string): Promise<void>;

  /** Release any resources held for a queue/worker. */
  close(queueName: string): Promise<void>;

  /** Release all driver resources (process shutdown). */
  shutdown(): Promise<void>;
}

let activeDriver: MqDriver | null = null;

/**
 * Resolve the active driver. The Temporal driver is loaded lazily (dynamic
 * import) so that environments without `@temporalio/*` installed — or without a
 * Temporal frontend — still compile and run on the memory driver.
 */
export function getDriver(): MqDriver {
  if (activeDriver) return activeDriver;

  const temporalAddress = process.env.TEMPORAL_ADDRESS;
  if (temporalAddress && temporalAddress.length > 0) {
    // Load the Temporal driver through an indirection opaque to static bundlers
    // (Next/webpack), so `@temporalio/*` is never pulled into the web bundle.
    // It is resolved at runtime only when TEMPORAL_ADDRESS is set.
    const dynamicRequire = eval("require") as NodeRequire;
    const { TemporalDriver } = dynamicRequire("./drivers/temporal") as typeof import("./drivers/temporal");
    activeDriver = new TemporalDriver({
      address: temporalAddress,
      namespace: process.env.TEMPORAL_NAMESPACE || "default",
      taskQueuePrefix: process.env.TEMPORAL_TASK_QUEUE_PREFIX || "",
    });
    return activeDriver;
  }

  // The in-process driver is plain TS with no heavy deps; a normal require is
  // fine and keeps it bundleable for environments that run jobs in-process.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { MemoryDriver } = require("./drivers/memory") as typeof import("./drivers/memory");
  activeDriver = new MemoryDriver();
  return activeDriver;
}

/** Test/seam override. */
export function setDriver(driver: MqDriver | null): void {
  activeDriver = driver;
}
