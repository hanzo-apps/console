import { useRouter } from "next/router";
import ContainerPage from "@/src/components/layouts/container-page";
import { CollectionsTable } from "@/src/features/vector/components/CollectionsTable";
import {
  getVectorTabs,
  VECTOR_TABS,
} from "@/src/features/navigation/utils/vector-tabs";

export default function VectorCollectionsPage() {
  const router = useRouter();
  const projectId = router.query.projectId as string;

  if (!projectId) return null;

  return (
    <ContainerPage
      headerProps={{
        title: "Vector",
        tabsProps: {
          tabs: getVectorTabs(projectId),
          activeTab: VECTOR_TABS.COLLECTIONS,
        },
      }}
    >
      <CollectionsTable projectId={projectId} />
    </ContainerPage>
  );
}
