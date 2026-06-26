import { jsonSchemaNullable, type TriggerEventAction } from "@hanzo/console";
import {
  logger,
  type PromptResult,
  EntityChangeQueue,
  QueueJobs,
  QueueName,
} from "@hanzo/console/src/server";
import { v4 } from "uuid";

/**
 * Queue prompt change events for async processing using the generic EntityChangeQueue
 */
export const promptChangeEventSourcing = async (
  promptData: PromptResult | null,
  action: TriggerEventAction,
  user?: { id: string; name: string | null; email: string | null },
) => {
  if (!promptData) {
    return;
  }

  const event = {
    timestamp: new Date(),
    id: v4(),
    name: QueueJobs.EntityChangeJob as QueueJobs.EntityChangeJob,
    payload: {
      entityType: "prompt-version" as const,
      projectId: promptData.projectId,
      promptId: promptData.id,
      action: action,
      prompt: {
        ...promptData,
        prompt: jsonSchemaNullable.parse(promptData.prompt),
        config: jsonSchemaNullable.parse(promptData.config),
      },
      ...(user ? { user } : {}),
    },
  };
  try {
    // Queue the entity change event for async processing
    await EntityChangeQueue.getInstance()?.add(
      QueueName.EntityChangeQueue,
      event,
    );

    logger.info(
      `Queued entity change event for prompt ${promptData.id} in project ${promptData.projectId} with action ${action}`,
    );
  } catch (error) {
    // Event sourcing is a best-effort side-channel: the prompt has already been
    // persisted by the caller. If the queue backend is unavailable (e.g. the
    // in-process MemoryDriver is swapped for Temporal and it's unreachable) we
    // log and move on — a downstream eventing hiccup must never fail the user's
    // create/update. Fire-and-forget, not re-throw.
    logger.error(
      `Failed to queue entity change event for prompt ${promptData.id} for project ${promptData.projectId}: ${error}`,
    );
  }
};
