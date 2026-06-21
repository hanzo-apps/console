import { api } from "@/src/utils/api";
import { type EvalTemplate } from "@hanzo/console";
import { isCodeEvalTemplate } from "@/src/features/evals/utils/code-eval-template-utils";

export type TemplateValidationInput = Pick<
  EvalTemplate,
  "provider" | "model" | "type" | "sourceCodeLanguage"
>;

export function useSingleTemplateValidation({
  projectId,
}: {
  projectId: string;
}) {
  const { data: defaultModel } = api.defaultLlmModel.fetchDefaultModel.useQuery(
    { projectId },
  );

  const templateRequiresDefaultModel = (
    template: Pick<TemplateValidationInput, "provider" | "model" | "type">,
  ): boolean => {
    if (isCodeEvalTemplate(template)) return false;

    return !template.provider || !template.model;
  };

  const isTemplateInvalid = (
    template: Partial<EvalTemplate> & Pick<EvalTemplate, "provider" | "model">,
  ): boolean => {
    return templateRequiresDefaultModel(template) && !defaultModel;
  };

  return {
    isTemplateInvalid,
  };
}
