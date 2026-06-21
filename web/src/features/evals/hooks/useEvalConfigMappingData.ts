import { type EvalFormType } from "@/src/features/evals/utils/evaluator-form-utils";
import { api } from "@/src/utils/api";
import { type ObservationType } from "@hanzo/console";
import { type UseFormReturn } from "react-hook-form";
import { usePreviewData } from "@/src/features/evals/hooks/usePreviewData";

export function useEvalConfigMappingData(
  projectId: string,
  form: UseFormReturn<EvalFormType>,
  traceId?: string,
  shouldFetch = true,
) {
  const latestTrace = api.traces.all.useQuery(
    {
      projectId,
      filter: form.watch("filter"),
      searchQuery: "",
      searchType: [],
      limit: 1,
      page: 0,
      orderBy: { column: "timestamp", order: "DESC" },
    },
    {
      enabled: !traceId && shouldFetch,
    },
  );
  // Peek navigation wins over URL state; URL state wins over the table's first row.
  const previewPointer =
    selectedPreviewPointer ?? urlPreviewPointer ?? firstPreviewPointer;

  const { previewData, isLoading } = usePreviewData({
    projectId,
    enabled: !disabled && Boolean(previewPointer),
    target: targetValue,
    traceId: previewPointer?.traceId,
    observationId: previewPointer?.observationId,
    timestamp: previewPointer?.timestamp,
  });

  const relevantTraceId = traceId ?? latestTrace.data?.traces[0]?.id;

  // TODO: figure out timestamp logic here
  const traceWithObservations =
    api.traces.byIdWithObservationsAndScores.useQuery(
      {
        projectId,
        traceId: relevantTraceId as string,
      },
      {
        enabled: !!relevantTraceId && shouldFetch,
      },
    );

  const observationTypeToNames = new Map<ObservationType, Set<string>>([
    ["SPAN", new Set()],
    ["EVENT", new Set()],
    ["GENERATION", new Set()],
  ]);
  traceWithObservations.data?.observations.forEach((observation) => {
    if (observation.type && observation.name) {
      observationTypeToNames.get(observation.type)?.add(observation.name);
    }
  });

  return {
    observationTypeToNames,
    traceWithObservations: traceWithObservations.data,
    isLoading: traceWithObservations.isLoading,
  };
}
