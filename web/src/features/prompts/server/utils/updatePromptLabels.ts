import { type PrismaClient } from "@hanzo/console/src/db";

export const removeLabelsFromPreviousPromptVersions = async ({
  prisma,
  projectId,
  promptName,
  labelsToRemove,
}: {
  prisma: Omit<
    PrismaClient,
    "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
  >;
  projectId: string;
  promptName: string;
  labelsToRemove: string[];
}) => {
  // `labels` is a JSON-TEXT column on SQLite (the codec round-trips it as a
  // string[]); Prisma scalar-list operators like `hasSome` are not supported on
  // it, so we fetch this prompt's versions by name and intersect labels in JS.
  // See packages/shared/src/db-json-arrays.ts.
  const previouslyLabeledPrompts = (
    await prisma.prompt.findMany({
      where: {
        projectId,
        name: promptName,
      },
      orderBy: [{ version: "desc" }],
    })
  ).filter((prompt) =>
    labelsToRemove.some((label) => prompt.labels.includes(label)),
  );

  const touchedPromptIds = previouslyLabeledPrompts.map(
    (prevPrompt) => prevPrompt.id,
  );

  return {
    touchedPromptIds,
    updates: previouslyLabeledPrompts.map((prevPrompt) =>
      prisma.prompt.update({
        where: { id: prevPrompt.id },
        data: {
          labels: prevPrompt.labels.filter(
            (prevLabel) => !labelsToRemove.includes(prevLabel),
          ),
        },
      }),
    ),
  };
};
