import { useState } from "react";
import { useRouter } from "next/router";
import { api } from "@/src/utils/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { BrainCircuit, Code2 } from "lucide-react";
import { EvaluatorSelector } from "./evaluator-selector";
import { EvalTemplateForm } from "./template-form";
import { showSuccessToast } from "@/src/features/notifications/showSuccessToast";
import { SetupDefaultEvalModelCard } from "@/src/features/evals/components/set-up-default-eval-model-card";
import { useTemplateValidation } from "@/src/features/evals/hooks/useTemplateValidation";
import { Card } from "@/src/components/ui/card";
import { Skeleton } from "@hanzo/ui";
import { type EvalTemplate } from "@hanzo/console-core";

type SelectEvaluatorListProps = {
  projectId: string;
};

export function SelectEvaluatorList({ projectId }: SelectEvaluatorListProps) {
  const router = useRouter();
  const [isCreateTemplateOpen, setIsCreateTemplateOpen] = useState(false);
  const [customEvaluatorType, setCustomEvaluatorType] = useState<
    typeof EvalTemplateType.LLM_AS_JUDGE | typeof EvalTemplateType.CODE | null
  >(null);
  const codeEvalCapabilities = useIsCodeEvalEnabled();
  const { enabled: isCodeEvalEnabled } = codeEvalCapabilities;

  const handleSelectEvaluator = (template: EvalTemplate) => {
    router.push(`/project/${projectId}/evals/new?evaluator=${template.id}`);
  };

  const { isSelectionValid, selectedTemplate, setSelectedTemplate } = useTemplateValidation({
    projectId,
    onValidSelection: handleSelectEvaluator,
  });

  // Fetch templates
  const templates = api.evals.allTemplates.useQuery(
    {
      projectId,
    },
    {
      enabled: Boolean(projectId),
    },
  );

  const utils = api.useUtils();

  const handleOpenCreateEvaluator = (
    type: typeof EvalTemplateType.LLM_AS_JUDGE | typeof EvalTemplateType.CODE,
  ) => {
    setCustomEvaluatorType(type);
    setIsCreateTemplateOpen(true);
  };

  const handleTemplateSelect = (templateId: string) => {
    const template = templates.data?.templates.find((t) => t.id === templateId);
    if (template) {
      setSelectedTemplate(template);
    }
  };

  return (
    <>
      <Card className="grid max-h-[90vh] grid-rows-[auto_1fr_auto] overflow-hidden p-3">
        <div className="flex flex-col overflow-hidden">
          {templates.isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : templates.isError ? (
            <div className="py-8 text-center text-destructive">Error: {templates.error.message}</div>
          ) : templates.data?.templates.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No evaluators found. Create a new evaluator to get started.
            </div>
          ) : (
            <div className="flex-1 overflow-hidden">
              <EvaluatorSelector
                projectId={projectId}
                evalTemplates={templates.data?.templates || []}
                selectedTemplateId={selectedTemplate?.id || undefined}
                onTemplateSelect={(templateId) => handleTemplateSelect(templateId)}
              />
            </div>
          )}
        </div>

        <div className="flex max-h-full min-h-0 flex-col gap-2">
          <h2 className="shrink-0 text-base font-semibold">Use existing</h2>
          <Card className="grid max-h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-y-auto p-3">
            <div className="flex min-h-0 flex-col overflow-hidden">
              {templates.isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : templates.isError ? (
                <div className="text-destructive py-8 text-center">
                  Error: {templates.error.message}
                </div>
              ) : templates.data?.templates.length === 0 ? (
                <div className="text-muted-foreground py-8 text-center">
                  No evaluators found. Create a new evaluator to get started.
                </div>
              ) : (
                <div className="flex-1 overflow-hidden">
                  <EvaluatorSelector
                    projectId={projectId}
                    evalTemplates={templates.data?.templates || []}
                    selectedTemplateId={selectedTemplate?.id || undefined}
                    onTemplateSelect={(templateId) =>
                      handleTemplateSelect(templateId)
                    }
                  />
                </div>
              )}
            </div>

            {!isSelectionValid && (
              <div className="px-4">
                <SetupDefaultEvalModelCard projectId={projectId} />
              </div>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={isCreateTemplateOpen} onOpenChange={setIsCreateTemplateOpen}>
        <DialogContent className="max-h-[90vh] max-w-screen-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create new evaluator</DialogTitle>
          </DialogHeader>
          <EvalTemplateForm
            key={customEvaluatorType ?? "custom-evaluator"}
            projectId={projectId}
            preventRedirect={true}
            isEditing={true}
            useDialog={true}
            templateTypeSelectorMode={
              customEvaluatorType === EvalTemplateType.CODE
                ? "code-only"
                : "hidden"
            }
            preFilledFormValues={{
              name: "",
              type: customEvaluatorType ?? EvalTemplateType.LLM_AS_JUDGE,
              prompt: "",
              vars: [],
              ...(customEvaluatorType === EvalTemplateType.CODE
                ? {
                    sourceCode: getDefaultCodeEvalSource(
                      EvalTemplateSourceCodeLanguage.TYPESCRIPT,
                    ),
                    sourceCodeLanguage:
                      EvalTemplateSourceCodeLanguage.TYPESCRIPT,
                  }
                : {}),
            }}
            onFormSuccess={(newTemplate) => {
              setIsCreateTemplateOpen(false);
              setCustomEvaluatorType(null);
              utils.evals.allTemplates.invalidate();
              if (newTemplate) {
                setSelectedTemplate(newTemplate);
              }
              showSuccessToast({
                title: "Evaluator created successfully",
                description: "You can now use this evaluator.",
              });
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
