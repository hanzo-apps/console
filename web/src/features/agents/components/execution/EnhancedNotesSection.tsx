import { useState, useMemo } from "react";
import {
  FileText,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Clock,
  Tag,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "@/src/features/agents/components/ui/icon-bridge";
import type { WorkflowExecution, ExecutionNote } from "../../types/executions";

import { Button } from "../ui/button";

interface EnhancedNotesSectionProps {
  execution: WorkflowExecution;
  onRefresh?: () => void;
}

type SortOrder = "newest" | "oldest" | "chronological";

interface ExpandableNoteProps {
  note: ExecutionNote;
  index: number;
}

function formatTimeForEvent(timestamp: string): {
  date: string;
  time: string;
  relative: string;
} {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    let relative: string;
    if (diffMins < 1) {
      relative = "just now";
    } else if (diffMins < 60) {
      relative = `${diffMins}m ago`;
    } else if (diffHours < 24) {
      relative = `${diffHours}h ago`;
    } else if (diffDays < 7) {
      relative = `${diffDays}d ago`;
    } else {
      relative = date.toLocaleDateString();
    }

    return {
      date: date.toLocaleDateString(),
      time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      relative,
    };
  } catch {
    return { date: timestamp, time: "", relative: timestamp };
  }
}

function ExpandableNote({ note }: ExpandableNoteProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { time, relative } = formatTimeForEvent(note.timestamp);

  const isLongNote = note.message.length > 150;
  const displayMessage =
    isLongNote && !isExpanded
      ? `${note.message.slice(0, 150)}...`
      : note.message;

  return (
    <div className="group relative pb-4 pl-6 last:pb-0">
      {/* Timeline dot */}
      <div className="bg-primary ring-background border-border absolute top-1 left-0 h-2 w-2 rounded-full border ring-2"></div>

      {/* Timeline line */}
      <div className="bg-border absolute top-3 left-0.5 h-full w-0.5 group-last:hidden"></div>

      {/* Event content */}
      <div className="space-y-2">
        {/* Header with time and tags */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="text-muted-foreground h-3 w-3" />
              <span className="text-foreground font-medium">{time}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-body-small">{relative}</span>
            </div>
          </div>

          {note.tags && note.tags.length > 0 && (
            <div className="flex items-center gap-1">
              {note.tags.map((tag, tagIndex) => (
                <span
                  key={tagIndex}
                  className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                >
                  <Tag className="h-2 w-2" />
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Message content */}
        <div className="text-foreground text-sm leading-relaxed">
          <div className="break-words whitespace-pre-wrap">
            {displayMessage}
          </div>

          {isLongNote && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-body-small hover:text-foreground mt-2 inline-flex items-center gap-1 transition-colors"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  Show more
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function EnhancedNotesSection({
  execution,
  onRefresh,
}: EnhancedNotesSectionProps) {
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Check if we have any notes content
  const hasNotes = execution.notes && execution.notes.length > 0;

  // Don't render the section at all if no content
  if (!hasNotes) {
    return null;
  }

  const sortedNotes = useMemo(() => {
    if (!execution.notes) return [];

    const notesCopy = [...execution.notes];

    switch (sortOrder) {
      case "newest":
        return notesCopy.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
      case "oldest":
        return notesCopy.sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
      case "chronological":
        return notesCopy.sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
      default:
        return notesCopy;
    }
  }, [execution.notes, sortOrder]);

  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent section collapse
    if (onRefresh) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setTimeout(() => setIsRefreshing(false), 500); // Minimum refresh animation time
      }
    }
  };

  const getSortIcon = () => {
    switch (sortOrder) {
      case "newest":
        return <ArrowDown className="h-3 w-3" />;
      case "oldest":
        return <ArrowUp className="h-3 w-3" />;
      case "chronological":
        return <ArrowUpDown className="h-3 w-3" />;
      default:
        return <ArrowUpDown className="h-3 w-3" />;
    }
  };

  const getSortLabel = () => {
    switch (sortOrder) {
      case "newest":
        return "Newest first";
      case "oldest":
        return "Oldest first";
      case "chronological":
        return "Chronological";
      default:
        return "Sort";
    }
  };

  const cycleSortOrder = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent section collapse
    const orders: SortOrder[] = ["newest", "oldest", "chronological"];
    const currentIndex = orders.indexOf(sortOrder);
    const nextIndex = (currentIndex + 1) % orders.length;
    setSortOrder(orders[nextIndex]);
  };

  const badge = (
    <div className="flex items-center gap-2">
      <span className="text-body-small bg-muted text-muted-foreground rounded px-2 py-0.5">
        {execution.notes?.length || 0}{" "}
        {execution.notes?.length === 1 ? "Event" : "Events"}
      </span>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={cycleSortOrder}
          className="text-muted-foreground hover:text-foreground h-6 px-2 text-xs"
          title={getSortLabel()}
        >
          {getSortIcon()}
        </Button>

        {onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="text-muted-foreground hover:text-foreground h-6 w-6 p-0"
            title="Refresh notes"
          >
            <RefreshCw
              className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          <h3 className="text-heading-3 text-foreground">Execution Events</h3>
          {badge}
        </div>
      </div>

      {/* Timeline container */}
      <div className="relative">
        {sortedNotes.map((note, index) => (
          <ExpandableNote
            key={`${note.timestamp}-${index}`}
            note={note}
            index={index}
          />
        ))}
      </div>

      {/* Summary footer */}
      {sortedNotes.length > 3 && (
        <div className="border-border mt-4 border-t pt-3">
          <div className="text-body-small text-center">
            {sortedNotes.length} events • Sorted by{" "}
            {getSortLabel().toLowerCase()}
          </div>
        </div>
      )}
    </div>
  );
}
