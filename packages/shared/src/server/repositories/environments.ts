import { AGGREGATABLE_SCORE_TYPES } from "../../domain/scores";
import { convertDateToDatastoreDateTime } from "../datastore/client";
import { logger } from "../logger";
import { queryDatastore } from "./datastore";

export type EnvironmentFilterProps = {
  projectId: string;
  fromTimestamp?: Date;
};

export const getEnvironmentsForProject = async (props: EnvironmentFilterProps): Promise<{ environment: string }[]> => {
  const { projectId, fromTimestamp } = props;

  const query = `
    (
      SELECT distinct environment
      FROM traces
      WHERE project_id = {projectId: String}
      ${fromTimestamp ? "AND timestamp >= {fromTimestamp: DateTime64(3)}" : ""}
    ) UNION ALL (
      SELECT distinct environment
      FROM observations
      WHERE project_id = {projectId: String}
      ${fromTimestamp ? "AND start_time >= {fromTimestamp: DateTime64(3)}" : ""}
    ) UNION ALL (
      SELECT distinct environment
      FROM scores
      WHERE project_id = {projectId: String}
      AND data_type IN ({dataTypes: Array(String)})
      ${fromTimestamp ? "AND timestamp >= {fromTimestamp: DateTime64(3)}" : ""}
    )
  `;

  // The environment filter is a non-critical, read-only enrichment that powers
  // dashboard/filter dropdowns. A datastore outage, missing tables, or an empty
  // self-hosted deployment must not surface as a 500 that zeroes out the page.
  // Degrade gracefully to the always-present "default" environment instead.
  let results: { environment: string }[];
  try {
    results = await queryDatastore<{
      environment: string;
    }>({
      query,
      params: {
        projectId,
        fromTimestamp: fromTimestamp ? convertDateToDatastoreDateTime(fromTimestamp) : undefined,
        dataTypes: AGGREGATABLE_SCORE_TYPES,
      },
      tags: {
        feature: "tracing",
        type: "environment",
        kind: "byId",
        projectId,
      },
      preferredService: "ReadOnly",
    });
  } catch (error) {
    logger.error(
      `getEnvironmentsForProject: failed to query environments for project ${projectId}; falling back to default environment`,
      error,
    );
    results = [];
  }

  // Always add default environment to list
  results.push({ environment: "default" });

  return Array.from(new Set(results.map((e) => e.environment))).map((environment) => ({
    environment,
  }));
};
