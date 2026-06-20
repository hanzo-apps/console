import { queryDatastore, type DatastoreQueryOpts } from "../../../server/repositories/datastore";
import { measureAndReturn } from "../../../server/datastore/measureAndReturn";
import { type PreferredDatastoreService } from "../../../server/datastore/client";
import { QueryBuilder } from "./queryBuilder";
import { type QueryType, type ViewVersion } from "../types";
import { env } from "../../../env";

export type PreparedQuery = {
  compiledQuery: string;
  parameters: Record<string, unknown>;
  preferredDatastoreService: PreferredDatastoreService | undefined;
  tags: Record<string, string>;
  datastoreSettings: Record<string, string>;
  usesTraceTable: boolean;
  fromTimestamp: string;
};

export async function prepareExecuteQuery(opts: {
  projectId: string;
  query: QueryType;
  version?: ViewVersion;
  enableSingleLevelOptimization?: boolean;
}): Promise<PreparedQuery> {
  const { projectId, query, version = "v1", enableSingleLevelOptimization = false } = opts;

  const chartConfig = (query as unknown as { config?: QueryType["chartConfig"] }).config ?? query.chartConfig;
  const queryBuilder = new QueryBuilder(chartConfig, version);

  const { query: compiledQuery, parameters } = await queryBuilder.build(
    query,
    projectId,
    enableSingleLevelOptimization || env.HANZO_ENABLE_SINGLE_LEVEL_QUERY_OPTIMIZATION === "true",
  );

  // v2 score views are score-based, but can add events_core joins for
  // trace/observation dimensions. Route based on the compiled query so only
  // generated queries that actually touch events use the events readonly pool.
  const usesEventsTable = compiledQuery.includes("events_core") || compiledQuery.includes("events_full");
  const preferredDatastoreService = usesEventsTable ? ("EventsReadOnly" as const) : undefined;

  const tags = {
    feature: "custom-queries",
    type: query.view,
    kind: "analytic",
    projectId,
  };

  const datastoreSettings: Record<string, string> = {
    date_time_output_format: "iso",
    ...(env.DATASTORE_USE_QUERY_CONDITION_CACHE === "true" ? { use_query_condition_cache: "true" } : {}),
    max_bytes_before_external_group_by: String(env.DATASTORE_MAX_BYTES_BEFORE_EXTERNAL_GROUP_BY),
  };

  return {
    compiledQuery,
    parameters,
    preferredDatastoreService,
    tags,
    datastoreSettings,
    usesTraceTable: compiledQuery.includes("traces"),
    fromTimestamp: query.fromTimestamp,
  };
}

export function toDatastoreQueryOpts(prepared: PreparedQuery): Omit<DatastoreQueryOpts, "allowLegacyEventsRead"> {
  return {
    query: prepared.compiledQuery,
    params: prepared.parameters,
    datastoreSettings: prepared.datastoreSettings,
    tags: prepared.tags,
    preferredService: prepared.preferredDatastoreService,
  };
}

export async function executeQuery(
  projectId: string,
  query: QueryType,
  version: ViewVersion = "v1",
  enableSingleLevelOptimization: boolean = false,
): Promise<Array<Record<string, unknown>>> {
  const prepared = await prepareExecuteQuery({
    projectId,
    query,
    version,
    enableSingleLevelOptimization,
  });

  const chOpts = toDatastoreQueryOpts(prepared);

  if (!prepared.usesTraceTable) {
    return queryDatastore<Record<string, unknown>>(chOpts);
  }

  return measureAndReturn({
    operationName: "executeQuery",
    projectId,
    input: {
      query: prepared.compiledQuery,
      params: prepared.parameters,
      fromTimestamp: prepared.fromTimestamp,
      tags: {
        ...prepared.tags,
        operation_name: "executeQuery",
      },
    },
    fn: async (input) => {
      return queryDatastore<Record<string, unknown>>({
        ...chOpts,
        query: input.query,
        params: input.params,
        tags: input.tags,
      });
    },
  });
}
