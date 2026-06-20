import type { TracingSearchType } from "@hanzo/console";

export const LEGACY_IO_SEARCH_TYPES = new Set<TracingSearchType>([
  "content",
  "input",
  "output",
]);

export const hasLegacyTracingIoSearch = (
  searchType?: TracingSearchType[] | null,
) => Boolean(searchType?.some((type) => LEGACY_IO_SEARCH_TYPES.has(type)));
