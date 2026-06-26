import { FileText } from "@/src/features/agents/components/ui/icon-bridge";
import type { WorkflowExecution } from "../../types/executions";
import { CollapsibleSection } from "./CollapsibleSection";

interface SmartNotesSectionProps {
  execution: WorkflowExecution;
}

export function SmartNotesSection({ execution }: SmartNotesSectionProps) {
  // Check if we have any notes content
  const hasNotes = execution.notes && execution.notes.length > 0;

  // Don't render the section at all if no content
  if (!hasNotes) {
    return null;
  }

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  return (
    <CollapsibleSection
      title="Execution Notes"
      icon={FileText}
      defaultOpen={false}
      badge={
        <span className="text-body-small bg-primary/10 text-foreground rounded px-2 py-0.5">
          {execution.notes?.length || 0}{" "}
          {execution.notes?.length === 1 ? "Note" : "Notes"}
        </span>
      }
    >
      <div className="space-y-3 p-4">
        {execution.notes?.map((note, index) => (
          <div
            key={index}
            className="bg-muted/50 border-border/50 rounded-lg border p-3"
          >
            <div className="mb-2 flex items-start justify-between">
              <div className="flex items-center gap-2">
                {note.tags && note.tags.length > 0 && (
                  <div className="flex gap-1">
                    {note.tags.map((tag, tagIndex) => (
                      <span
                        key={tagIndex}
                        className="bg-muted text-foreground rounded px-1.5 py-0.5 text-xs"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-body-small">
                {formatTimestamp(note.timestamp)}
              </span>
            </div>
            <div className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
              {note.message}
            </div>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}
