import { Button } from "@/src/components/ui/button";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { useInsightsCapture } from "@/src/features/insights-analytics/useInsightsCapture";

interface TracePanelNavigationButtonProps {
  isPanelCollapsed: boolean;
  onTogglePanel: () => void;
  shouldPulseToggle?: boolean;
}

export function TracePanelNavigationButton({
  isPanelCollapsed,
  onTogglePanel,
  shouldPulseToggle = false,
}: TracePanelNavigationButtonProps) {
  const capture = useInsightsCapture();
  return (
    <div className="relative">
      <Button
        onClick={() => {
          onTogglePanel();
          capture("trace_detail:tree_panel_toggle", {
            collapsed: !isPanelCollapsed,
          });
        }}
        variant="ghost"
        size="icon"
        title={isPanelCollapsed ? "Expand panel" : "Collapse panel"}
        className="h-7 w-7 shrink-0"
      >
        {isPanelCollapsed ? (
          <PanelLeftOpen className="h-3.5 w-3.5" />
        ) : (
          <PanelLeftClose className="h-3.5 w-3.5" />
        )}
      </Button>

      {/* Pulsing status indicator */}
      {shouldPulseToggle && (
        <span className="pointer-events-none absolute top-0.5 right-0.5 flex h-2.5 w-2.5">
          <span className="bg-primary absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
          <span className="bg-primary relative inline-flex h-2.5 w-2.5 rounded-full" />
        </span>
      )}
    </div>
  );
}
