/**
 * Temporal workflow definitions for the `@hanzo/mq` Temporal driver.
 *
 * Loaded by Temporal's workflow sandbox (deterministic). Defines a single
 * generic workflow, `runJob`, that proxies a BullMQ-shaped job to the `process`
 * activity. The activity (in `temporal-activities.ts`) calls the real console
 * processor. BullMQ `attempts`/`backoff` are carried in the envelope and mapped
 * onto the activity RetryPolicy, so one workflow definition serves every queue.
 */
import { proxyActivities } from "@temporalio/workflow";

export interface RetrySpec {
  maximumAttempts: number;
  initialIntervalMs: number;
  backoffCoefficient: number;
}

export interface JobEnvelope {
  queueName: string;
  jobId: string;
  name: string;
  data: unknown;
  timestamp: number;
  retry: RetrySpec;
  startToCloseTimeoutMs: number;
}

export interface ProcessActivities {
  process(envelope: JobEnvelope): Promise<unknown>;
}

export async function runJob(envelope: JobEnvelope): Promise<unknown> {
  const { process } = proxyActivities<ProcessActivities>({
    startToCloseTimeout: envelope.startToCloseTimeoutMs,
    retry: {
      maximumAttempts: envelope.retry.maximumAttempts,
      initialInterval: envelope.retry.initialIntervalMs,
      backoffCoefficient: envelope.retry.backoffCoefficient,
    },
  });
  return process(envelope);
}
