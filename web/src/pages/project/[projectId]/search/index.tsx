import { useRouter } from "next/router";
import Link from "next/link";
import Page from "@/src/components/layouts/page";
import { Button } from "@/src/components/ui/button";
import { SearchStatsCards } from "@/src/features/search/components/SearchStatsCards";
import { SearchUsageChart } from "@/src/features/search/components/SearchUsageChart";
import { FileText, Search, Key } from "lucide-react";
import {
  getSearchTabs,
  SEARCH_TABS,
} from "@/src/features/navigation/utils/search-tabs";

export default function SearchOverviewPage() {
  const router = useRouter();
  const projectId = router.query.projectId as string;

  if (!projectId) return null;

  return (
    <Page
      withPadding
      scrollable
      headerProps={{
        title: "Search",
        help: {
          description:
            "Manage search indexes, test queries, and view API keys for Hanzo Search.",
          href: "https://hanzo.ai/docs/search",
        },
        tabsProps: {
          tabs: getSearchTabs(projectId),
          activeTab: SEARCH_TABS.OVERVIEW,
        },
      }}
    >
      <div className="flex flex-col gap-6">
        <SearchStatsCards projectId={projectId} />
        <SearchUsageChart projectId={projectId} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Link href={`/project/${projectId}/search/indexes`} className="group">
            <div className="hover:bg-muted/50 flex items-center gap-3 rounded-lg border p-4 transition-colors">
              <FileText className="text-muted-foreground group-hover:text-primary h-8 w-8" />
              <div>
                <p className="font-medium">Index New Site</p>
                <p className="text-muted-foreground text-sm">
                  Scrape and index web pages for search
                </p>
              </div>
            </div>
          </Link>
          <Link
            href={`/project/${projectId}/search/playground`}
            className="group"
          >
            <div className="hover:bg-muted/50 flex items-center gap-3 rounded-lg border p-4 transition-colors">
              <Search className="text-muted-foreground group-hover:text-primary h-8 w-8" />
              <div>
                <p className="font-medium">Test Search</p>
                <p className="text-muted-foreground text-sm">
                  Try search queries in the playground
                </p>
              </div>
            </div>
          </Link>
          <Link href={`/project/${projectId}/search/keys`} className="group">
            <div className="hover:bg-muted/50 flex items-center gap-3 rounded-lg border p-4 transition-colors">
              <Key className="text-muted-foreground group-hover:text-primary h-8 w-8" />
              <div>
                <p className="font-medium">View API Keys</p>
                <p className="text-muted-foreground text-sm">
                  Get keys and code snippets
                </p>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </Page>
  );
}
