import { AgentsProvider } from "@/src/features/agents/AgentsProvider";
import { EnhancedDashboardPage } from "@/src/features/agents/pages/EnhancedDashboardPage";

export default function AgentMetricsRoute() {
  return (
    <AgentsProvider>
      <div className="min-h-full p-4 md:p-6 lg:p-8">
        <EnhancedDashboardPage />
      </div>
    </AgentsProvider>
  );
}
