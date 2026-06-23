import { useForm } from "react-hook-form";
import { useCallback } from "react";
import type { SurveyFormData } from "../lib/surveyTypes";
import { api } from "@/src/utils/api";
import { SurveyName } from "@hanzo/console";
import { useSession } from "@/src/features/auth/session";
import { showErrorToast } from "@/src/features/notifications/showErrorToast";
import { showSuccessToast } from "@/src/features/notifications/showSuccessToast";

export function useSurveyForm() {
  const { data: session } = useSession();
  const createSurveyMutation = api.surveys.create.useMutation({
    onSuccess: () => {
      showSuccessToast({
        title: "Survey submitted",
        description: "Thank you for your feedback!",
      });
    },
    onError: (error) => {
      showErrorToast(
        "Failed to submit survey",
        error.message || "Please try again later.",
      );
    },
  });

  const form = useForm<SurveyFormData>({
    defaultValues: {
      referralSource: undefined,
    },
  });

  const handleSubmit = useCallback(
    async (data: SurveyFormData) => {
      const transformedResponse: Record<string, string> = {};
      if (data.referralSource)
        transformedResponse["referralSource"] = data.referralSource.trim();

      try {
        await createSurveyMutation.mutateAsync({
          surveyName: SurveyName.USER_ONBOARDING,
          response: transformedResponse,
          // Use the first org only when the user has exactly one org
          // (typical during onboarding). For multi-org users the orgId
          // is omitted; the server validates membership regardless.
          orgId:
            session?.user?.organizations?.length === 1
              ? session.user.organizations[0]?.id
              : undefined,
        });
      } catch {
        // Error handling is done in the mutation callbacks
        // This catch block is for any additional error handling if needed
      }
    },
    [createSurveyMutation, session],
  );

  return {
    form,
    handleSubmit,
  };
}
