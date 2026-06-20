/**
 * BullMQ-compatible `Worker` facade. The console `WorkerManager` constructs
 * these as `new Worker(queueName, processor, { connection, prefix, ...opts })`
 * and uses `.on("failed"|"error")`, `.close()`, and `.isRunning()`. The active
 * driver runs the processor; the facade bridges driver lifecycle/errors onto the
 * EventEmitter surface BullMQ exposes.
 */
import { EventEmitter } from "events";
import { getDriver } from "./driver";
import type { Job, Processor, WorkerOptions } from "./types";

export class Worker<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DataType = any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ResultType = any,
  NameType extends string = string,
> extends EventEmitter {
  public readonly name: string;
  public readonly opts: WorkerOptions;
  private readonly processor: Processor<DataType, ResultType, NameType>;
  private started: Promise<void>;
  private running = false;

  constructor(
    name: string,
    processor: Processor<DataType, ResultType, NameType>,
    opts: WorkerOptions = {},
  ) {
    super();
    this.name = name;
    this.opts = opts;
    this.processor = processor;

    // Wrap the processor so completion/failure are surfaced as BullMQ events.
    const wrapped: Processor = async (job: Job) => {
      try {
        const result = await processor(job as Job<DataType, ResultType, NameType>);
        this.emit("completed", job, result);
        return result;
      } catch (err) {
        this.emit("failed", job, err as Error);
        throw err;
      }
    };

    this.started = getDriver()
      .startWorker(name, wrapped, opts)
      .then(() => {
        this.running = true;
        this.emit("ready");
      })
      .catch((err) => {
        this.running = false;
        this.emit("error", err as Error);
      });
  }

  isRunning(): boolean {
    return this.running;
  }

  async waitUntilReady(): Promise<this> {
    await this.started;
    return this;
  }

  async run(): Promise<void> {
    await this.started;
  }

  async close(): Promise<void> {
    this.emit("closing");
    await getDriver().close(this.name);
    this.running = false;
    this.emit("closed");
  }
}
