/**
 * BullMQ-compatible `QueueEvents` facade. Console does not currently subscribe
 * to a separate events stream, but `bullmq` exports this class and downstream
 * code may construct it; the facade keeps the surface available as an
 * EventEmitter so source stays compatible. The active driver may emit events
 * onto instances it knows about; absent that, listeners simply never fire.
 */
import { EventEmitter } from "events";
import type { ConnectionOptions, QueueEventName } from "./types";

export interface QueueEventsOptions {
  connection?: ConnectionOptions;
  prefix?: string;
  autorun?: boolean;
}

export class QueueEvents extends EventEmitter {
  public readonly name: string;
  public readonly opts: QueueEventsOptions;

  constructor(name: string, opts: QueueEventsOptions = {}) {
    super();
    this.name = name;
    this.opts = opts;
  }

  override on(event: QueueEventName, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  async waitUntilReady(): Promise<this> {
    return this;
  }

  async close(): Promise<void> {
    this.removeAllListeners();
  }
}
