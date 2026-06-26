import { useState, useMemo, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/src/features/agents/components/ui/card";
import { Button } from "@/src/features/agents/components/ui/button";
import { cn } from "@/src/features/agents/lib/utils";
import { BarChart3 } from "@/src/features/agents/components/ui/icon-bridge";
import type { HeatmapCell } from "@/src/features/agents/types/dashboard";

type HeatmapView = "failures" | "usage";

interface ActivityHeatmapProps {
  /** 7x24 matrix of heatmap cells [dayOfWeek][hourOfDay] */
  heatmapData: HeatmapCell[][];
  /** Additional class name */
  className?: string;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_LABELS = ["00", "03", "06", "09", "12", "15", "18", "21"];

/**
 * Activity heatmap showing execution patterns by day of week and hour.
 * Toggle between failure rate and usage views.
 */
export function ActivityHeatmap({
  heatmapData,
  className,
}: ActivityHeatmapProps) {
  const [view, setView] = useState<HeatmapView>("failures");

  // Debug logging for development
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      if (!heatmapData || heatmapData.length !== 7) {
        console.warn("[ActivityHeatmap] Unexpected heatmap data structure:", {
          exists: !!heatmapData,
          length: heatmapData?.length,
          sample: heatmapData?.[0]?.slice(0, 3),
        });
      } else {
        const totalActivity = heatmapData.reduce(
          (sum, day) =>
            sum + day.reduce((daySum, cell) => daySum + cell.total, 0),
          0,
        );
        if (totalActivity > 0) {
          console.log("[ActivityHeatmap] Heatmap data loaded:", {
            totalActivity,
          });
        }
      }
    }
  }, [heatmapData]);

  // Calculate max values for color scaling
  const { maxErrorRate, maxTotal } = useMemo(() => {
    let maxErrorRate = 0;
    let maxTotal = 0;

    if (heatmapData && heatmapData.length === 7) {
      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const cell = heatmapData[day]?.[hour];
          if (cell) {
            maxErrorRate = Math.max(maxErrorRate, cell.error_rate);
            maxTotal = Math.max(maxTotal, cell.total);
          }
        }
      }
    }

    return { maxErrorRate, maxTotal };
  }, [heatmapData]);

  // Get cell color based on view mode
  // Using solid colors for better visibility in dark mode
  const getCellColor = (cell: HeatmapCell | undefined): string => {
    // Base/empty state - visible but subtle
    const emptyColor = "bg-muted-foreground/10";

    if (!cell) return emptyColor;

    if (view === "failures") {
      if (cell.error_rate === 0) return emptyColor;
      const intensity = maxErrorRate > 0 ? cell.error_rate / maxErrorRate : 0;
      // Use red shades for failures - more visible
      if (intensity < 0.33) return "bg-red-500/30";
      if (intensity < 0.66) return "bg-red-500/60";
      return "bg-red-500/90";
    } else {
      if (cell.total === 0) return emptyColor;
      const intensity = maxTotal > 0 ? cell.total / maxTotal : 0;
      // Use neutral foreground shades for usage - more visible
      if (intensity < 0.33) return "bg-foreground/30";
      if (intensity < 0.66) return "bg-foreground/60";
      return "bg-foreground/90";
    }
  };

  // Get tooltip text for a cell
  const getCellTooltip = (cell: HeatmapCell | undefined): string => {
    if (!cell) return "No data";
    if (view === "failures") {
      return `${cell.failed} failed / ${cell.total} total (${cell.error_rate.toFixed(1)}%)`;
    }
    return `${cell.total} executions`;
  };

  // Check if we have any data
  const hasData = useMemo(() => {
    return (
      heatmapData &&
      heatmapData.length === 7 &&
      heatmapData.some((day) => day.some((cell) => cell.total > 0))
    );
  }, [heatmapData]);

  return (
    <Card
      variant="surface"
      interactive={false}
      className={cn("flex h-full flex-col", className)}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-5 pb-2">
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Activity Patterns
        </CardTitle>
        <div className="border-border/60 bg-muted/30 flex items-center gap-1 rounded-lg border p-0.5">
          <Button
            variant={view === "failures" ? "default" : "ghost"}
            size="sm"
            onClick={() => setView("failures")}
            className="h-6 px-2 text-[10px]"
          >
            Failures
          </Button>
          <Button
            variant={view === "usage" ? "default" : "ghost"}
            size="sm"
            onClick={() => setView("usage")}
            className="h-6 px-2 text-[10px]"
          >
            Usage
          </Button>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 p-5 pt-2">
        {!hasData ? (
          <div className="border-border/40 bg-muted/10 flex h-full items-center justify-center rounded-lg border border-dashed">
            <p className="text-muted-foreground text-sm">
              No activity data available
            </p>
          </div>
        ) : (
          <div className="flex h-full flex-col">
            {/* Hour labels */}
            <div className="mb-1 flex gap-0.5 pl-9">
              {HOUR_LABELS.map((hour) => (
                <div
                  key={hour}
                  className="text-muted-foreground flex-1 text-center text-[9px]"
                  style={{ minWidth: 0 }}
                >
                  {hour}
                </div>
              ))}
            </div>

            {/* Grid */}
            <div className="flex flex-1 flex-col gap-0.5">
              {DAY_LABELS.map((day, dayIndex) => (
                <div key={day} className="flex flex-1 items-center gap-1">
                  {/* Day label */}
                  <div className="text-muted-foreground w-8 pr-1 text-right text-[10px]">
                    {day}
                  </div>
                  {/* Cells for each hour */}
                  <div className="flex flex-1 gap-0.5">
                    {Array.from({ length: 24 }).map((_, hourIndex) => {
                      const cell = heatmapData[dayIndex]?.[hourIndex];
                      return (
                        <div
                          key={hourIndex}
                          className={cn(
                            "border-border/20 flex-1 cursor-default rounded-sm border transition-colors",
                            getCellColor(cell),
                            "hover:ring-foreground/30 hover:border-border/50 hover:ring-1",
                          )}
                          style={{ minWidth: "4px", minHeight: "14px" }}
                          title={getCellTooltip(cell)}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="text-muted-foreground mt-3 flex items-center justify-center gap-4 text-[10px]">
              <div className="flex items-center gap-1">
                <div className="bg-muted-foreground/10 border-border/30 h-3 w-3 rounded-sm border" />
                <span>None</span>
              </div>
              <div className="flex items-center gap-1">
                <div
                  className={cn(
                    "h-3 w-3 rounded-sm",
                    view === "failures" ? "bg-red-500/30" : "bg-foreground/30",
                  )}
                />
                <span>Low</span>
              </div>
              <div className="flex items-center gap-1">
                <div
                  className={cn(
                    "h-3 w-3 rounded-sm",
                    view === "failures" ? "bg-red-500/60" : "bg-foreground/60",
                  )}
                />
                <span>Med</span>
              </div>
              <div className="flex items-center gap-1">
                <div
                  className={cn(
                    "h-3 w-3 rounded-sm",
                    view === "failures" ? "bg-red-500/90" : "bg-foreground/90",
                  )}
                />
                <span>High</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
