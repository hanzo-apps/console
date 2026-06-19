import { UiColumnMappings } from "../../tableDefinitions";

export const experimentItemsTableNativeUiColumnDefinitions: UiColumnMappings = [
  {
    uiTableName: "Scores (numeric)",
    uiTableId: "obs_scores_avg",
    datastoreTableName: "scores",
    datastoreSelect: "s.scores_avg",
  },
  {
    uiTableName: "Scores (categorical)",
    uiTableId: "obs_score_categories",
    datastoreTableName: "scores",
    datastoreSelect: "s.score_categories",
  },
  {
    uiTableName: "Trace Scores (numeric)",
    uiTableId: "trace_scores_avg",
    datastoreTableName: "scores",
    datastoreSelect: "ts.scores_avg",
  },
  {
    uiTableName: "Trace Scores (categorical)",
    uiTableId: "trace_score_categories",
    datastoreTableName: "scores",
    datastoreSelect: "ts.score_categories",
  },
  {
    uiTableName: "Item Metadata",
    uiTableId: "itemMetadata",
    datastoreTableName: "events_proto",
    datastoreSelect: "experiment_item_metadata",
    queryPrefix: "e",
  },
  {
    uiTableName: "Metadata",
    uiTableId: "eventMetadata",
    datastoreTableName: "events_proto",
    datastoreSelect: "metadata",
    queryPrefix: "e",
  },
];
