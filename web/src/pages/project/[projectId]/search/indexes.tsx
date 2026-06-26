import { useRouter } from "next/router";
import ContainerPage from "@/src/components/layouts/container-page";
import { IndexesTable } from "@/src/features/search/components/IndexesTable";
import {
  getSearchTabs,
  SEARCH_TABS,
} from "@/src/features/navigation/utils/search-tabs";

export default function SearchIndexesPage() {
  const router = useRouter();
  const projectId = router.query.projectId as string;

  if (!projectId) return null;

  return (
    <ContainerPage
      headerProps={{
        title: "Search",
        tabsProps: {
          tabs: getSearchTabs(projectId),
          activeTab: SEARCH_TABS.INDEXES,
        },
      }}
    >
      <IndexesTable projectId={projectId} />
    </ContainerPage>
  );
}
