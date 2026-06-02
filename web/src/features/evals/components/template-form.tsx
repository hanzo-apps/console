import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { Input } from "@/src/components/ui/input";
import { Button } from "@/src/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/src/components/ui/form";
import { api } from "@/src/utils/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { extractVariables, getIsCharOrUnderscore } from "@hanzo/console-core";
import router from "next/router";
import { type EvalTemplate } from "@hanzo/console-core";
import { ModelParameters } from "@/src/components/ModelParameters";
import { OutputSchema, type ModelParams, ZodModelConfig } from "@hanzo/console-core";
import { PromptVariableListPreview } from "@/src/features/prompts/components/PromptVariableListPreview";
import { useInsightsCapture } from "@/src/features/insights-analytics/useInsightsCapture";
import { getFinalModelParams } from "@/src/utils/getFinalModelParams";
import { useModelParams } from "@/src/features/playground/page/hooks/useModelParams";
import { showSuccessToast } from "@/src/features/notifications/showSuccessToast";
import { EvalReferencedEvaluators } from "@/src/features/evals/types";
import {
  getDefaultOutputDefinitionFormValues,
  shouldReplaceDefaultOutputDefinitionField,
} from "@/src/features/evals/utils/template-form-defaults";
import { templateFormSchema } from "@/src/features/evals/utils/template-form-schema";
import { CodeMirrorEditor } from "@/src/components/editor";
import { Card, CardContent } from "@/src/components/ui/card";
import { type RouterInput } from "@/src/utils/types";
import { useEvaluationModel } from "@/src/features/evals/hooks/useEvaluationModel";
import { Checkbox } from "@hanzo/ui";
import { ManageDefaultEvalModel } from "@/src/features/evals/components/manage-default-eval-model";
import { DialogFooter, DialogBody } from "@/src/components/ui/dialog";
import { AlertCircle, AlertTriangle, PlusIcon, Trash } from "lucide-react";
import { useValidateCustomModel } from "@/src/features/evals/hooks/useValidateCustomModel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { useIsCodeEvalEnabled } from "@/src/features/evals/hooks/useIsCodeEvalEnabled";
import { CodeEvalTemplateFormBody } from "@/src/features/evals/components/code-eval-template-form-body";
import {
  type CodeEvalSourceCodeLanguage,
  getCodeEvalSourceForEditor,
  getDefaultCodeEvalSource,
  formatAndStripCodeEvalSourceForSubmit,
} from "@/src/features/evals/utils/code-eval-template-validation";
import { useCodeEvalSourceValidation } from "@/src/features/evals/hooks/useCodeEvalSourceValidation";
import {
  EvalTemplateTypeSelector,
  type EvalTemplateTypeSelectorMode,
} from "@/src/features/evals/components/eval-template-type-selector";
import { Alert, AlertDescription } from "@/src/components/ui/alert";
import {
  useEvalCapabilities,
  type EvalCapabilities,
} from "@/src/features/evals/hooks/useEvalCapabilities";

type PartialEvalTemplate = Omit<EvalTemplate, "id" | "version" | "createdAt" | "updatedAt"> & { id?: string };

export const EvalTemplateForm = (props: {
  projectId: string;
  useDialog: boolean;
  existingEvalTemplate?: PartialEvalTemplate;
  preFilledFormValues?: EvalTemplateFormPreFill;
  templateTypeSelectorMode?: EvalTemplateTypeSelectorMode;
  onFormSuccess?: (template?: EvalTemplate) => void;
  onBeforeSubmit?: (template: RouterInput["evals"]["createTemplate"]) => boolean;
  isEditing?: boolean;
  setIsEditing?: (isEditing: boolean) => void;
  preventRedirect?: boolean;
  cloneSourceId?: string | null;
}) => {
  return (
    <div className={props.useDialog ? "max-w-6xl" : "w-full"}>
      <InnerEvalTemplateForm
        key={props.existingEvalTemplate?.id ?? "new"}
        {...props}
        existingEvalTemplateId={props.existingEvalTemplate?.id}
        existingEvalTemplateName={props.existingEvalTemplate?.name}
        cloneSourceId={props.cloneSourceId}
        onBeforeSubmit={props.onBeforeSubmit}
        preFilledFormValues={
          // if a hanzo template is selected, use that, else use the existing template
          // no hanzo template is selected if there is already an existing template
          props.existingEvalTemplate
            ? {
                name: props.existingEvalTemplate.name,
                prompt: props.existingEvalTemplate.prompt ?? "",
                vars: props.existingEvalTemplate.vars,
                outputDefinition: props.existingEvalTemplate
                  .outputDefinition as PersistedEvalOutputDefinition,
                type: props.existingEvalTemplate.type,
                sourceCode: props.existingEvalTemplate.sourceCode,
                sourceCodeLanguage:
                  props.existingEvalTemplate.sourceCodeLanguage ?? undefined,
                selectedModel: props.existingEvalTemplate.provider
                  ? {
                      provider: props.existingEvalTemplate.provider as string,
                      model: props.existingEvalTemplate.model as string,
                      modelParams: props.existingEvalTemplate.modelParams as ModelParams & {
                        maxTemperature: number;
                      },
                    }
                  : undefined,
              }
            : props.preFilledFormValues
        }
      />
    </div>
  );
};

const selectedModelSchema = z.object({
  provider: z.string().min(1, "Select a provider"),
  model: z.string().min(1, "Select a model"),
  modelParams: ZodModelConfig,
});

const toOutputDefinitionFormValues = (
  outputDefinition?: PersistedEvalOutputDefinition | null,
) => {
  if (!outputDefinition) {
    return getDefaultOutputDefinitionFormValues();
  }

  variables: z.array(z.string().min(1, "Variables must have at least one character")),
  outputScore: z.string().min(1, "Enter a score function"),
  outputReasoning: z.string().min(1, "Enter a reasoning function"),
  referencedEvaluators: z.enum(EvalReferencedEvaluators).optional().default(EvalReferencedEvaluators.PERSIST),
  shouldUseDefaultModel: z.boolean().default(true),
});

export type EvalTemplateFormPreFill = {
  name: string;
  type?: EvalTemplateType;
  prompt: string;
  vars: string[];
  outputDefinition?: PersistedEvalOutputDefinition | null;
  sourceCode?: string | null;
  sourceCodeLanguage?: CodeEvalSourceCodeLanguage | null;
  selectedModel?: {
    provider: string;
    model: string;
    modelParams: ModelParams & {
      maxTemperature: number;
    };
  };
};

export const InnerEvalTemplateForm = (props: {
  projectId: string;
  useDialog: boolean;
  // pre-filled values from hanzo-defined template or template from db
  preFilledFormValues?: EvalTemplateFormPreFill;
  templateTypeSelectorMode?: EvalTemplateTypeSelectorMode;
  // template to be updated
  existingEvalTemplateId?: string;
  existingEvalTemplateName?: string;
  onFormSuccess?: (template?: EvalTemplate) => void;
  onBeforeSubmit?: (template: any) => boolean;
  isEditing?: boolean;
  setIsEditing?: (isEditing: boolean) => void;
  preventRedirect?: boolean;
  cloneSourceId?: string | null;
}) => {
  const capture = useInsightsCapture();
  const [formError, setFormError] = useState<string | null>(null);
  const codeEvalCapabilities = useIsCodeEvalEnabled();
  const { enabled: isCodeEvalEnabled } = codeEvalCapabilities;
  const templateTypeSelectorMode = props.templateTypeSelectorMode ?? "all";

  // Determine if we should use default model or custom model
  // If existing template has no provider, it was using default model
  const isExistingUsingDefault = props.preFilledFormValues?.selectedModel ? false : true;

  const { data: defaultModel } = api.defaultLlmModel.fetchDefaultModel.useQuery(
    { projectId: props.projectId },
    { enabled: !!props.projectId },
  );

  // updates the model params based on the pre-filled data
  // either form update or from hanzo-generated template
  const {
    modelParams,
    setModelParams,
    updateModelParamValue,
    setModelParamEnabled,
    availableModels,
    providerModelCombinations,
    availableProviders,
  } = useModelParams();

  useEvaluationModel(props.projectId, setModelParams, props.preFilledFormValues?.selectedModel);

  const { isCustomModelValid } = useValidateCustomModel(availableProviders, props.preFilledFormValues?.selectedModel);

  const outputDefinitionFormValues = toOutputDefinitionFormValues(
    props.preFilledFormValues?.outputDefinition,
  );
  const defaultSourceCodeLanguage =
    props.preFilledFormValues?.sourceCodeLanguage ??
    EvalTemplateSourceCodeLanguage.TYPESCRIPT;

  // updates the form based on the pre-filled data
  // either form update or from hanzo-generated template
  const form = useForm({
    resolver: zodResolver(templateFormSchema),
    disabled: !props.isEditing,
    defaultValues: {
      name: props.existingEvalTemplateName ?? props.preFilledFormValues?.name ?? "",
      prompt: props.preFilledFormValues?.prompt ?? undefined,
      variables: props.preFilledFormValues?.vars ?? [],
      sourceCode: props.preFilledFormValues?.sourceCode
        ? getCodeEvalSourceForEditor({
            sourceCode: props.preFilledFormValues.sourceCode,
            sourceCodeLanguage: defaultSourceCodeLanguage,
          })
        : getDefaultCodeEvalSource(defaultSourceCodeLanguage),
      sourceCodeLanguage: defaultSourceCodeLanguage,
      scoreDataType: outputDefinitionFormValues.scoreDataType,
      reasoningDescription: outputDefinitionFormValues.reasoningDescription,
      scoreDescription: outputDefinitionFormValues.scoreDescription,
      categories: outputDefinitionFormValues.categories,
      shouldAllowMultipleMatches:
        outputDefinitionFormValues.shouldAllowMultipleMatches,
      shouldUseDefaultModel: isExistingUsingDefault,
    },
  });

  const {
    fields: categoryFields,
    append,
    remove,
    replace,
  } = useFieldArray({
    control: form.control,
    name: "categories",
  });

  const useDefaultModel = form.watch("shouldUseDefaultModel");
  const evalTemplateType = form.watch("type");
  const sourceCodeLanguage =
    form.watch("sourceCodeLanguage") ??
    EvalTemplateSourceCodeLanguage.TYPESCRIPT;
  const sourceCode = form.watch("sourceCode") ?? "";
  const showCodeTemplateForm =
    isCodeEvalEnabled && evalTemplateType === EvalTemplateType.CODE;
  const evalCapabilities = useEvalCapabilities(props.projectId, {
    isCodeEvalTemplate: showCodeTemplateForm,
  });
  const {
    isValid: isCodeEvalSourceValid,
    validationResult: codeValidationResult,
    validate: validateCodeEvalSource,
    reset: resetCodeEvalSourceValidation,
  } = useCodeEvalSourceValidation({
    enabled: showCodeTemplateForm,
    sourceCode,
    sourceCodeLanguage,
  });
  const scoreDataType = form.watch("scoreDataType");
  const isCategoricalOutput = scoreDataType === ScoreDataTypeEnum.CATEGORICAL;
  const isBooleanOutput = scoreDataType === ScoreDataTypeEnum.BOOLEAN;
  const shouldAllowMultipleMatches = form.watch("shouldAllowMultipleMatches");
  const categoriesError = form.formState.errors.categories;
  const categoriesErrorMessage =
    typeof categoriesError?.message === "string"
      ? categoriesError.message
      : typeof categoriesError?.root?.message === "string"
        ? categoriesError.root.message
        : undefined;

  const applyDefaultOutputDefinitionCopy = (params: {
    scoreDataType:
      | typeof ScoreDataTypeEnum.NUMERIC
      | typeof ScoreDataTypeEnum.BOOLEAN
      | typeof ScoreDataTypeEnum.CATEGORICAL;
    shouldAllowMultipleMatches: boolean;
  }) => {
    const defaults = getDefaultOutputDefinitionFormValues(params);

    if (
      shouldReplaceDefaultOutputDefinitionField({
        currentValue: form.getValues("reasoningDescription"),
        field: "reasoningDescription",
      })
    ) {
      form.setValue("reasoningDescription", defaults.reasoningDescription);
    }

    if (
      shouldReplaceDefaultOutputDefinitionField({
        currentValue: form.getValues("scoreDescription"),
        field: "scoreDescription",
      })
    ) {
      form.setValue("scoreDescription", defaults.scoreDescription);
    }
  };

  const promptValue = form.watch("prompt");
  const extractedVariables = promptValue
    ? extractVariables(promptValue).filter(getIsCharOrUnderscore)
    : undefined;

  const utils = api.useUtils();
  const createEvalTemplateMutation = api.evals.createTemplate.useMutation({
    onSuccess: () => {
      utils.models.invalidate();
      if (form.getValues("referencedEvaluators") === EvalReferencedEvaluators.UPDATE && props.existingEvalTemplateId) {
        showSuccessToast({
          title: "Updated evaluators",
          description: "Updated referenced evaluators to use new template version.",
        });
      }
    },
    onError: (error) => setFormError(error.message),
  });

  const evaluatorsByTemplateNameQuery = api.evals.jobConfigsByTemplateName.useQuery(
    {
      projectId: props.projectId,
      evalTemplateName: props.existingEvalTemplateName as string,
    },
    {
      enabled: !!props.existingEvalTemplateName,
    },
  );

  useEffect(() => {
    if (evaluatorsByTemplateNameQuery.data) {
      form.setValue(
        "referencedEvaluators",
        Boolean(evaluatorsByTemplateNameQuery.data.evaluators.length)
          ? EvalReferencedEvaluators.UPDATE
          : EvalReferencedEvaluators.PERSIST,
      );
    }
  }, [evaluatorsByTemplateNameQuery.data, form]);

  function onSubmit(values: z.infer<typeof formSchema>) {
    capture(props.isEditing ? "eval_templates:update_form_submit" : "eval_templates:new_form_submit");

    if (values.type === EvalTemplateType.CODE) {
      const submittedSourceCodeLanguage =
        values.sourceCodeLanguage ?? EvalTemplateSourceCodeLanguage.TYPESCRIPT;
      const isValidSource = await validateCodeEvalSource({
        sourceCode: values.sourceCode ?? "",
        sourceCodeLanguage: submittedSourceCodeLanguage,
      });

      if (!isValidSource) {
        return;
      }

      const formattedSourceCode = await formatAndStripCodeEvalSourceForSubmit({
        sourceCode: values.sourceCode ?? "",
        sourceCodeLanguage: submittedSourceCodeLanguage,
      });

      const evalTemplate = {
        type: EvalTemplateType.CODE,
        name: values.name,
        projectId: props.projectId,
        sourceCode: formattedSourceCode,
        sourceCodeLanguage: submittedSourceCodeLanguage,
        referencedEvaluators: values.referencedEvaluators,
        cloneSourceId: props.cloneSourceId ?? undefined,
      } satisfies RouterInput["evals"]["createTemplate"];

      await submitEvalTemplate(evalTemplate);
      return;
    }

    const outputDefinition =
      values.scoreDataType === ScoreDataTypeEnum.CATEGORICAL
        ? createCategoricalEvalOutputDefinition({
            scoreDescription: values.scoreDescription ?? "",
            reasoningDescription: values.reasoningDescription ?? "",
            categories: values.categories.map((category) => category.value),
            shouldAllowMultipleMatches: values.shouldAllowMultipleMatches,
          })
        : values.scoreDataType === ScoreDataTypeEnum.BOOLEAN
          ? createBooleanEvalOutputDefinition({
              scoreDescription: values.scoreDescription ?? "",
              reasoningDescription: values.reasoningDescription ?? "",
            })
          : createNumericEvalOutputDefinition({
              scoreDescription: values.scoreDescription ?? "",
              reasoningDescription: values.reasoningDescription ?? "",
            });

    const evalTemplate = {
      type: EvalTemplateType.LLM_AS_JUDGE,
      name: values.name,
      projectId: props.projectId,
      prompt: values.prompt ?? "",
      // Only include model details if not using default model
      provider: values.shouldUseDefaultModel ? undefined : modelParams.provider.value,
      model: values.shouldUseDefaultModel ? undefined : modelParams.model.value,
      modelParams: values.shouldUseDefaultModel ? undefined : getFinalModelParams(modelParams),
      vars: extractedVariables ?? [],
      outputDefinition,
      referencedEvaluators: values.referencedEvaluators,
      cloneSourceId: props.cloneSourceId ?? undefined,
    } satisfies RouterInput["evals"]["createTemplate"];

    // Only validate model if not using default
    if (!values.shouldUseDefaultModel) {
      const parsedModel = selectedModelSchema.safeParse({
        provider: evalTemplate.provider,
        model: evalTemplate.model,
        modelParams: evalTemplate.modelParams,
      });

      if (!parsedModel.success) {
        setFormError(`${parsedModel.error.issues[0].path}: ${parsedModel.error.issues[0].message}`);
        return;
      }
    } else {
      if (!defaultModel) {
        setFormError("No default evaluation model set. Set up default evaluation model or use a custom model");
        return;
      }
    }

    // Check if we need to perform any pre-submission validation or confirmation
    if (props.onBeforeSubmit && !props.onBeforeSubmit(evalTemplate)) {
      return; // Stop submission - the parent will handle it
    }

    createEvalTemplateMutation
      .mutateAsync(evalTemplate)
      .then((res) => {
        props.onFormSuccess?.(res);
        form.reset();
        props.setIsEditing?.(false);
        if (props.preventRedirect) {
          return;
        }
        void router.push(`/project/${props.projectId}/evals/templates/${res.id}`);
      })
      .catch((error) => {
        if ("message" in error && typeof error.message === "string") {
          setFormError(error.message as string);
          return;
        } else {
          setFormError(JSON.stringify(error));
          console.error(error);
        }
      });
  }

  const formBody = (
    <>
      {!props.existingEvalTemplateId ? (
        <>
          <div className="col-span-1 row-span-1 lg:col-span-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <>
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Select a name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                </>
              )}
            />
          </div>
          <div className="col-span-1 row-span-1 lg:col-span-0"></div>
        </>
      ) : undefined}

      <EvalTemplateTypeSelector
        form={form}
        codeEvalCapabilities={codeEvalCapabilities}
        mode={templateTypeSelectorMode}
        hasExistingTemplate={Boolean(props.existingEvalTemplateId)}
        onChange={() => {
          resetCodeEvalSourceValidation();
          setFormError(null);
        }}
      />

      {showCodeTemplateForm ? (
        <div className="space-y-3">
          {props.isEditing ? (
            <CodeEvalSdkVersionCallout evalCapabilities={evalCapabilities} />
          ) : null}
          <FormField
            control={form.control}
            name="sourceCode"
            render={({ field }) => (
              <FormItem className="mt-3 flex flex-row items-center space-x-3 space-y-0">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} disabled={!props.isEditing} />
                </FormControl>
                <div className="space-y-0 leading-none">
                  <FormLabel>Use default evaluation model</FormLabel>
                  <FormDescription className="text-xs">
                    <ManageDefaultEvalModel
                      projectId={props.projectId}
                      variant="color-coded"
                      setUpMessage="No default model set. Set up default evaluation model"
                      className="text-sm font-normal"
                    />
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />
          {/* Only show model parameters if using custom model */}
          {!useDefaultModel &&
            (!props.isEditing && !isCustomModelValid ? (
              <div className="mt-2 flex items-center space-x-1 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <p>
                  This evaluator is configured to use {modelParams.provider.value}s models but no API key exists. Add a
                  key or choose another provider.
                </p>
              </div>
            ) : (
              <ModelParameters
                customHeader={<p className="text-sm font-medium leading-none">Custom model configuration</p>}
                {...{
                  modelParams,
                  availableModels,
                  providerModelCombinations,
                  availableProviders,
                  updateModelParamValue: updateModelParamValue,
                  setModelParamEnabled,
                  modelParamsDescription: "Select a model which supports function calling.",
                }}
                formDisabled={!props.isEditing}
              />
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <p className="my-2 font-semibold">Prompt</p>
            <FormField
              control={form.control}
              name="prompt"
              render={({ field }) => (
                <>
                  <FormItem>
                    <FormLabel>Evaluation prompt</FormLabel>
                    <FormDescription>
                      Define your llm-as-a-judge evaluation template. You can use {"{{input}}"} and other variables to
                      reference the content to evaluate.
                    </FormDescription>
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!props.isEditing}
                      />
                    </FormControl>
                    <FormMessage />
                    <PromptVariableListPreview variables={extractedVariables ?? []} />
                  </FormItem>
                )}
              />
              {/* Only show model parameters if using custom model */}
              {!useDefaultModel &&
                (!props.isEditing && !isCustomModelValid ? (
                  <div className="text-destructive mt-2 flex items-center space-x-1 text-sm">
                    <AlertCircle className="h-4 w-4" />
                    <p>
                      This evaluator is configured to use{" "}
                      {modelParams.provider.value}s models but no API key
                      exists. Add a key or choose another provider.
                    </p>
                  </div>
                ) : (
                  <ModelParameters
                    customHeader={
                      <p className="text-sm leading-none font-medium">
                        Custom model configuration
                      </p>
                    }
                    {...{
                      modelParams,
                      availableModels,
                      providerModelCombinations,
                      availableProviders,
                      updateModelParamValue: updateModelParamValue,
                      setModelParamEnabled,
                      modelParamsDescription:
                        "Select a model which supports function calling.",
                    }}
                    formDisabled={!props.isEditing}
                  />
                ))}
            </CardContent>
          </Card>

          <FormField
            control={form.control}
            name="outputReasoning"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Score reasoning prompt</FormLabel>
                <FormDescription>
                  Define how the LLM should explain its evaluation. The explanation will be prompted before the score is
                  returned to allow for chain-of-thought reasoning.
                </FormDescription>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="outputScore"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Score range prompt</FormLabel>
                <FormDescription>
                  Define how the LLM should return the evaluation score in natural language. Needs to yield a numeric
                  value.
                </FormDescription>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </CardContent>
      </Card>
    </>
  );

  const formFooter = (
    <div className="flex w-full flex-col items-end gap-4">
      {props.isEditing && (
        <Button type="submit" loading={createEvalTemplateMutation.isPending} className="max-w-fit">
          Save
        </Button>
      )}
      {formError ? (
        <p className="text-red w-full text-center">
          <span className="font-bold">Error:</span> {formError}
        </p>
      ) : null}
    </div>
  );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="mt-2 w-full space-y-4"
      >
        {props.useDialog ? <DialogBody>{formBody}</DialogBody> : formBody}

        {props.useDialog ? <DialogFooter>{formFooter}</DialogFooter> : formFooter}
      </form>
    </Form>
  );
};

function CodeEvalSdkVersionCallout({
  evalCapabilities,
}: {
  evalCapabilities: EvalCapabilities;
}) {
  if (
    evalCapabilities.isLoading ||
    !evalCapabilities.compatibilityCheckWasPerformed ||
    evalCapabilities.isNewCompatible
  ) {
    return null;
  }

  return (
    <Alert
      variant="default"
      className="border-dark-yellow bg-light-yellow max-w-4xl"
    >
      <AlertTriangle className="text-dark-yellow h-4 w-4" />
      <AlertDescription>
        <div className="flex flex-col gap-1">
          <span className="text-foreground font-medium">
            Please verify your SDK version
          </span>
          <span className="text-foreground text-sm">
            Code evaluators require JS SDK v4+ or Python SDK v3+. You can create
            this evaluator now, but it will only run once your project ingests
            data with a compatible SDK.{" "}
            <a
              href="https://langfuse.com/docs/observability/sdk/upgrade-path"
              target="_blank"
              rel="noopener noreferrer"
              className="text-dark-blue font-medium hover:opacity-80"
            >
              Learn more
            </a>
            .
          </span>
        </div>
      </AlertDescription>
    </Alert>
  );
}
