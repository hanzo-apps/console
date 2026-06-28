import { NextResponse, type NextRequest } from "next/server";

import { BaseError, ForbiddenError } from "@hanzo/console";

import { InsightsCallbackHandler } from "./analytics/insightsCallback";
import { authorizeRequestOrThrow } from "./authorizeRequest";
import { resolvePlaygroundLlmConnection } from "./meterConnection";
import { validateChatCompletionBody } from "./validateChatCompletionBody";

import { env } from "@/src/env.mjs";
import {
  logger,
  fetchLLMCompletion,
  contextWithHanzoProps,
} from "@hanzo/console/src/server";
import * as opentelemetry from "@opentelemetry/api";

export default async function chatCompletionHandler(req: NextRequest) {
  try {
    const body = validateChatCompletionBody(await req.json());
    const { userId, iamSub } = await authorizeRequestOrThrow(body.projectId);

    const blockedUsers = env.HANZO_BLOCKED_USERIDS_CHATCOMPLETION;
    if (blockedUsers.has(userId)) {
      const reason = blockedUsers.get(userId);
      logger.warn("Blocked chat completion access", { userId, reason });
      throw new ForbiddenError("Access denied");
    }

    const baggageCtx = contextWithHanzoProps({
      userId: userId,
      projectId: body.projectId,
    });

    return opentelemetry.context.with(baggageCtx, async () => {
      const {
        messages,
        modelParams,
        tools,
        structuredOutputSchema,
        streaming,
      } = body;

      // Resolve the connection: the project's BYO key when present (tenant's own
      // key / own cost, used unchanged), otherwise route through the Hanzo meter
      // on the signed-in user's per-user hk- key so usage meters + bills to their
      // org. Fail-closed: throws rather than routing unmetered if the user's key
      // can neither be resolved nor minted.
      const llmConnection = await resolvePlaygroundLlmConnection({
        projectId: body.projectId,
        provider: modelParams.provider,
        iamSub,
      });

      const fetchLLMCompletionParams = {
        llmConnection,
        messages,
        modelParams,
        structuredOutputSchema,
        callbacks: [new InsightsCallbackHandler("playground", body, userId)],
      };

      if (structuredOutputSchema) {
        const result = await fetchLLMCompletion({
          ...fetchLLMCompletionParams,
          streaming: false,
          structuredOutputSchema,
        });
        return NextResponse.json(result);
      }

      // If messages contain tool results, we include tools in the request
      const hasToolResults = messages.some((msg) => msg.type === "tool-result");

      if ((tools && tools.length > 0) || hasToolResults) {
        // Fix empty tool_call_id values by mapping to langgraph IDs
        const fixedMessages = messages.map((msg) => {
          if (
            msg.type === "tool-result" &&
            (!msg.toolCallId || msg.toolCallId === "")
          ) {
            const assistantMessages = messages
              .filter((m) => m.type === "assistant-tool-call" && m.toolCalls)
              .reverse();

            // Find the first matching tool call by name
            // Note: using 'as any' because we filtered for assistant-tool-call messages above
            for (const prevMsg of assistantMessages) {
              const matchingToolCall = (prevMsg as any).toolCalls.find(
                (tc: any) => tc.name === (msg as any)._originalRole,
              );
              if (matchingToolCall && matchingToolCall.id) {
                return {
                  ...msg,
                  toolCallId: matchingToolCall.id,
                };
              }
            }
          }

          return msg;
        });

        const result = await (fetchLLMCompletion as any)({
          ...fetchLLMCompletionParams,
          messages: fixedMessages,
          streaming: false,
          tools: tools ?? [],
        });
        return NextResponse.json(result);
      }

      if (streaming) {
        const completion = await fetchLLMCompletion({
          ...fetchLLMCompletionParams,
          streaming,
        });

        return new Response(completion, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        });
      } else {
        const completion = await fetchLLMCompletion({
          ...fetchLLMCompletionParams,
          streaming,
        });

        if (typeof completion === "string") {
          return NextResponse.json({ content: completion });
        } else {
          return NextResponse.json({
            content: completion.text,
            reasoning: completion.reasoning,
          });
        }
      }
    });
  } catch (err) {
    logger.error("Failed to handle chat completion", err);

    if (err instanceof BaseError) {
      return NextResponse.json(
        {
          error: err.name,
          message: err.message,
        },
        { status: err.httpCode },
      );
    }

    if (err instanceof Error) {
      return NextResponse.json(
        {
          message: err.message,
          error: err,
        },
        {
          status: (err as any)?.response?.status ?? (err as any)?.status ?? 500,
        },
      );
    }

    throw err;
  }
}
