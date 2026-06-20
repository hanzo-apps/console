/**
 * Temporal driver for `@hanzo/mq`.
 *
 * Maps the BullMQ queue model onto Temporal:
 *   - BullMQ queue name        -> Temporal Task Queue (with optional prefix)
 *   - queue.add(name, data)    -> start workflow `runJob` on that task queue
 *   - BullMQ attempts/backoff  -> activity RetryPolicy (carried in envelope)
 *   - BullMQ delay             -> workflow `startDelay`
 *   - BullMQ repeat (cron)     -> Temporal Schedule
 *   - new Worker(name, proc)   -> Temporal Worker on that task queue whose
 *                                 `process` activity invokes the console processor
 *
 * All `@temporalio/*` imports live in this file. The driver is loaded lazily
 * (see `driver.ts`) only when `TEMPORAL_ADDRESS` is set, so codebases/builds
 * without Temporal installed are unaffected.
 *
 * Runtime infra required: a reachable Temporal frontend (gRPC), e.g.
 * in-cluster `temporal.hanzo.svc:7233`, and a namespace (default `default`).
 */
import { Client, Connection, ScheduleClient, type ScheduleSpec } from "@temporalio/client";
import type { NativeConnection, Worker as TemporalWorker } from "@temporalio/worker";
import type { AddedJobRef, MqDriver } from "../driver";
import type { BackoffOptions, BulkJob, Job, JobCounts, JobsOptions, Processor, WorkerOptions } from "../types";
import type { JobEnvelope, RetrySpec } from "./temporal-workflows";

export interface TemporalDriverConfig {
  address: string;
  namespace: string;
  taskQueuePrefix: string;
}

interface TemporalWorkerModule {
  NativeConnection: typeof NativeConnection;
  Worker: typeof TemporalWorker;
}

/**
 * Load `@temporalio/worker` through an indirection opaque to static bundlers.
 * `require` is resolved off a computed string so Next/webpack do not trace into
 * it (which would drag `@swc/*` into the web bundle). Throws clearly if the
 * worker package is absent — only the worker process should reach this.
 */
function loadTemporalWorker(): TemporalWorkerModule {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dynamicRequire = eval("require") as NodeRequire;
  const pkg = ["@temporalio", "worker"].join("/");
  return dynamicRequire(pkg) as TemporalWorkerModule;
}

const DEFAULT_START_TO_CLOSE_MS = 60 * 60 * 1000; // 1 hour
const emptyCounts = (): JobCounts => ({
  active: 0,
  completed: 0,
  failed: 0,
  delayed: 0,
  waiting: 0,
  paused: 0,
});

function toRetrySpec(opts: JobsOptions): RetrySpec {
  const attempts = opts.attempts ?? 1;
  let initialIntervalMs = 1000;
  let backoffCoefficient = 1; // fixed by default
  const backoff: BackoffOptions | number | undefined = opts.backoff;
  if (typeof backoff === "number") {
    initialIntervalMs = backoff;
  } else if (backoff) {
    initialIntervalMs = backoff.delay ?? 1000;
    backoffCoefficient = backoff.type === "exponential" ? 2 : 1;
  }
  return { maximumAttempts: attempts, initialIntervalMs, backoffCoefficient };
}

export class TemporalDriver implements MqDriver {
  public readonly kind = "temporal" as const;
  private readonly cfg: TemporalDriverConfig;
  private clientPromise: Promise<Client> | null = null;
  private scheduleClientPromise: Promise<ScheduleClient> | null = null;
  private workers = new Map<string, { worker: TemporalWorker; runPromise: Promise<void>; running: boolean }>();

  constructor(cfg: TemporalDriverConfig) {
    this.cfg = cfg;
  }

  private taskQueue(queueName: string): string {
    return this.cfg.taskQueuePrefix ? `${this.cfg.taskQueuePrefix}.${queueName}` : queueName;
  }

  private async client(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const connection = await Connection.connect({ address: this.cfg.address });
        return new Client({ connection, namespace: this.cfg.namespace });
      })();
    }
    return this.clientPromise;
  }

  private async scheduleClient(): Promise<ScheduleClient> {
    if (!this.scheduleClientPromise) {
      this.scheduleClientPromise = (async () => {
        const connection = await Connection.connect({ address: this.cfg.address });
        return new ScheduleClient({ connection, namespace: this.cfg.namespace });
      })();
    }
    return this.scheduleClientPromise;
  }

  private buildEnvelope(queueName: string, id: string, name: string, data: unknown, opts: JobsOptions): JobEnvelope {
    return {
      queueName,
      jobId: id,
      name,
      data,
      timestamp: Date.now(),
      retry: toRetrySpec(opts),
      startToCloseTimeoutMs: DEFAULT_START_TO_CLOSE_MS,
    };
  }

  async add(queueName: string, jobName: string, data: unknown, opts: JobsOptions): Promise<AddedJobRef> {
    const client = await this.client();
    const id = opts.jobId ?? opts.deduplication?.id ?? `${jobName}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Cron repeat -> Temporal Schedule (idempotent upsert).
    if (opts.repeat?.pattern || opts.repeat?.every) {
      return this.upsertSchedule(queueName, jobName, data, opts, id);
    }

    const envelope = this.buildEnvelope(queueName, id, jobName, data, opts);
    await client.workflow.start("runJob", {
      taskQueue: this.taskQueue(queueName),
      workflowId: `${queueName}:${id}`,
      args: [envelope],
      startDelay: opts.delay && opts.delay > 0 ? `${opts.delay}ms` : undefined,
      // Dedup: reusing the same workflowId rejects duplicates while running.
      workflowIdReusePolicy: "ALLOW_DUPLICATE",
    });
    return { id, name: jobName };
  }

  private async upsertSchedule(
    queueName: string,
    jobName: string,
    data: unknown,
    opts: JobsOptions,
    id: string,
  ): Promise<AddedJobRef> {
    const schedules = await this.scheduleClient();
    const scheduleId = opts.repeat?.key ?? `${queueName}:${jobName}:repeat`;
    const envelope = this.buildEnvelope(queueName, id, jobName, data, opts);
    const spec: ScheduleSpec = opts.repeat?.pattern
      ? { cronExpressions: [opts.repeat.pattern] }
      : { intervals: [{ every: opts.repeat?.every ?? 0 }] };

    try {
      await schedules.create({
        scheduleId,
        spec,
        action: {
          type: "startWorkflow",
          workflowType: "runJob",
          taskQueue: this.taskQueue(queueName),
          args: [envelope],
        },
        policies: { overlap: "SKIP" },
      });
    } catch (err) {
      // Already exists -> update spec/action so pattern changes take effect.
      const handle = schedules.getHandle(scheduleId);
      await handle
        .update((prev) => {
          prev.spec = spec as typeof prev.spec;
          return prev;
        })
        .catch(() => {
          // Best-effort; surfacing the create error is more useful.
          throw err;
        });
    }
    return { id: scheduleId, name: jobName };
  }

  async addBulk(queueName: string, jobs: BulkJob[]): Promise<AddedJobRef[]> {
    const out: AddedJobRef[] = [];
    for (const j of jobs) {
      out.push(await this.add(queueName, j.name, j.data, j.opts ?? {}));
    }
    return out;
  }

  async startWorker(queueName: string, processor: Processor, opts: WorkerOptions): Promise<void> {
    if (this.workers.has(queueName)) return;

    // `@temporalio/worker` pulls a heavy workflow bundler (`@swc/*`). Only the
    // worker process ever starts workers, so we load it through a runtime
    // indirection that bundlers (Next/webpack in the web app) cannot follow —
    // the web app produces jobs via the client path above and never bundles
    // this. See docs/architecture/kill-redis-temporal.md.
    const workerMod = loadTemporalWorker();
    const { NativeConnection, Worker: RuntimeWorker } = workerMod;

    const connection = await NativeConnection.connect({ address: this.cfg.address });
    const activities = {
      async process(envelope: JobEnvelope): Promise<unknown> {
        const job: Job = {
          id: envelope.jobId,
          name: envelope.name,
          data: envelope.data,
          opts: {},
          timestamp: envelope.timestamp,
          attemptsMade: 0,
          updateProgress: async () => undefined,
          log: async () => 0,
          // Retry is handled by Temporal's activity RetryPolicy (throwing from
          // the processor triggers it); remove is a no-op for in-flight jobs.
          retry: async () => undefined,
          remove: async () => undefined,
        };
        return processor(job);
      },
    };

    const worker = await RuntimeWorker.create({
      connection,
      namespace: this.cfg.namespace,
      taskQueue: this.taskQueue(queueName),
      workflowsPath: require.resolve("./temporal-workflows"),
      activities,
      maxConcurrentActivityTaskExecutions: opts.concurrency ?? 1,
    });

    const entry = { worker, running: true, runPromise: Promise.resolve() };
    entry.runPromise = worker.run().finally(() => {
      entry.running = false;
    });
    this.workers.set(queueName, entry);
  }

  async stopWorker(queueName: string): Promise<void> {
    const entry = this.workers.get(queueName);
    if (!entry) return;
    entry.worker.shutdown();
    await entry.runPromise.catch(() => undefined);
    this.workers.delete(queueName);
  }

  isWorkerRunning(queueName: string): boolean {
    return this.workers.get(queueName)?.running ?? false;
  }

  // Introspection: Temporal's model differs from BullMQ's queue depth. We report
  // best-effort counts via visibility queries; failures degrade to zero so
  // metrics/admin endpoints never throw.
  async count(queueName: string): Promise<number> {
    try {
      const client = await this.client();
      const tq = this.taskQueue(queueName);
      const { count } = await client.workflow.count(
        `WorkflowType = 'runJob' AND TaskQueue = '${tq}' AND ExecutionStatus = 'Running'`,
      );
      return Number(count) || 0;
    } catch {
      return 0;
    }
  }

  async getJobCounts(queueName: string): Promise<JobCounts> {
    const counts = emptyCounts();
    counts.active = await this.count(queueName);
    return counts;
  }

  async getJobs(): Promise<Job[]> {
    return [];
  }

  async getJob(): Promise<Job | undefined> {
    return undefined;
  }

  async remove(queueName: string, jobId: string): Promise<void> {
    try {
      const client = await this.client();
      await client.workflow.getHandle(`${queueName}:${jobId}`).terminate("removed via @hanzo/mq");
    } catch {
      // ignore
    }
  }

  async drain(): Promise<void> {
    // No direct analogue; Temporal workflows complete on their own.
  }

  async obliterate(queueName: string): Promise<void> {
    await this.stopWorker(queueName);
  }

  async close(queueName: string): Promise<void> {
    await this.stopWorker(queueName);
  }

  async shutdown(): Promise<void> {
    for (const name of [...this.workers.keys()]) {
      await this.stopWorker(name);
    }
  }
}
