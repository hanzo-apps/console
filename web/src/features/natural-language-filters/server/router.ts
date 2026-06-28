import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import { TRPCError } from "@trpc/server";
import {
  ChatMessageType,
  fetchLLMCompletion,
  logger,
  type TraceSinkParams,
} from "@hanzo/console/src/server";
import { env } from "@/src/env.mjs";
import { CreateNaturalLanguageFilterCompletion } from "./validation";
import {
  getDefaultModelParams,
  parseFiltersFromCompletion,
  getHanzoClient,
} from "./utils";
import { randomBytes } from "crypto";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import {
  resolveUserHkKey,
  buildMeterConnection,
} from "@/src/features/cloud-meter/server/meterConnection";

export const naturalLanguageFilterRouter = createTRPCRouter({
  createCompletion: protectedProjectProcedure
    .input(CreateNaturalLanguageFilterCompletion)
    .mutation(async ({ input, ctx }) => {
      try {
        throwIfNoProjectAccess({
          session: ctx.session,
          projectId: input.projectId,
          scope: "prompts:CUD",
        });

        if (!env.NEXT_PUBLIC_HANZO_CLOUD_REGION) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Natural language filtering is not available in self-hosted deployments.",
          });
        }

        if (!env.HANZO_NL_FILTER_MODEL && !env.HANZO_AWS_BEDROCK_MODEL) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Natural-language filter model not configured. Set HANZO_NL_FILTER_MODEL (a model served by the Hanzo meter).",
          });
        }

        if (
          !env.HANZO_AI_FEATURES_PUBLIC_KEY ||
          !env.HANZO_AI_FEATURES_SECRET_KEY
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Hanzo AI filters environment variables not configured. Please set HANZO_AI_FEATURES_PUBLIC_KEY and HANZO_AI_FEATURES_SECRET_KEY variables.",
          });
        }

        const getEnvironment = (): string => {
          switch (env.NEXT_PUBLIC_HANZO_CLOUD_REGION) {
            case "US":
            case "EU":
            case "HIPAA":
              return "prod";
            case "STAGING":
              return "staging";
            default:
              return "dev";
          }
        };

        const client = getHanzoClient(
          env.HANZO_AI_FEATURES_PUBLIC_KEY as string,
          env.HANZO_AI_FEATURES_SECRET_KEY as string,
          env.HANZO_AI_FEATURES_HOST,
        );

        const promptResponse = await client.getPrompt(
          "get-filter-conditions-from-query",
          undefined,
          { type: "chat" },
        );

        if (!env.HANZO_AI_FEATURES_PROJECT_ID) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Hanzo AI Features not configured.",
          });
        }

        const traceSinkParams: TraceSinkParams = {
          environment: getEnvironment(),
          traceName: "natural-language-filter",
          traceId: randomBytes(16).toString("hex"),
          targetProjectId: env.HANZO_AI_FEATURES_PROJECT_ID,
          userId: ctx.session.user.id,
          metadata: {
            hanzo_user_id: ctx.session.user.id,
            hanzo_project_id: ctx.session.projectId,
          },
          prompt: promptResponse,
        };

        // Get current datetime in ISO format with day of week for AI context
        const now = new Date();
        const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
        const currentDatetime = `${dayOfWeek}, ${now.toISOString()}`;

        const messages = promptResponse.compile({
          userPrompt: input.prompt,
          currentDatetime,
        });
        const modelParams = getDefaultModelParams();

        // Route the completion through the Hanzo meter on the SIGNED-IN USER's
        // per-user hk- key so it is metered + billed to THEIR org — never a
        // shared Bedrock key. FAIL-CLOSED: resolveUserHkKey throws if the user's
        // key can neither be resolved nor minted (no unmetered fallback).
        const hkKey = await resolveUserHkKey(ctx.session.user.iamSub);
        const llmConnection = buildMeterConnection({
          hkKey,
          provider: modelParams.provider,
          projectId: input.projectId,
        });

        const llmCompletion = await fetchLLMCompletion({
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            type: ChatMessageType.PublicAPICreated,
          })),
          modelParams,
          llmConnection,
          streaming: false,
          traceSinkParams,
        });

        logger.info(
          `LLM completion received: ${JSON.stringify(llmCompletion, null, 2)}`,
        );

        const parsedFilters = parseFiltersFromCompletion(
          llmCompletion as string,
        );

        return {
          filters: parsedFilters,
        };
      } catch (error) {
        logger.error(
          "Failed to create natural language filter completion: ",
          error,
        );

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "The AI backend currently appears to be unavailable. Please try again later.",
        });
      }
    }),
});
