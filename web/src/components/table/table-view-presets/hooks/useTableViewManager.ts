import { api } from "@/src/utils/api";
import {
  TableViewPresetTableName,
  type FilterState,
  type OrderByState,
  type TableViewPresetState,
  type ColumnDefinition,
} from "@hanzo/console";
import { useRouter } from "next/router";
import { useEffect, useCallback, useState, useRef } from "react";
import { type VisibilityState } from "@tanstack/react-table";
import { StringParam } from "use-query-params";
import useSessionStorage from "@/src/components/useSessionStorage";
import { useQueryParam } from "use-query-params";
import { type HanzoColumnDef } from "@/src/components/table/types";
import { showErrorToast } from "@/src/features/notifications/showErrorToast";
import isEqual from "lodash/isEqual";
import { usePostHogClientCapture } from "@/src/features/posthog-analytics/usePostHogClientCapture";
import { validateOrderBy, validateFilters } from "../validation";

interface TableStateUpdaters {
  setColumnOrder: (columnOrder: string[]) => void;
  setColumnVisibility: (columnVisibility: VisibilityState) => void;
  setOrderBy?: (orderBy: OrderByState) => void;
  setFilters?: (filters: FilterState) => void;
  setSearchQuery?: (searchQuery: string) => void;
  setExpandedFilters?: (expandedFilters: string[]) => void;
}

interface UseTableStateProps {
  tableName: TableViewPresetTableName;
  projectId: string;
  stateUpdaters: TableStateUpdaters;
  validationContext?: {
    columns?: HanzoColumnDef<any, any>[];
    filterColumnDefinition?: ColumnDefinition[];
    expandableFilterColumns?: string[];
    migrateFilterState?: FilterStateMigration;
  };
  currentFilterState?: FilterState;
  currentExpandedFilters?: string[];
  disabled?: boolean;
  allowBackendSystemPresets?: boolean;
}

const isViewApplicableToTable = (
  currentTableName: TableViewPresetTableName,
  viewTableName: TableViewPresetTableName,
) =>
  currentTableName === viewTableName ||
  (currentTableName === TableViewPresetTableName.ObservationsEvents &&
    viewTableName === TableViewPresetTableName.Observations);

const IMPLICIT_VIEW_BLOCKING_QUERY_PARAMS = [
  "filter",
  "search",
  "searchType",
  "orderBy",
] as const;

const hasQueryParam = (
  query: NextRouter["query"],
  key: (typeof IMPLICIT_VIEW_BLOCKING_QUERY_PARAMS)[number],
) => {
  const value = query[key];
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== "";
};

const hasExplicitTableStateInUrl = (query: NextRouter["query"]) =>
  IMPLICIT_VIEW_BLOCKING_QUERY_PARAMS.some((key) => hasQueryParam(query, key));

/**
 * Hook to manage table view state with permalink support
 */
export function useTableViewManager({
  projectId,
  tableName,
  stateUpdaters,
  validationContext = {},
  currentFilterState,
  currentExpandedFilters,
  disabled = false,
  allowBackendSystemPresets = false,
}: UseTableStateProps) {
  const router = useRouter();
  const isRouterReady = router.isReady;
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const capture = usePostHogClientCapture();
  const pendingFiltersRef = useRef<FilterState | null>(null);
  const pendingFiltersPreviousStateRef = useRef<FilterState | null>(null);

  const [storedViewId, setStoredViewId] = useSessionStorage<string | null>(
    `${tableName}-${projectId}-viewId`,
    null,
  );
  const [selectedViewId, setSelectedViewId] = useQueryParam(
    "viewId",
    withDefault(StringParam, storedViewId),
  );

  // Keep track of the viewId in session storage and in the query params
  const handleSetViewId = useCallback(
    (viewId: string | null) => {
      if (viewId === null) {
        // When clearing, remove from URL first to prevent sync loop
        const url = new URL(window.location.href);
        url.searchParams.delete("viewId");
        window.history.replaceState({}, "", url.toString());
      }
      setStoredViewId(viewId);
      setSelectedViewId(viewId);

      // Explicitly selecting "My view (default)" should stop bootstrap restore.
      // Otherwise an in-flight bootstrap can restore a previously selected view.
      if (viewId === null && !isInitializedRef.current) {
        isInitializedRef.current = true;
        setIsInitialized(true);
        setIsLoading(false);
      }
    },
    [setStoredViewId, setSelectedViewId],
  );

  // Extract updater functions and store in refs to avoid stale closures
  const {
    setOrderBy,
    setFilters,
    setColumnOrder,
    setColumnVisibility,
    setSearchQuery,
  } = stateUpdaters;

  // Use refs to always get latest function references to avoid stale closures in applyViewState
  // for restoring view state from the saved views
  const setFiltersRef = useRef(setFilters);
  const setOrderByRef = useRef(setOrderBy);
  const setSearchQueryRef = useRef(setSearchQuery);
  const setExpandedFiltersRef = useRef(setExpandedFilters);

  // Update refs immediately on every render
  setFiltersRef.current = setFilters;
  setOrderByRef.current = setOrderBy;
  setSearchQueryRef.current = setSearchQuery;
  setExpandedFiltersRef.current = setExpandedFilters;

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const viewIdInUrl = urlParams.get("viewId");

    // If no viewId in URL but we have one in storage, use that
    if (!viewIdInUrl && storedViewId) {
      setSelectedViewId(storedViewId);
    }
    // If there's a viewId in the URL, update our storage
    else if (viewIdInUrl) {
      setStoredViewId(viewIdInUrl);
    } else {
      setIsLoading(false);
      setIsInitialized(true);
    }
  }, [storedViewId, setStoredViewId, setSelectedViewId]);

  // Fetch view data if viewId is provided
  const {
    data: viewData,
    isLoading: isViewLoading,
    error: viewError,
  } = api.TableViewPresets.getById.useQuery(
    { viewId: viewId as string, projectId },
    {
      enabled: !!viewId && !isInitialized,
    },
  );

  // Method to apply state from a view
  const applyViewState = useCallback(
    (viewData: TableViewPresetState) => {
      // lock table
      setIsLoading(true);

      /**
       * Validate orderBy and filters
       */
      let validOrderBy: OrderByState | null = null;
      let validFilters: FilterState = [];
      if (viewData.orderBy) {
        validOrderBy = validateOrderBy(
          viewData.orderBy,
          validationContext.columns,
        );
      }

      // Validate and apply filters
      if (viewData.filters) {
        validFilters = validateFilters(
          viewData.filters,
          validationContext.filterColumnDefinition,
        );
      }

      if (
        !isEqual(validOrderBy, viewData.orderBy) ||
        validFilters.length !== viewData.filters.length
      ) {
        showErrorToast(
          "Outdated view",
          "This view is outdated. Some old filters or ordering may have been ignored. Please update your view.",
          "WARNING",
        );
      }

      if (setOrderByRef.current) setOrderByRef.current(validOrderBy);

      const filtersAlreadyApplied = isEqual(currentFilterState, validFilters);

      if (
        setExpandedFiltersRef.current &&
        validationContext.expandableFilterColumns?.length
      ) {
        const nextExpandedFilters = Array.from(
          new Set([
            ...(currentExpandedFilters ?? []),
            ...validFilters
              .map((filter) => filter.column)
              .filter((column) =>
                validationContext.expandableFilterColumns?.includes(column),
              ),
          ]),
        );

        setExpandedFiltersRef.current(nextExpandedFilters);
      }

      if (setFiltersRef.current) {
        setFiltersRef.current(validFilters);
        // Track expected filters to observe when state actually updates (for useEffect below)
        // If filters are already applied, don't set pending ref (will unlock immediately).
        // Also track pre-apply state so we can unlock when filters propagate but get
        // migrated into an equivalent shape by downstream hooks.
        if (!filtersAlreadyApplied) {
          pendingFiltersRef.current = validFilters;
          pendingFiltersPreviousStateRef.current = currentFilterState ?? [];
        }
      }

      // Handle search query (only set if non-empty to avoid use-query-params batching conflicts)
      if (viewData.searchQuery && setSearchQueryRef.current) {
        setSearchQueryRef.current(viewData.searchQuery);
      }

      // Apply column order and visibility without validation since UI will handle gracefully
      if (viewData.columnOrder) setColumnOrder(viewData.columnOrder);
      if (viewData.columnVisibility)
        setColumnVisibility(viewData.columnVisibility);

      // If filters were already applied, unlock table immediately
      if (filtersAlreadyApplied) {
        setIsLoading(false);
      }

      // NOTE: Table remains locked until useEffect observer detects filter state propagation
      // This is relevant for the saved views. Because the URL lazy updates and we don't want to wait
      // for a page reload
    },
    [
      setColumnOrder,
      setColumnVisibility,
      validationContext,
      currentFilterState,
    ],
  );

  // Fetch view data if a viewId is provided (skip for frontend-only system presets)
  const {
    data: selectedViewData,
    error: selectedViewError,
    isSuccess: isSelectedViewSuccess,
    isError: isSelectedViewError,
  } = api.TableViewPresets.getById.useQuery(
    { viewId: selectedViewId as string, projectId },
    {
      enabled:
        !disabled &&
        isRouterReady &&
        !!selectedViewId &&
        !isInitialized &&
        (!isSystemPresetId(selectedViewId) || allowBackendSystemPresets),
    },
  );

  useEffect(() => {
    if (disabled) return;
    if (!isSelectedViewSuccess || !selectedViewData) return;
    const requestedViewId = selectedViewId;
    if (!requestedViewId) return;
    if (isInitializedRef.current) return;
    if (selectedViewIdRef.current !== requestedViewId) return;
    if (selectedViewData.id !== requestedViewId) return;
    if (!isViewApplicableToTable(tableName, selectedViewData.tableName)) {
      handleSetViewId(null);
      return;
    }
  }, [
    viewData,
    isInitialized,
    capture,
    tableName,
    viewId,
    applyViewState,
    setIsLoading,
  ]);

  useEffect(() => {
    if (disabled) return;
    if (!isSelectedViewError || !selectedViewError) return;
    const requestedViewId = selectedViewId;
    if (!requestedViewId) return;
    if (isInitializedRef.current) return;
    if (selectedViewIdRef.current !== requestedViewId) return;

    isInitializedRef.current = true;
    setIsInitialized(true);
    setIsLoading(false);
    handleSetViewId(null);
    showErrorToast("Error applying view", selectedViewError.message, "WARNING");
  }, [
    disabled,
    isSelectedViewError,
    selectedViewError,
    selectedViewId,
    handleSetViewId,
  ]);

  // Initialize on mount if no viewId
  useEffect(() => {
    if (!isInitialized && !isViewLoading && !viewId) {
      // No view to load - just mark as initialized
      // The individual state hooks will have their own defaults
      setIsInitialized(true);
      setIsLoading(false);
    }
  }, [isInitialized, isViewLoading, viewId]);

  // Observe when filter state propagates from saved view
  // After calling setFilters, URL updates async → filterState recalculates → this effect detects completion
  useEffect(() => {
    const pendingFilters = pendingFiltersRef.current;
    if (!pendingFilters || currentFilterState === undefined) return;

    const preApplyFilters = pendingFiltersPreviousStateRef.current ?? [];
    const hasExpectedShape = isEqual(currentFilterState, pendingFilters);
    const hasPropagatedWithCanonicalization = !isEqual(
      currentFilterState,
      preApplyFilters,
    );

    if (hasExpectedShape || hasPropagatedWithCanonicalization) {
      // Filter state has synchronized - safe to unlock table.
      // `hasPropagatedWithCanonicalization` handles equivalent rewrites
      // (for example legacy env-delta -> canonical none-of shape).
      pendingFiltersRef.current = null;
      pendingFiltersPreviousStateRef.current = null;
      setIsLoading(false);
    }
  }, [currentFilterState]);

  if (disabled) {
    return {
      isLoading: false,
      applyViewState: () => {},
      handleSetViewId: () => {},
      selectedViewId: null,
      defaultViewScope: null,
    };
  }

  return {
    isLoading,
    applyViewState,
    handleSetViewId,
    selectedViewId,
  };
}
