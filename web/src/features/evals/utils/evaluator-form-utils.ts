import { z } from "zod/v4";
import {
  singleFilter,
  type consoleObjects,
  TimeScopeSchema,
  EvalTargetObjectSchema,
} from "@hanzo/console";
import { wipVariableMapping } from "@hanzo/console";

export const isTraceTarget = (target: string): boolean => target === "trace";
export const isTraceOrDatasetObject = (object: string): boolean =>
  object === "trace" || object === "dataset_item";

export const evalConfigFormSchema = z.object({
  scoreName: z.string(),
  target: EvalTargetObjectSchema,
  filter: z.array(singleFilter).nullable(), // reusing the filter type from the tables
  mapping: z.array(wipVariableMapping),
  sampling: z.coerce.number().gt(0).lte(1),
  delay: z.coerce.number().min(0).optional().default(10),
  timeScope: TimeScopeSchema,
});

export type EvalFormType = z.infer<typeof evalConfigFormSchema>;

export type ConsoleObject = (typeof consoleObjects)[number];

export type VariableMapping = z.infer<typeof wipVariableMapping>;

export const fieldHasJsonSelectorOption = (
  selectedColumnId: string | undefined | null,
): boolean =>
  selectedColumnId === "input" ||
  selectedColumnId === "output" ||
  selectedColumnId === "metadata" ||
  selectedColumnId === "expected_output" ||
  selectedColumnId === "experiment_item_expected_output" ||
  selectedColumnId === "experiment_item_metadata" ||
  selectedColumnId === "expectedOutput" ||
  selectedColumnId === "experimentItemExpectedOutput" ||
  selectedColumnId === "experimentItemMetadata";
