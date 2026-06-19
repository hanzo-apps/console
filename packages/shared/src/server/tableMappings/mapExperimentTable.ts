import { UiColumnMappings } from "../../tableDefinitions";

/**
 * Pre-aggregation column mappings for experiments.
 *
 * These columns exist in the raw events table and can be filtered BEFORE
 * the experiment_data CTE aggregation for better query performance.
 *
 * Used for filtering raw events before GROUP BY.
 */
export const experimentPreAggCols: UiColumnMappings = [
  {
    uiTableName: "ID",
    uiTableId: "id",
    datastoreTableName: "events_proto",
    datastoreSelect: "e.experiment_id",
  },
  {
    uiTableName: "Name",
    uiTableId: "name",
    datastoreTableName: "events_proto",
    datastoreSelect: "e.experiment_name",
  },
  {
    uiTableName: "Description",
    uiTableId: "description",
    datastoreTableName: "events_proto",
    datastoreSelect: "e.experiment_description",
  },
  {
    uiTableName: "Dataset ID",
    uiTableId: "experimentDatasetId",
    datastoreTableName: "events_proto",
    datastoreSelect: "e.experiment_dataset_id",
  },
  {
    uiTableName: "Start Time",
    uiTableId: "startTime",
    datastoreTableName: "events_proto",
    datastoreSelect: "e.start_time",
  },
  {
    uiTableName: "Metadata",
    uiTableId: "metadata",
    datastoreTableName: "events_proto",
    datastoreSelect: "experiment_metadata",
    queryPrefix: "e", // StringObjectFilter uses {prefix}.{field}_names/{field}_values for array access
  },
];

/**
 * Score aggregation column mappings for experiments.
 */
export const experimentScoreAggCols: UiColumnMappings = [
  // Observation-level scores
  {
    uiTableName: "Scores (numeric)",
    uiTableId: "obs_scores_avg",
    datastoreTableName: "scores",
    datastoreSelect: "obs_scores_avg",
  },
  {
    uiTableName: "Scores (categorical)",
    uiTableId: "obs_score_categories",
    datastoreTableName: "scores",
    datastoreSelect: "obs_score_categories",
  },
  // Trace-level scores
  {
    uiTableName: "Trace Scores (numeric)",
    uiTableId: "trace_scores_avg",
    datastoreTableName: "scores",
    datastoreSelect: "trace_scores_avg",
  },
  {
    uiTableName: "Trace Scores (categorical)",
    uiTableId: "trace_score_categories",
    datastoreTableName: "scores",
    datastoreSelect: "trace_score_categories",
  },
];

export const experimentOrderByCols: UiColumnMappings = [
  {
    uiTableName: "Start Time",
    uiTableId: "startTime",
    datastoreTableName: "events_proto",
    datastoreSelect: "start_time",
  },
];

/**
 * Combined column mappings for experiments (all columns).
 * Used for general column lookups.
 */
export const experimentCols: UiColumnMappings = [...experimentPreAggCols, ...experimentScoreAggCols];
