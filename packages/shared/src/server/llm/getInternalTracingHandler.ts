import CallbackHandler from "@hanzo/langchain";
import { GenerationDetails, TraceSinkParams } from "./types";
import { processEventBatch } from "../ingestion/processEventBatch";
import { logger } from "../logger";
import { traceException } from "../instrumentation";

/**
 * Extracts and merges generation details from a list of processed events.
 * Handles multiple generation-create and generation-update events with the same id.
 *
 * Events are merged following the "last non-null value wins" pattern:
 * - generation-create events contain: id, name, input, metadata
 * - generation-update events contain: output, usage, usageDetails
 *
 * @returns GenerationDetails or null if no generation events found
 */
export function extractGenerationDetails(
  processedEvents: Array<{ type: string; body: Record<string, unknown> }>,
): GenerationDetails | null {
  // 1. Filter to only generation events
  const generationEvents = processedEvents.filter(
    (event) => event.type === "generation-create" || event.type === "generation-update",
  );

  const blockedSpanIds = new Set();
  const blockedSpanNameSubstrings = ["RunnableLambda", "OutputParser"];

  for (const event of events) {
    const eventName = "name" in event.body ? event.body.name : "";

    if (typeof eventName !== "string" || eventName.length === 0) {
      continue;
    }

    if (
      blockedSpanNameSubstrings.some((blockedSubstring) =>
        eventName.includes(blockedSubstring),
      ) &&
      "id" in event.body &&
      event.type !== "trace-create"
    ) {
      blockedSpanIds.add(event.body.id);
    }
  }

  // 2. Get the generation id from first event
  const generationId = generationEvents[0].body.id as string;
  if (!generationId) {
    return null;
  }

  // 3. Filter to events for this generation id only
  const eventsForGeneration = generationEvents.filter((event) => event.body.id === generationId);

  // 4. Merge event bodies (last non-null/non-undefined value wins)
  // Similar to IngestionService pattern but simplified for our use case
  const mergedBody = eventsForGeneration.reduce(
    (acc: Record<string, unknown>, event) => {
      for (const [key, value] of Object.entries(event.body)) {
        if (value !== undefined && value !== null) {
          // Special handling for metadata: deep merge
          if (key === "metadata" && typeof value === "object" && !Array.isArray(value)) {
            acc[key] = {
              ...((acc[key] as Record<string, unknown>) || {}),
              ...(value as Record<string, unknown>),
            };
          } else {
            acc[key] = value;
          }
        }
      }

      return true;
    })
    .map((event) => {
      // Inject environment into all events
      return {
        ...event,
        body: {
          ...event.body,
          environment,
        },
      };
    })
    .map((event) => {
      if (event.type === "generation-create" && prompt) {
        return {
          ...event,
          body: {
            ...event.body,
            promptName: prompt.name,
            promptVersion: prompt.version,
          },
        };
      }

      return event;
    });
}

export function getInternalTracingHandler(traceSinkParams: TraceSinkParams): {
  handler: CallbackHandler;
  processTracedEvents: () => Promise<void>;
} {
  const { prompt, targetProjectId, environment, userId, eventsWriter } =
    traceSinkParams;
  const handler = new CallbackHandler({
    _projectId: targetProjectId,
    _isLocalEventExportEnabled: true,
    environment: environment,
    userId: userId,
  });

  const processTracedEvents = async () => {
    try {
      const events = await (handler as any).console._exportLocalEvents(traceSinkParams.targetProjectId);

      // Filter out unnecessary Langchain spans
      const blockedSpanIds = new Set();
      const blockedSpanNames = ["RunnableLambda", "StructuredOutputParser", "StrOutputParser", "JsonOutputParser"];

      for (const event of events) {
        const eventName = "name" in event.body ? event.body.name : "";

        if (!eventName) continue;

        if (blockedSpanNames.includes(eventName) && "id" in event.body) {
          blockedSpanIds.add(event.body.id);
        }
      }

      const processedEvents = events
        .filter((event: any) => {
          if ("id" in event.body) {
            return !blockedSpanIds.has(event.body.id);
          }

          return true;
        })
        .map((event: any) => {
          // to add the prompt name and version to only generation-type observations
          if (event.type === "generation-create" && prompt) {
            return {
              ...event,
              body: {
                ...event.body,
                ...{ promptName: prompt.name, promptVersion: prompt.version },
              },
            };
          }
          return event;
        });

      await processEventBatch(
        JSON.parse(JSON.stringify(processedEvents)), // stringify to emulate network event batch from network call
        {
          validKey: true as const,
          scope: {
            projectId: traceSinkParams.targetProjectId, // Important: this controls into what project traces are ingested.
            accessLevel: "project",
          } as any,
        },
        {
          isHanzoInternal: true,
        },
      );

      // Extract generation details and invoke callback (if provided)
      if (traceSinkParams.onGenerationComplete) {
        try {
          const { rootSpanId, eventInputs } = buildInternalTraceEventInputs({
            processedEvents,
            traceId: traceSinkParams.traceId,
            projectId: targetProjectId,
            experimentContext: eventsWriter.experimentContext,
          });

          if (eventInputs.length > 0) {
            await eventsWriter.write({ rootSpanId, eventInputs });
          }
        } catch (writeError) {
          traceException(writeError);
          logger.error("Failed to direct-write internal traced events", {
            error: writeError,
          });
        }
      }
    } catch (e) {
      logger.error("Failed to process traced events", { error: e });
    }
  };

  return { handler, processTracedEvents };
}
