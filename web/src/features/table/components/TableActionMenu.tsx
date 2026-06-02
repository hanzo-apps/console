import { useState } from "react";
import { Button } from "@/src/components/ui/button";
import { X, Trash } from "lucide-react";
import { Plus } from "lucide-react";
import { type TableAction, type CustomDialogTableAction } from "@/src/features/table/types";
import { TableActionDialog } from "@/src/features/table/components/TableActionDialog";
import { type BatchExportTableName } from "@hanzo/console-core";

type TableActionMenuProps = {
  projectId: string;
  actions: TableAction[];
  tableName: BatchExportTableName;
  selectedCount: number | null;
  onClearSelection: () => void;
  onCustomAction?: (actionType: CustomDialogTableAction["id"]) => void;
};

const getDefaultIcon = (type: TableAction["type"]) => {
  if (type === "create") {
    return <Plus className="h-4 w-4 sm:mr-2" />;
  }
  return <Trash className="h-4 w-4 sm:mr-2" />;
};

export function TableActionMenu({ projectId, actions, tableName, onCustomAction }: TableActionMenuProps) {
  const [selectedAction, setSelectedAction] = useState<TableAction | null>(null);
  const [isDialogOpen, setDialogOpen] = useState(false);

  const handleActionSelect = (action: TableAction) => {
    if ("customDialog" in action && action.customDialog) {
      onCustomAction?.(action.id);
      return;
    }
    setSelectedAction(action);
    setDialogOpen(true);
  };

  const handleClose = () => {
    setSelectedAction(null);
    setDialogOpen(false);
  };

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-16 z-50 flex justify-center">
        <div className="ring-dark-blue/20 dark:border-dark-blue/30 dark:ring-dark-blue/30 bg-background pointer-events-auto flex items-center gap-2 rounded-lg border px-3 py-2 opacity-95 shadow-lg ring-2 backdrop-blur-md dark:shadow-none">
          <div className="text-sm font-medium">
            {selectedCount !== null ? (
              <span> {`${numberFormatter(selectedCount, 0)} selected`}</span>
            ) : (
              <Spinner size="sm" />
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClearSelection}
          >
            <X className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {actions.map((action) => (
            <DropdownMenuItem key={action.id} onClick={() => handleActionSelect(action)}>
              {action.icon || getDefaultIcon(action.type)}
              <span>{action.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedAction && (
        <TableActionDialog
          isOpen={isDialogOpen}
          onClose={handleClose}
          onSuccess={onClearSelection}
          action={selectedAction}
          projectId={projectId}
          tableName={tableName}
        />
      )}
    </>
  );
}
