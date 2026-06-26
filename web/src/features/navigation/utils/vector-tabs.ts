export const VECTOR_TABS = {
  OVERVIEW: "overview",
  COLLECTIONS: "collections",
} as const;

export type VectorTab = (typeof VECTOR_TABS)[keyof typeof VECTOR_TABS];

export const getVectorTabs = (projectId: string) => [
  {
    value: VECTOR_TABS.OVERVIEW,
    label: "Overview",
    href: `/project/${projectId}/vector`,
  },
  {
    value: VECTOR_TABS.COLLECTIONS,
    label: "Collections",
    href: `/project/${projectId}/vector/collections`,
  },
];
