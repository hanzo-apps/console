export const SEARCH_TABS = {
  OVERVIEW: "overview",
  INDEXES: "indexes",
  KEYS: "keys",
  PLAYGROUND: "playground",
} as const;

export type SearchTab = (typeof SEARCH_TABS)[keyof typeof SEARCH_TABS];

export const getSearchTabs = (projectId: string) => [
  {
    value: SEARCH_TABS.OVERVIEW,
    label: "Overview",
    href: `/project/${projectId}/search`,
  },
  {
    value: SEARCH_TABS.INDEXES,
    label: "Indexes",
    href: `/project/${projectId}/search/indexes`,
  },
  {
    value: SEARCH_TABS.KEYS,
    label: "Keys",
    href: `/project/${projectId}/search/keys`,
  },
  {
    value: SEARCH_TABS.PLAYGROUND,
    label: "Playground",
    href: `/project/${projectId}/search/playground`,
  },
];
