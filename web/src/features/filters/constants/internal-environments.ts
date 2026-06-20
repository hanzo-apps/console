import { ConsoleInternalTraceEnvironment } from "@hanzo/console/src/server/llm/types";

export const DEFAULT_SIDEBAR_HIDDEN_ENVIRONMENTS = [
  ConsoleInternalTraceEnvironment.PromptExperiments,
  ConsoleInternalTraceEnvironment.LLMJudge,
  ConsoleInternalTraceEnvironment.CodeEval,
  ConsoleInternalTraceEnvironment.NaturalLanguageFilter,
  "langfuse-evaluation",
  "sdk-experiment",
] as const;

export const DEFAULT_SIDEBAR_IMPLICIT_ENVIRONMENT_CONFIG = {
  hiddenEnvironments: DEFAULT_SIDEBAR_HIDDEN_ENVIRONMENTS,
} as const;
