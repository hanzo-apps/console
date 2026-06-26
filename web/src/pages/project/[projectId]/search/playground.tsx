import { useRouter } from "next/router";
import ContainerPage from "@/src/components/layouts/container-page";
import { SearchPlayground } from "@/src/features/search/components/SearchPlayground";
import {
  getSearchTabs,
  SEARCH_TABS,
} from "@/src/features/navigation/utils/search-tabs";

export default function SearchPlaygroundPage() {
  const router = useRouter();
  const projectId = router.query.projectId as string;

  if (!projectId) return null;

  return (
    <ContainerPage
      headerProps={{
        title: "Search",
        tabsProps: {
          tabs: getSearchTabs(projectId),
          activeTab: SEARCH_TABS.PLAYGROUND,
        },
      }}
    >
      <SearchPlayground projectId={projectId} />
    </ContainerPage>
  );
}
