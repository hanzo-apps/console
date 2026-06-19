import { useMemo } from "react";
import { Button } from "@/src/components/ui/button";
import { Pencil } from "lucide-react";
import { JSONView } from "@/src/components/ui/CodeJsonViewer";
import type { FinalPreviewStepProps, DialogStep } from "./types";
import { applyFullMapping } from "@hanzo/console";

export function FinalPreviewStep({
  dataset,
  mapping,
  observationData,
  totalCount,
  onEditStep,
}: FinalPreviewStepProps) {
  // Compute the full preview
  const previewResult = useMemo(() => {
    if (!observationData) return null;

    return applyFullMapping({
      observation: {
        input: observationData.input,
        output: observationData.output,
        metadata: observationData.metadata,
      },
      mapping,
    });
  }, [observationData, mapping]);

  return (
    <div className="h-[62vh] space-y-6 p-6">
      <div>
        <h3 className="text-lg font-semibold">Review Configuration</h3>
        <p className="text-muted-foreground text-sm">
          Adding {totalCount} observation{totalCount !== 1 ? "s" : ""} to
          dataset &quot;
          {dataset.name}&quot;
        </p>
      </div>

      <div className="text-muted-foreground text-sm">
        Sample dataset item preview (from first selected observation):
      </div>

      {!observationData ? (
        <div className="bg-muted/30 flex h-64 items-center justify-center rounded-md border p-4">
          <p className="text-muted-foreground text-sm">
            No observation data available for preview
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <PreviewCard
            label="Input"
            data={previewResult?.input}
            onEdit={() => onEditStep("input-mapping" as DialogStep)}
          />
          <PreviewCard
            label="Expected Output"
            data={previewResult?.expectedOutput}
            onEdit={() => onEditStep("output-mapping" as DialogStep)}
          />
          <PreviewCard
            label="Metadata"
            data={previewResult?.metadata}
            onEdit={() => onEditStep("metadata-mapping" as DialogStep)}
          />
        </div>
      )}
    </div>
  );
}

function EditMappingActions({
  variant,
  fields,
  onEditStep,
}: {
  variant: IssueVariant;
  fields: string[];
  onEditStep: (step: DialogStep) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {fields.map((field) => (
        <Button
          key={field}
          variant="link"
          size="sm"
          className={cn(
            "h-auto p-0 text-xs underline",
            issueTextVariants({ variant }),
          )}
          onClick={() => {
            const step = STEP_FOR_FIELD[field];
            if (step) onEditStep(step);
          }}
        >
          Edit {fieldLabel(field)} mapping
        </Button>
      ))}
    </div>
  );
}

type PreviewCardProps = {
  label: string;
  data: unknown;
  onEdit: () => void;
};

function PreviewCard({ label, data, onEdit }: PreviewCardProps) {
  return (
    <div className="rounded-lg border">
      <div className="bg-muted/30 flex items-center justify-between border-b px-4 py-2">
        <span className="text-sm font-medium">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className="h-7 gap-1 text-xs"
        >
          <Pencil className="h-3 w-3" />
          Edit
        </Button>
      </div>
      <div className="max-h-62 overflow-auto">
        {data === null ? (
          <div className="text-muted-foreground p-4 text-sm italic">null</div>
        ) : (
          <JSONView json={data} className="text-xs" />
        )}
      </div>
    </div>
  );
}
