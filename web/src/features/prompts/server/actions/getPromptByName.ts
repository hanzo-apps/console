import {
  InvalidRequestError,
  PRODUCTION_LABEL,
  type Prompt,
} from "@hanzo/console";
import {
  PromptService,
  redis,
  recordIncrement,
} from "@hanzo/console/src/server";
import { prisma } from "@hanzo/console/src/db";

type GetPromptByNameParams = {
  promptName: string;
  projectId: string;
  version?: number | null;
  label?: string;
  resolve?: boolean; // If false, returns raw prompt without resolving dependencies
};

export const getPromptByName = async (
  params: GetPromptByNameParams,
): Promise<Prompt | null> => {
  const { promptName, projectId, version, label, resolve = true } = params;

  if (version && label)
    throw new InvalidRequestError("Cannot specify both version and label");

  const promptService = new PromptService(prisma, redis, recordIncrement);

  if (version)
    return promptService.getPrompt({
      projectId,
      promptName,
      version,
      label: undefined,
      resolve,
    });

  if (label)
    return promptService.getPrompt({
      projectId,
      promptName,
      label,
      version: undefined,
      resolve,
    });

  return promptService.getPrompt({
    projectId,
    promptName,
    label: PRODUCTION_LABEL,
    version: undefined,
    resolve,
  });
};
