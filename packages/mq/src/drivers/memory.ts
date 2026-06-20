/**
 * In-process driver for `@hanzo/mq`.
 *
 * Default when `TEMPORAL_ADDRESS` is unset. Runs producers and consumers in the
 * same process with BullMQ-equivalent semantics for the features console relies
 * on: per-job retries with exponential/fixed backoff, delayed jobs, and cron
 * repeat. It is intentionally not durable across process restarts — that is the
 * Temporal driver's job. This keeps local dev, CI, and the Next.js build green
 * with zero external infrastructure (the same role the local redis container
 * played before, minus the container).
 */
import { nanoid } from "nanoid";
import parser from "cron-parser";
import type { AddedJobRef, MqDriver } from "../driver";
import type { BackoffOptions, BulkJob, Job, JobCounts, JobsOptions, Processor, WorkerOptions } from "../types";

interface InternalJob {
  id: string;
  name: string;
  data: unknown;
  opts: JobsOptions;
  timestamp: number;
  attemptsMade: number;
  state: "waiting" | "active" | "completed" | "failed" | "delayed";
}

interface QueueState {
  jobs: Map<string, InternalJob>;
  processor: Processor | null;
  concurrency: number;
  running: boolean;
  activeCount: number;
  timers: Set<NodeJS.Timeout>;
  pumpScheduled: boolean;
}

function backoffDelayMs(backoff: BackoffOptions | number | undefined, attemptsMade: number): number {
  if (backoff == null) return 0;
  if (typeof backoff === "number") return backoff;
  const base = backoff.delay ?? 0;
  if (backoff.type === "exponential") {
    // BullMQ: delay * 2 ** (attemptsMade - 1)
    return base * Math.pow(2, Math.max(0, attemptsMade - 1));
  }
  return base;
}

export class MemoryDriver implements MqDriver {
  public readonly kind = "memory" as const;
  private queues = new Map<string, QueueState>();

  private ensure(queueName: string): QueueState {
    let q = this.queues.get(queueName);
    if (!q) {
      q = {
        jobs: new Map(),
        processor: null,
        concurrency: 1,
        running: false,
        activeCount: 0,
        timers: new Set(),
        pumpScheduled: false,
      };
      this.queues.set(queueName, q);
    }
    return q;
  }

  private schedulePump(queueName: string): void {
    const q = this.ensure(queueName);
    if (q.pumpScheduled) return;
    q.pumpScheduled = true;
    setImmediate(() => {
      q.pumpScheduled = false;
      void this.pump(queueName);
    });
  }

  private async pump(queueName: string): Promise<void> {
    const q = this.ensure(queueName);
    if (!q.running || !q.processor) return;

    while (q.activeCount < q.concurrency) {
      const next = [...q.jobs.values()].find((j) => j.state === "waiting");
      if (!next) break;
      next.state = "active";
      q.activeCount += 1;
      void this.runJob(queueName, next).finally(() => {
        q.activeCount -= 1;
        this.schedulePump(queueName);
      });
    }
  }

  private async runJob(queueName: string, job: InternalJob): Promise<void> {
    const q = this.ensure(queueName);
    const processor = q.processor;
    if (!processor) return;

    const publicJob: Job = {
      id: job.id,
      name: job.name,
      data: job.data,
      opts: job.opts,
      timestamp: job.timestamp,
      attemptsMade: job.attemptsMade,
      updateProgress: async () => undefined,
      log: async () => 0,
    };

    try {
      await processor(publicJob);
      job.state = "completed";
      const removeOnComplete = job.opts.removeOnComplete ?? true;
      if (removeOnComplete === true || typeof removeOnComplete === "number") {
        q.jobs.delete(job.id);
      }
      // Re-arm cron repeat.
      this.armRepeat(queueName, job);
    } catch {
      job.attemptsMade += 1;
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade < maxAttempts) {
        const delay = backoffDelayMs(job.opts.backoff, job.attemptsMade);
        job.state = "delayed";
        const t = setTimeout(() => {
          q.timers.delete(t);
          job.state = "waiting";
          this.schedulePump(queueName);
        }, delay);
        q.timers.add(t);
      } else {
        job.state = "failed";
        const removeOnFail = job.opts.removeOnFail;
        if (removeOnFail === true) q.jobs.delete(job.id);
        // Re-arm cron repeat even on terminal failure (matches BullMQ schedule).
        this.armRepeat(queueName, job);
      }
    }
  }

  private armRepeat(queueName: string, job: InternalJob): void {
    const pattern = job.opts.repeat?.pattern;
    const every = job.opts.repeat?.every;
    if (!pattern && !every) return;
    const q = this.ensure(queueName);
    let delay = 0;
    if (every) {
      delay = every;
    } else if (pattern) {
      try {
        const it = parser.parseExpression(pattern, { tz: job.opts.repeat?.tz });
        delay = Math.max(0, it.next().getTime() - Date.now());
      } catch {
        return;
      }
    }
    const t = setTimeout(() => {
      q.timers.delete(t);
      const repeated: InternalJob = {
        id: nanoid(),
        name: job.name,
        data: job.data,
        opts: job.opts,
        timestamp: Date.now(),
        attemptsMade: 0,
        state: "waiting",
      };
      q.jobs.set(repeated.id, repeated);
      this.schedulePump(queueName);
    }, delay);
    q.timers.add(t);
  }

  async add(queueName: string, jobName: string, data: unknown, opts: JobsOptions): Promise<AddedJobRef> {
    const q = this.ensure(queueName);
    const id = opts.jobId ?? opts.deduplication?.id ?? nanoid();
    // Deduplicate by explicit jobId / deduplication id.
    if ((opts.jobId || opts.deduplication?.id) && q.jobs.has(id)) {
      return { id, name: jobName };
    }
    const delay = opts.delay ?? 0;
    const job: InternalJob = {
      id,
      name: jobName,
      data,
      opts,
      timestamp: Date.now(),
      attemptsMade: 0,
      state: delay > 0 ? "delayed" : "waiting",
    };
    q.jobs.set(id, job);

    if (delay > 0) {
      const t = setTimeout(() => {
        q.timers.delete(t);
        job.state = "waiting";
        this.schedulePump(queueName);
      }, delay);
      q.timers.add(t);
    } else {
      this.schedulePump(queueName);
    }
    return { id, name: jobName };
  }

  async addBulk(queueName: string, jobs: BulkJob[]): Promise<AddedJobRef[]> {
    const out: AddedJobRef[] = [];
    for (const j of jobs) {
      out.push(await this.add(queueName, j.name, j.data, j.opts ?? {}));
    }
    return out;
  }

  async startWorker(queueName: string, processor: Processor, opts: WorkerOptions): Promise<void> {
    const q = this.ensure(queueName);
    q.processor = processor;
    q.concurrency = opts.concurrency ?? 1;
    q.running = opts.autorun !== false;
    if (q.running) this.schedulePump(queueName);
  }

  async stopWorker(queueName: string): Promise<void> {
    const q = this.queues.get(queueName);
    if (!q) return;
    q.running = false;
    q.processor = null;
    q.timers.forEach((t) => clearTimeout(t));
    q.timers.clear();
  }

  isWorkerRunning(queueName: string): boolean {
    return this.queues.get(queueName)?.running ?? false;
  }

  private stateCounts(queueName: string): JobCounts {
    const q = this.queues.get(queueName);
    const counts: JobCounts = {
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      waiting: 0,
      paused: 0,
    };
    if (!q) return counts;
    for (const j of q.jobs.values()) {
      if (j.state === "active") counts.active += 1;
      else if (j.state === "completed") counts.completed += 1;
      else if (j.state === "failed") counts.failed += 1;
      else if (j.state === "delayed") counts.delayed += 1;
      else counts.waiting += 1;
    }
    return counts;
  }

  async count(queueName: string): Promise<number> {
    const c = this.stateCounts(queueName);
    return c.waiting + c.active + c.delayed;
  }

  async getJobCounts(queueName: string): Promise<JobCounts> {
    return this.stateCounts(queueName);
  }

  async getJobs(queueName: string): Promise<Job[]> {
    const q = this.queues.get(queueName);
    if (!q) return [];
    return [...q.jobs.values()].map((j) => ({
      id: j.id,
      name: j.name,
      data: j.data,
      opts: j.opts,
      timestamp: j.timestamp,
      attemptsMade: j.attemptsMade,
    }));
  }

  async getJob(queueName: string, jobId: string): Promise<Job | undefined> {
    const j = this.queues.get(queueName)?.jobs.get(jobId);
    if (!j) return undefined;
    return {
      id: j.id,
      name: j.name,
      data: j.data,
      opts: j.opts,
      timestamp: j.timestamp,
      attemptsMade: j.attemptsMade,
    };
  }

  async remove(queueName: string, jobId: string): Promise<void> {
    this.queues.get(queueName)?.jobs.delete(jobId);
  }

  async drain(queueName: string): Promise<void> {
    const q = this.queues.get(queueName);
    if (!q) return;
    for (const [id, j] of [...q.jobs.entries()]) {
      if (j.state === "waiting" || j.state === "delayed") q.jobs.delete(id);
    }
  }

  async obliterate(queueName: string): Promise<void> {
    await this.stopWorker(queueName);
    this.queues.delete(queueName);
  }

  async close(queueName: string): Promise<void> {
    await this.stopWorker(queueName);
  }

  async shutdown(): Promise<void> {
    for (const name of [...this.queues.keys()]) {
      await this.stopWorker(name);
    }
    this.queues.clear();
  }
}
