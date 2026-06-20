/**
 * BullMQ-compatible `Queue` facade. Producers construct one of these via the
 * various `XxxQueue.getInstance()` singletons in console and call `.add()` /
 * `.addBulk()`. Introspection methods back the worker metrics + admin endpoints.
 *
 * The constructor accepts (and ignores) a `connection` so the existing call
 * sites — `new Queue(name, { connection, prefix, defaultJobOptions })` — compile
 * and run unchanged; the active driver owns transport.
 */
import { EventEmitter } from "events";
import { getDriver } from "./driver";
import type {
  BulkJob,
  DefaultJobOptions,
  Job,
  JobCounts,
  JobsOptions,
  QueueEventName,
  QueueOptions,
} from "./types";

export class Queue<
  DataType = unknown,
  ResultType = unknown,
  NameType extends string = string,
> extends EventEmitter {
  public readonly name: string;
  public readonly opts: QueueOptions;
  private readonly defaultJobOptions: DefaultJobOptions;

  constructor(name: string, opts: QueueOptions = {}) {
    super();
    this.name = name;
    this.opts = opts;
    this.defaultJobOptions = opts.defaultJobOptions ?? {};
  }

  private mergeOpts(opts?: JobsOptions): JobsOptions {
    return { ...this.defaultJobOptions, ...(opts ?? {}) };
  }

  async add(
    name: NameType,
    data: DataType,
    opts?: JobsOptions,
  ): Promise<{ id?: string; name: NameType }> {
    const ref = await getDriver().add(this.name, name, data, this.mergeOpts(opts));
    return { id: ref.id, name };
  }

  async addBulk(
    jobs: Array<BulkJob<DataType, NameType>>,
  ): Promise<Array<{ id?: string; name: NameType }>> {
    const withDefaults: BulkJob[] = jobs.map((j) => ({
      name: j.name,
      data: j.data,
      opts: this.mergeOpts(j.opts),
    }));
    const refs = await getDriver().addBulk(this.name, withDefaults);
    return refs.map((r, i) => ({ id: r.id, name: jobs[i].name }));
  }

  async count(): Promise<number> {
    return getDriver().count(this.name);
  }

  async getJobCounts(): Promise<JobCounts> {
    return getDriver().getJobCounts(this.name);
  }

  async getWaitingCount(): Promise<number> {
    return (await getDriver().getJobCounts(this.name)).waiting;
  }

  async getActiveCount(): Promise<number> {
    return (await getDriver().getJobCounts(this.name)).active;
  }

  async getFailedCount(): Promise<number> {
    return (await getDriver().getJobCounts(this.name)).failed;
  }

  async getDelayedCount(): Promise<number> {
    return (await getDriver().getJobCounts(this.name)).delayed;
  }

  async getCompletedCount(): Promise<number> {
    return (await getDriver().getJobCounts(this.name)).completed;
  }

  async getJobs(): Promise<Array<Job<DataType, ResultType, NameType>>> {
    return getDriver().getJobs(this.name) as Promise<Array<Job<DataType, ResultType, NameType>>>;
  }

  async getJob(jobId: string): Promise<Job<DataType, ResultType, NameType> | undefined> {
    return getDriver().getJob(this.name, jobId) as Promise<
      Job<DataType, ResultType, NameType> | undefined
    >;
  }

  async remove(jobId: string): Promise<void> {
    await getDriver().remove(this.name, jobId);
  }

  async drain(): Promise<void> {
    await getDriver().drain(this.name);
  }

  async obliterate(): Promise<void> {
    await getDriver().obliterate(this.name);
  }

  async close(): Promise<void> {
    await getDriver().close(this.name);
  }

  async waitUntilReady(): Promise<this> {
    return this;
  }

  // EventEmitter already supplies `on`; we keep the typed override for parity.
  override on(event: QueueEventName, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }
}
