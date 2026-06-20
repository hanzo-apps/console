import { type FilterCondition, type FilterState } from "@hanzo/console";

export const EXPERIMENT_ROOT_OBSERVATION_FILTER = {
  type: "boolean",
  column: "isExperimentItemRootSpan",
  operator: "=",
  value: true,
} satisfies FilterCondition;

export function getExperimentEvalPreviewFilters(
  filter: FilterState | null | undefined,
): FilterState {
  return [...(filter ?? []), { ...EXPERIMENT_ROOT_OBSERVATION_FILTER }];
}
