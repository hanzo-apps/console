import { useCallback, useEffect } from "react";
import { useRouter } from "next/router";
import { Button } from "@/src/components/ui/button";
import { Form } from "@/src/components/ui/form";
import { HanzoIcon } from "@/src/components/HanzoLogo";
import { useSurveyForm } from "../hooks/useSurveyForm";
import type { SurveyFormData } from "../lib/surveyTypes";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/src/components/ui/form";
import { Input } from "@/src/components/ui/input";

export function OnboardingSurvey() {
  const router = useRouter();
  const { form, handleSubmit } = useSurveyForm();

  const handleSkipButton = useCallback(() => {
    router.push("/");
  }, [router]);

  const onSubmit = useCallback(
    async (data: SurveyFormData) => {
      if (!data.referralSource?.trim()) {
        handleSkipButton();
        return;
      }

      await handleSubmit(data);
      router.push("/");
    },
    [handleSkipButton, handleSubmit, router],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux) on referralSource step submits the form
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        if (currentQuestion?.id === "referralSource") {
          event.preventDefault();
          form.handleSubmit(onSubmit)();
          return;
        }
      }

      // Regular Enter advances to next step (existing behavior)
      if (event.key === "Enter" && !isLastStep) {
        if (currentQuestion?.type !== "text") {
          goNext();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    isLastStep,
    currentQuestion?.type,
    currentQuestion?.id,
    goNext,
    form,
    onSubmit,
  ]);

  // Auto-focus the first form control of the current step
  useEffect(() => {
    if (!currentQuestion?.id) return;
    const field = currentQuestion.id as Path<SurveyFormData>;
    const raf = requestAnimationFrame(() => {
      try {
        form.setFocus(field, { shouldSelect: true });
      } catch {
        // ignore if the control cannot be focused
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [currentQuestion?.id, form]);

  // Determine labeling/behavior of the primary (right) button
  const roleValue = form.watch("role");
  const signupReasonValue = form.watch("signupReason");
  const referralSourceValue = form.watch("referralSource");

  const currentFieldId = currentQuestion?.id as
    | keyof SurveyFormData
    | undefined;
  const currentValue = currentFieldId
    ? form.watch(currentFieldId as Path<SurveyFormData>)
    : undefined;

  const isEmpty = (v: unknown) =>
    v == null || (typeof v === "string" && v.trim() === "");
  const allFields = {
    role: roleValue,
    signupReason: signupReasonValue,
    referralSource: referralSourceValue,
  } as const;

  const currentEmpty = isEmpty(currentValue);
  const showSkip = currentEmpty;

  return (
    <div className="flex flex-1 flex-col py-6 sm:min-h-full sm:justify-start sm:px-6 sm:py-12 lg:px-8">
      <div className="flex items-center justify-center gap-2 sm:mx-auto sm:w-full sm:max-w-md">
        <HanzoIcon className="h-8 w-8" />
      </div>

      <div className="bg-background mt-6 rounded-lg px-6 py-6 shadow-sm sm:mx-auto sm:mt-16 sm:w-full sm:max-w-[480px] sm:px-12 sm:py-10">
        <Form {...form}>
          <form
            className="flex h-full flex-col"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <div className="flex-1">
              <FormField
                control={form.control}
                name="referralSource"
                render={({ field }) => (
                  <FormItem className="flex flex-col gap-2">
                    <FormLabel className="text-xl font-semibold">
                      Where did you hear about us?
                    </FormLabel>
                    <FormControl>
                      <Input
                        autoFocus
                        placeholder="Colleague, Word of Mouth, X, Reddit, Event"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end pt-6">
              {showSkip ? (
                <Button
                  type="button"
                  onClick={handleSkipButton}
                  variant="ghost"
                  className="w-20"
                >
                  Skip
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={handleSubmitButton}
                  variant="default"
                  className="w-20"
                >
                  {isLastStep ? "Finish" : "Next"}
                </Button>
              )}

              <div className="basis-[10rem] px-4">
                <SurveyProgress
                  currentStep={state.currentStep}
                  totalSteps={totalSteps}
                />
              </div>

              {!isFirstStep ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={goBack}
                  className="w-20"
                >
                  Back
                </Button>
              ) : (
                <div className="w-20" />
              )}
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
