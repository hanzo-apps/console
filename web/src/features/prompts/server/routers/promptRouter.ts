import { z } from "zod";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { throwIfNoEntitlement } from "@/src/features/entitlements/server/hasEntitlement";
import {
  createTRPCRouter,
  protectedProjectProcedure,
} from "@/src/server/api/trpc";
import {
  type Prompt,
  Prisma,
  decodeJsonArrayColumn,
} from "@hanzo/console/src/db";
import { createPrompt, duplicatePrompt } from "../actions/createPrompt";
import { checkHasProtectedLabels } from "../utils/checkHasProtectedLabels";
import {
  CommentObjectType,
  CreatePromptTRPCSchema,
  LATEST_PROMPT_LABEL,
  optionalPaginationZod,
  paginationZod,
  PromptLabelSchema,
  promptsTableCols,
  PromptType,
  StringNoHTMLNonEmpty,
  TracingSearchType,
} from "@hanzo/console";
import { orderBy, singleFilter } from "@hanzo/console";
import {
  orderByToPrismaSql,
  PromptService,
  redis,
  logger,
  tableColumnsToSqlFilterAndPrefix,
  getObservationsWithPromptName,
  getObservationMetricsForPrompts,
  getAggregatedScoresForPrompts,
} from "@hanzo/console/src/server";
import { aggregateScores } from "@/src/features/scores/lib/aggregateScores";
import { TRPCError } from "@trpc/server";
import { promptChangeEventSourcing } from "@/src/features/prompts/server/promptChangeEventSourcing";

const buildPromptSearchFilter = (
  searchQuery: string | undefined | null,
  searchType?: TracingSearchType[],
): Prisma.Sql => {
  if (searchQuery === undefined || searchQuery === null || searchQuery === "") {
    return Prisma.empty;
  }

  const q = searchQuery;
  const types = searchType ?? ["id"];
  const searchConditions: Prisma.Sql[] = [];

  if (types.includes("id")) {
    // SQLite LIKE is ASCII case-insensitive (Postgres ILIKE replacement);
    // tags is a JSON-TEXT column, so iterate it with json_each.
    searchConditions.push(Prisma.sql`p.name LIKE ${`%${q}%`}`);
    searchConditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM json_each(p.tags) AS tag WHERE tag.value LIKE ${`%${q}%`})`,
    );
  }

  if (types.includes("content")) {
    searchConditions.push(Prisma.sql`p.prompt LIKE ${`%${q}%`}`);
  }

  return searchConditions.length > 0
    ? Prisma.sql` AND (${Prisma.join(searchConditions, " OR ")})`
    : Prisma.empty;
};
const PromptFilterOptions = z.object({
  projectId: z.string(), // Required for protectedProjectProcedure
  filter: z.array(singleFilter),
  orderBy: orderBy,
  ...paginationZod,
  pathPrefix: z.string().optional(),
  searchQuery: z.string().optional(),
  searchType: z.array(TracingSearchType).optional(),
});

const promptMetricsTimeWindow = {
  fromTimestamp: z.date().optional(),
  toTimestamp: z.date().optional(),
};

const isValidPromptMetricsTimeWindow = ({
  fromTimestamp,
  toTimestamp,
}: {
  fromTimestamp?: Date;
  toTimestamp?: Date;
}) => !fromTimestamp || !toTimestamp || fromTimestamp < toTimestamp;

export const promptRouter = createTRPCRouter({
  hasAny: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });

      const prompt = await ctx.prisma.prompt.findFirst({
        where: {
          projectId: input.projectId,
        },
        select: { id: true },
        take: 1,
      });

      return prompt !== null;
    }),
  all: protectedProjectProcedure
    .input(PromptFilterOptions)
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });

      const orderByCondition = orderByToPrismaSql(
        input.orderBy,
        promptsTableCols,
      );

      const filterCondition = tableColumnsToSqlFilterAndPrefix(
        input.filter ?? [],
        promptsTableCols,
        "prompts",
      );

      // pathFilter: SQL WHERE clause to filter prompts by folder (e.g., "AND p.name LIKE 'folder/%'")
      const pathFilter = input.pathPrefix
        ? (() => {
            const prefix = input.pathPrefix;
            // Escape backslashes and other LIKE special characters for pattern matching
            const escapedPrefix = prefix
              .replace(/\\/g, "\\\\")
              .replace(/%/g, "\\%")
              .replace(/_/g, "\\_");
            return Prisma.sql` AND (p.name LIKE ${`${escapedPrefix}/%`} OR p.name = ${escapedPrefix})`;
          })()
        : Prisma.empty;

      const searchFilter = buildPromptSearchFilter(
        input.searchQuery,
        input.searchType,
      );

      const [prompts, promptCount] = await Promise.all([
        // prompts
        ctx.prisma.$queryRaw<Array<Prompt & { row_type: "folder" | "prompt" }>>(
          generatePromptQuery(
            Prisma.sql`
          p.id,
          p.name,
          p.version,
          p.project_id as "projectId",
          p.prompt,
          p.type,
          p.updated_at as "updatedAt",
          p.created_at as "createdAt",
          p.labels,
          p.tags,
          p.row_type`,
            input.projectId,
            filterCondition,
            orderByCondition,
            input.limit,
            input.page,
            pathFilter, // SQL WHERE clause: filters DB to only prompts in current folder, derived from prefix.
            searchFilter,
            input.pathPrefix, // Raw folder path: used for segment splitting & folder detection logic
          ),
        ),
        // promptCount
        ctx.prisma.$queryRaw<Array<{ totalCount: bigint }>>(
          generatePromptQuery(
            Prisma.sql`count(*) AS "totalCount"`,
            input.projectId,
            filterCondition,
            Prisma.empty,
            1, // limit
            0, // input.page,
            pathFilter,
            searchFilter,
            input.pathPrefix,
          ),
        ),
      ]);

      return {
        // Raw SQL bypasses the JSON-array codec, so decode tags/labels.
        prompts: prompts.map((prompt) => ({
          ...prompt,
          tags: decodeJsonArrayColumn<string>(prompt.tags),
          labels: decodeJsonArrayColumn<string>(prompt.labels),
        })),
        totalCount:
          promptCount.length > 0 ? Number(promptCount[0]?.totalCount) : 0,
      };
    }),
  count: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        searchQuery: z.string().optional(),
        searchType: z.array(TracingSearchType).optional(),
        pathPrefix: z.string().optional(),
        filter: z.array(singleFilter).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });

      const filterCondition =
        input.filter && input.filter.length > 0
          ? tableColumnsToSqlFilterAndPrefix(
              input.filter,
              promptsTableCols,
              "prompts",
            )
          : Prisma.empty;

      const pathFilter = input.pathPrefix
        ? (() => {
            const prefix = input.pathPrefix;
            return Prisma.sql` AND (p.name LIKE ${`${prefix}/%`} OR p.name = ${prefix})`;
          })()
        : Prisma.empty;

      const searchFilter = buildPromptSearchFilter(
        input.searchQuery,
        input.searchType,
      );

      const count = await ctx.prisma.$queryRaw<Array<{ totalCount: bigint }>>(
        generatePromptQuery(
          Prisma.sql` count(*) AS "totalCount"`,
          input.projectId,
          filterCondition,
          Prisma.empty,
          1, // limit
          0, // page
          pathFilter,
          searchFilter,
          input.pathPrefix,
        ),
      );

      return {
        totalCount: count[0].totalCount,
      };
    }),
  metrics: protectedProjectProcedure
    .input(
      z
        .object({
          projectId: z.string(),
          promptNames: z.array(z.string()),
          ...promptMetricsTimeWindow,
        })
        .refine(isValidPromptMetricsTimeWindow, {
          message: "fromTimestamp must be before toTimestamp",
        }),
    )
    .query(async ({ input }) => {
      if (input.promptNames.length === 0) return [];
      const res = await getObservationsWithPromptName(
        input.projectId,
        input.promptNames,
      );
      return res.map(({ promptName, count }) => ({
        promptName,
        observationCount: count,
      }));
    }),
  byId: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });
      return ctx.prisma.prompt.findFirst({
        where: {
          id: input.id,
          projectId: input.projectId,
        },
      });
    }),
  create: protectedProjectProcedure
    .input(CreatePromptTRPCSchema)
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:CUD",
      });

      const { hasProtectedLabels, protectedLabels } =
        await checkHasProtectedLabels({
          prisma: ctx.prisma,
          projectId: input.projectId,
          labelsToCheck: input.labels,
        });

      if (hasProtectedLabels) {
        throwIfNoProjectAccess({
          session: ctx.session,
          projectId: input.projectId,
          scope: "promptProtectedLabels:CUD",
          forbiddenErrorMessage: `You don't have permission to create a prompt with a protected label. Please contact your project admin for assistance.\n\n Protected labels are: ${protectedLabels.join(", ")}`,
        });
      }

      const prompt = await createPrompt({
        ...input,
        prisma: ctx.prisma,
        createdBy: ctx.session.user.id,
      });

      if (!prompt) {
        throw new Error("Failed to create prompt");
      }

      await auditLog(
        {
          session: ctx.session,
          resourceType: "prompt",
          resourceId: prompt.id,
          action: "create",
          after: prompt,
        },
        ctx.prisma,
      );

      return prompt;
    }),
  duplicatePrompt: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        promptId: z.string(),
        name: StringNoHTMLNonEmpty,
        isSingleVersion: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:CUD",
      });

      const prompt = await duplicatePrompt({
        projectId: input.projectId,
        promptId: input.promptId,
        name: input.name,
        isSingleVersion: input.isSingleVersion,
        createdBy: ctx.session.user.id,
        prisma: ctx.prisma,
        user: {
          id: ctx.session.user.id,
          name: ctx.session.user.name ?? null,
          email: ctx.session.user.email ?? null,
        },
      });

      if (!prompt) {
        throw new Error(`Failed to duplicate prompt: ${input.promptId}`);
      }

      await auditLog(
        {
          session: ctx.session,
          resourceType: "prompt",
          resourceId: prompt.id,
          action: "create",
          after: prompt,
        },
        ctx.prisma,
      );

      return prompt;
    }),
  filterOptions: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      const [names, tags, labels] = await Promise.all([
        ctx.prisma.prompt.groupBy({
          where: {
            projectId: input.projectId,
          },
          by: ["name"],
          // limiting to 1k prompt names to avoid performance issues.
          // some users have unique names for large amounts of prompts
          // sending all prompt names to the FE exceeds the cloud function return size limit
          take: 1000,
          orderBy: {
            name: "asc",
          },
        }),
        // SQLite: tags/labels are JSON-TEXT columns; UNNEST -> json_each.
        ctx.prisma.$queryRaw<{ value: string }[]>`
          SELECT tags.value as value
          FROM prompts, json_each(prompts.tags) AS tags
          WHERE prompts.project_id = ${input.projectId}
          GROUP BY tags.value
          ORDER BY tags.value ASC;
        `,
        ctx.prisma.$queryRaw<{ value: string }[]>`
          SELECT labels.value as value
          FROM prompts, json_each(prompts.labels) AS labels
          WHERE prompts.project_id = ${input.projectId}
          GROUP BY labels.value
          ORDER BY labels.value ASC;
        `,
      ]);

      const res = {
        name: names
          .filter((n) => n.name !== null)
          .map((name) => ({
            value: name.name ?? "undefined",
          })),
        labels: labels,
        tags: tags,
      };
      return res;
    }),
  delete: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        promptName: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { projectId, promptName } = input;

        throwIfNoProjectAccess({
          session: ctx.session,
          projectId,
          scope: "prompts:CUD",
        });

        // fetch prompts before deletion to enable audit logging
        const prompts = await ctx.prisma.prompt.findMany({
          where: {
            projectId,
            name: input.promptName,
          },
        });

        const dependents = await ctx.prisma.$queryRaw<
          {
            parent_name: string;
            parent_version: number;
            child_version: number;
            child_label: string;
          }[]
        >`
          SELECT
            p."name" AS "parent_name",
            p."version" AS "parent_version",
            pd."child_version" AS "child_version",
            pd."child_label" AS "child_label"
          FROM
            prompt_dependencies pd
            INNER JOIN prompts p ON p.id = pd.parent_id
          WHERE
            p.project_id = ${projectId}
            AND pd.project_id = ${projectId}
            AND pd.child_name = ${input.promptName}
      `;

        if (dependents.length > 0) {
          const dependencyMessages = dependents
            .map(
              (d) =>
                `${d.parent_name} v${d.parent_version} depends on ${promptName} ${d.child_version ? `v${d.child_version}` : d.child_label}`,
            )
            .join("\n");

          throw new TRPCError({
            code: "CONFLICT",
            message: `Other prompts are depending on prompt versions you are trying to delete:\n\n${dependencyMessages}\n\nPlease delete the dependent prompts first.`,
          });
        }

        // Check if any prompt has a protected label
        const { hasProtectedLabels, protectedLabels } =
          await checkHasProtectedLabels({
            prisma: ctx.prisma,
            projectId: input.projectId,
            labelsToCheck: prompts.flatMap((prompt) => prompt.labels),
          });

        if (hasProtectedLabels) {
          throwIfNoProjectAccess({
            session: ctx.session,
            projectId: input.projectId,
            scope: "promptProtectedLabels:CUD",
            forbiddenErrorMessage: `You don't have permission to delete a prompt with a protected label. Please contact your project admin for assistance.\n\n Protected labels are: ${protectedLabels.join(", ")}`,
          });
        }

        for (const prompt of prompts) {
          await auditLog(
            {
              session: ctx.session,
              resourceType: "prompt",
              resourceId: prompt.id,
              action: "delete",
              before: prompt,
            },
            ctx.prisma,
          );
        }

        // Lock and invalidate cache for _all_ versions and labels of the prompt
        const promptService = new PromptService(ctx.prisma, redis);
        await promptService.lockCache({ projectId, promptName });
        await promptService.invalidateCache({ projectId, promptName });

        // Delete all prompts with the given name
        await ctx.prisma.prompt.deleteMany({
          where: {
            projectId,
            id: {
              in: prompts.map((p) => p.id),
            },
          },
        });

        // Unlock cache
        await promptService.unlockCache({ projectId, promptName });

        // Trigger webhooks for prompt deletion
        await Promise.all(
          prompts.map(async (prompt) =>
            promptChangeEventSourcing(
              await promptService.resolvePrompt(prompt),
              "deleted",
            ),
          ),
        );
      } catch (e) {
        logger.error(e);
        throw e;
      }
    }),
  deleteVersion: protectedProjectProcedure
    .input(
      z.object({
        promptVersionId: z.string(),
        projectId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { projectId } = input;

      try {
        throwIfNoProjectAccess({
          session: ctx.session,
          projectId,
          scope: "prompts:CUD",
        });

        const promptVersion = await ctx.prisma.prompt.findFirstOrThrow({
          where: {
            id: input.promptVersionId,
            projectId,
          },
        });
        const { name: promptName, version, labels } = promptVersion;

        // Check if prompt has a protected label
        const { hasProtectedLabels, protectedLabels } =
          await checkHasProtectedLabels({
            prisma: ctx.prisma,
            projectId: input.projectId,
            labelsToCheck: promptVersion.labels,
          });

        if (hasProtectedLabels) {
          throwIfNoProjectAccess({
            session: ctx.session,
            projectId: input.projectId,
            scope: "promptProtectedLabels:CUD",
            forbiddenErrorMessage: `You don't have permission to delete a prompt with a protected label. Please contact your project admin for assistance.\n\n Protected labels are: ${protectedLabels.join(", ")}`,
          });
        }

        if (labels.length > 0) {
          const dependents = await ctx.prisma.$queryRaw<
            {
              parent_name: string;
              parent_version: number;
              child_version: number;
              child_label: string;
            }[]
          >`
            SELECT
              p."name" AS "parent_name",
              p."version" AS "parent_version",
              pd."child_version" AS "child_version",
              pd."child_label" AS "child_label"
            FROM
              prompt_dependencies pd
              INNER JOIN prompts p ON p.id = pd.parent_id
            WHERE
              p.project_id = ${projectId}
              AND pd.project_id = ${projectId}
              AND pd.child_name = ${promptName}
              AND (
                (pd."child_version" IS NOT NULL AND pd."child_version" = ${version})
                OR
                (pd."child_label" IS NOT NULL AND pd."child_label" IN (${Prisma.join(labels)}))
              )
            `;

          if (dependents.length > 0) {
            const dependencyMessages = dependents
              .map(
                (d) =>
                  `${d.parent_name} v${d.parent_version} depends on ${promptName} ${d.child_version ? `v${d.child_version}` : d.child_label}`,
              )
              .join("\n");

            throw new TRPCError({
              code: "CONFLICT",
              message: `Other prompts are depending on the prompt version you are trying to delete:\n\n${dependencyMessages}\n\nPlease delete the dependent prompts first.`,
            });
          }
        }

        await auditLog(
          {
            session: ctx.session,
            resourceType: "prompt",
            resourceId: input.promptVersionId,
            action: "delete",
            before: promptVersion,
          },
          ctx.prisma,
        );

        const transaction = [
          ctx.prisma.prompt.delete({
            where: {
              id: input.promptVersionId,
              projectId,
            },
          }),
        ];

        // If the deleted prompt was the latest version, update the latest prompt
        if (promptVersion.labels.includes(LATEST_PROMPT_LABEL)) {
          const newLatestPrompt = await ctx.prisma.prompt.findFirst({
            where: {
              projectId,
              name: promptName,
              id: { not: input.promptVersionId },
            },
            orderBy: [{ version: "desc" }],
          });

          if (newLatestPrompt) {
            transaction.push(
              ctx.prisma.prompt.update({
                where: {
                  id: newLatestPrompt.id,
                  projectId: input.projectId,
                },
                data: {
                  labels: {
                    push: LATEST_PROMPT_LABEL,
                  },
                },
              }),
            );
          }
        }

        const promptService = new PromptService(ctx.prisma, redis);

        // Execute transaction
        await ctx.prisma.$transaction(transaction);
        // Rotate cache epoch only after successful commit.
        await promptService.invalidateCache({ projectId });

        // Trigger webhooks for prompt version deletion
        await promptChangeEventSourcing(
          await promptService.resolvePrompt(promptVersion),
          "deleted",
        );
      } catch (e) {
        logger.error(e);
        throw e;
      }
    }),
  setLabels: protectedProjectProcedure
    .input(
      z.object({
        promptId: z.string(),
        projectId: z.string(),
        labels: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { projectId } = input;

        throwIfNoProjectAccess({
          session: ctx.session,
          projectId,
          scope: "prompts:CUD",
        });

        const toBeLabeledPrompt = await ctx.prisma.prompt.findUnique({
          where: {
            id: input.promptId,
            projectId,
          },
        });

        if (!toBeLabeledPrompt) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Prompt not found.",
          });
        }

        const { name: promptName } = toBeLabeledPrompt;
        const newLabelSet = new Set(input.labels);
        const newLabels = [...newLabelSet];

        const removedLabels = [];
        for (const oldLabel of toBeLabeledPrompt.labels) {
          if (!newLabelSet.has(oldLabel)) {
            removedLabels.push(oldLabel);
          }
        }

        const addedLabels = [];
        for (const newLabel of newLabels) {
          if (!toBeLabeledPrompt.labels.includes(newLabel)) {
            addedLabels.push(newLabel);
          }
        }

        // Check if any label is protected (both new and to be removed)
        const { hasProtectedLabels, protectedLabels } =
          await checkHasProtectedLabels({
            prisma: ctx.prisma,
            projectId: input.projectId,
            labelsToCheck: [...addedLabels, ...removedLabels],
          });

        if (hasProtectedLabels) {
          throwIfNoProjectAccess({
            session: ctx.session,
            projectId: input.projectId,
            scope: "promptProtectedLabels:CUD",
            forbiddenErrorMessage: `You don't have permission to add/remove a protected label to/from a prompt. Please contact your project admin for assistance.\n\n Protected labels are: ${protectedLabels.join(", ")}`,
          });
        }

        if (removedLabels.length > 0) {
          const dependents = await ctx.prisma.$queryRaw<
            {
              parent_name: string;
              parent_version: number;
              child_version: number;
              child_label: string;
            }[]
          >`
            SELECT
              p."name" AS "parent_name",
              p."version" AS "parent_version",
              pd."child_version" AS "child_version",
              pd."child_label" AS "child_label"
            FROM
              prompt_dependencies pd
              INNER JOIN prompts p ON p.id = pd.parent_id
            WHERE
              p.project_id = ${projectId}
              AND pd.project_id = ${projectId}
              AND pd.child_name = ${promptName}
              AND pd."child_label" IS NOT NULL AND pd."child_label" IN (${Prisma.join(removedLabels)})
            `;

          if (dependents.length > 0) {
            const dependencyMessages = dependents
              .map(
                (d) =>
                  `${d.parent_name} v${d.parent_version} depends on ${promptName} ${d.child_version ? `v${d.child_version}` : d.child_label}`,
              )
              .join("\n");

            throw new TRPCError({
              code: "CONFLICT",
              message: `Other prompts are depending on the prompt label you are trying to remove:\n\n${dependencyMessages}\n\nPlease delete the dependent prompts first.`,
            });
          }
        }

        const touchedPromptIds = [toBeLabeledPrompt.id];

        await auditLog(
          {
            session: ctx.session,
            resourceType: "prompt",
            resourceId: toBeLabeledPrompt.id,
            action: "setLabel",
            after: {
              ...toBeLabeledPrompt,
              labels: newLabels,
            },
          },
          ctx.prisma,
        );

        // `labels` is a JSON-TEXT column on SQLite (the codec round-trips it as
        // a string[]); the `hasSome` scalar-list operator is unsupported on it,
        // so fetch the other versions of this prompt and intersect labels in JS.
        const previousLabeledPrompts = (
          await ctx.prisma.prompt.findMany({
            where: {
              projectId,
              name: promptName,
              id: { not: input.promptId },
            },
            orderBy: [{ version: "desc" }],
          })
        ).filter((p) => newLabels.some((label) => p.labels.includes(label)));

        touchedPromptIds.push(...previousLabeledPrompts.map((p) => p.id));

        const toBeExecuted = [
          ctx.prisma.prompt.update({
            where: {
              id: toBeLabeledPrompt.id,
              projectId,
            },
            data: {
              labels: newLabels,
            },
          }),
        ];

        // Remove label from previous labeled prompts
        previousLabeledPrompts.forEach((prevPrompt) => {
          toBeExecuted.push(
            ctx.prisma.prompt.update({
              where: {
                id: prevPrompt.id,
                projectId,
              },
              data: {
                labels: prevPrompt.labels.filter((l) => !newLabels.includes(l)),
              },
            }),
          );
        });

        const promptService = new PromptService(ctx.prisma, redis);

        // Execute transaction
        await ctx.prisma.$transaction(toBeExecuted);
        // Rotate cache epoch only after successful commit.
        await promptService.invalidateCache({ projectId });

        // Trigger webhooks for prompt label update
        const updatedPrompts = await ctx.prisma.prompt.findMany({
          where: {
            id: { in: touchedPromptIds },
            projectId,
          },
        });

        // Send webhooks for ALL affected prompts
        await Promise.all(
          updatedPrompts.map(async (prompt) =>
            promptChangeEventSourcing(
              await promptService.resolvePrompt(prompt),
              "updated",
            ),
          ),
        );
      } catch (e) {
        logger.error(`Failed to set prompt labels: ${e}`, e);
        throw e;
      }
    }),
  allLabels: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });

      // SQLite has no UNNEST; labels is a JSON-TEXT column that the codec
      // round-trips as a string[]. Flatten + dedupe across prompts in JS.
      const rows = await ctx.prisma.prompt.findMany({
        where: { projectId: input.projectId },
        select: { labels: true },
      });

      const labels = new Set<string>();
      for (const row of rows) {
        for (const label of row.labels) labels.add(label);
      }

      return Array.from(labels);
    }),
  allNames: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        type: z.enum(PromptType).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { session } = ctx;
      const { projectId, type } = input;

      throwIfNoProjectAccess({
        session,
        projectId,
        scope: "prompts:read",
      });

      return await ctx.prisma.prompt.findMany({
        where: {
          projectId,
          type,
        },
        select: {
          id: true,
          name: true,
        },
        distinct: ["name"],
      });
    }),

  getPromptLinkOptions: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });

      // SQLite has no array_agg / LATERAL unnest. labels is a JSON-TEXT column
      // the codec round-trips as string[]; group by prompt name in JS to
      // collect distinct versions and distinct (non-null) labels.
      const rows = await ctx.prisma.prompt.findMany({
        where: { projectId: input.projectId, type: "text" },
        select: { name: true, version: true, labels: true },
      });

      const byName = new Map<
        string,
        { name: string; versions: Set<number>; labels: Set<string> }
      >();
      for (const row of rows) {
        let entry = byName.get(row.name);
        if (!entry) {
          entry = { name: row.name, versions: new Set(), labels: new Set() };
          byName.set(row.name, entry);
        }
        entry.versions.add(row.version);
        for (const label of row.labels) {
          if (label != null) entry.labels.add(label);
        }
      }

      const result: { name: string; versions: number[]; labels: string[] }[] =
        Array.from(byName.values()).map((entry) => ({
          name: entry.name,
          versions: Array.from(entry.versions),
          labels: Array.from(entry.labels),
        }));

      return result;
    }),

  updateTags: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        tags: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { projectId, name: promptName } = input;

      throwIfNoProjectAccess({
        session: ctx.session,
        projectId,
        scope: "objects:tag",
      });

      try {
        await auditLog({
          session: ctx.session,
          resourceType: "prompt",
          resourceId: promptName,
          action: "updateTags",
          after: input.tags,
        });

        const promptService = new PromptService(ctx.prisma, redis);

        await ctx.prisma.prompt.updateMany({
          where: {
            name: promptName,
            projectId,
          },
          data: {
            tags: {
              set: input.tags,
            },
          },
        });

        // Rotate cache epoch only after successful commit.
        await promptService.invalidateCache({ projectId });

        // Trigger webhooks for prompt tag update

        const prompts = await ctx.prisma.prompt.findMany({
          where: { projectId, name: promptName },
        });

        await Promise.all(
          prompts.map(async (prompt) =>
            promptChangeEventSourcing(
              await promptService.resolvePrompt(prompt),
              "updated",
            ),
          ),
        );
      } catch (e) {
        logger.error(`Failed to update prompt tags: ${e}`, e);
        throw e;
      }
    }),
  allPromptMeta: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });

      return await ctx.prisma.prompt.findMany({
        select: {
          id: true,
          name: true,
          version: true,
          type: true,
          prompt: true,
          labels: true,
        },
        where: {
          projectId: input.projectId,
        },
        orderBy: [{ version: "desc" }],
      });
    }),
  allVersions: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        includeCommentCounts: z.boolean().optional(),
        ...optionalPaginationZod,
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "prompts:read",
      });
      if (input.includeCommentCounts) {
        throwIfNoProjectAccess({
          session: ctx.session,
          projectId: input.projectId,
          scope: "comments:read",
        });
      }

      const [prompts, totalCount] = await Promise.all([
        ctx.prisma.prompt.findMany({
          where: {
            projectId: input.projectId,
            name: input.name,
          },
          ...(input.limit !== undefined && input.page !== undefined
            ? { take: input.limit, skip: input.page * input.limit }
            : undefined),
          orderBy: [{ version: "desc" }],
        }),
        ctx.prisma.prompt.count({
          where: {
            projectId: input.projectId,
            name: input.name,
          },
        }),
      ]);

      let commentCounts = new Map<string, number>();
      if (input.includeCommentCounts) {
        const promptIds = prompts.map((p) => p.id);
        if (promptIds.length > 0) {
          const groupedCommentCounts = await ctx.prisma.comment.groupBy({
            by: ["objectId"],
            where: {
              projectId: input.projectId,
              objectType: CommentObjectType.PROMPT,
              objectId: { in: promptIds },
            },
            _count: {
              objectId: true,
            },
          });

          commentCounts = new Map(
            groupedCommentCounts.map(({ objectId, _count }) => [
              objectId,
              _count.objectId,
            ]),
          );
        }
      }

      const userIds = prompts
        .map((p) => p.createdBy)
        .filter((id) => id !== "API");
      const users = await ctx.prisma.user.findMany({
        select: {
          // never select passwords as they should never be returned to the FE
          id: true,
          name: true,
        },
        where: {
          id: {
            in: userIds,
          },
          organizationMemberships: {
            some: {
              orgId: ctx.session.orgId,
            },
          },
        },
      });

      const joinedPromptAndUsers = prompts.map((p) => {
        const user = users.find((u) => u.id === p.createdBy);
        if (!user && p.createdBy === "API") {
          return { ...p, creator: "API" };
        }
        return {
          ...p,
          creator: user?.name,
        };
      });
      return {
        promptVersions: joinedPromptAndUsers,
        totalCount,
        ...(input.includeCommentCounts ? { commentCounts } : {}),
      };
    }),
  versionMetrics: protectedProjectProcedure
    .input(
      z
        .object({
          projectId: z.string(),
          promptIds: z.array(z.string()),
          ...promptMetricsTimeWindow,
        })
        .refine(isValidPromptMetricsTimeWindow, {
          message: "fromTimestamp must be before toTimestamp",
        }),
    )
    .query(async ({ input, ctx }) => {
      const { projectId, promptIds, ...timeWindow } = input;

      throwIfNoProjectAccess({
        session: ctx.session,
        projectId,
        scope: "prompts:read",
      });

      const [observations, observationScores, traceScores] = await Promise.all([
        getObservationMetricsForPrompts(projectId, promptIds, timeWindow),
        getScoresForPromptIds(projectId, promptIds, "observation", timeWindow),
        getScoresForPromptIds(projectId, promptIds, "trace", timeWindow),
      ]);

      return observations.map((r) => {
        const promptObservationScores = observationScores.find(
          (score) => score.promptId === r.promptId,
        );
        const promptTraceScores = traceScores.find(
          (score) => score.promptId === r.promptId,
        );

        return {
          id: r.promptId,
          observationCount: BigInt(r.count),
          firstUsed: r.firstObservation,
          lastUsed: r.lastObservation,
          medianOutputTokens: r.medianOutputUsage,
          medianInputTokens: r.medianInputUsage,
          medianTotalCost: r.medianTotalCost,
          medianLatency: r.medianLatencyMs,
          observationScores: aggregateScores(
            promptObservationScores?.scores ?? [],
          ),
          traceScores: aggregateScores(promptTraceScores?.scores ?? []),
        };
      });
    }),
  resolvePromptGraph: protectedProjectProcedure
    .input(
      z.object({
        promptId: z.string(),
        projectId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        const { promptId, projectId } = input;

        throwIfNoProjectAccess({
          session: ctx.session,
          projectId,
          scope: "prompts:read",
        });

        const prompt = await ctx.prisma.prompt.findUnique({
          where: {
            id: promptId,
            projectId,
          },
        });

        if (!prompt) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Prompt not found",
          });
        }

        const promptService = new PromptService(ctx.prisma, redis);

        return promptService.buildAndResolvePromptGraph({
          projectId: input.projectId,
          parentPrompt: prompt,
        });
      } catch (e) {
        logger.error(e);
        throw e;
      }
    }),

  getProtectedLabels: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;

      throwIfNoProjectAccess({
        session: ctx.session,
        projectId,
        scope: "prompts:read",
      });

      throwIfNoEntitlement({
        projectId,
        entitlement: "prompt-protected-labels",
        sessionUser: ctx.session.user,
      });

      const protectedLabels = await ctx.prisma.promptProtectedLabels.findMany({
        where: {
          projectId,
        },
      });

      return protectedLabels.map((l) => l.label);
    }),

  addProtectedLabel: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), label: PromptLabelSchema }))
    .mutation(async ({ input, ctx }) => {
      const { projectId, label } = input;

      throwIfNoProjectAccess({
        session: ctx.session,
        projectId,
        scope: "promptProtectedLabels:CUD",
        forbiddenErrorMessage:
          "You don't have permission to mark a label as protected. Please contact your project admin for assistance.",
      });

      throwIfNoEntitlement({
        projectId,
        entitlement: "prompt-protected-labels",
        sessionUser: ctx.session.user,
      });

      if (label === LATEST_PROMPT_LABEL) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You cannot protect the label '${LATEST_PROMPT_LABEL}' as this would effectively block prompt creation.`,
        });
      }

      const protectedLabel = await ctx.prisma.promptProtectedLabels.upsert({
        where: {
          projectId_label: {
            projectId,
            label,
          },
        },
        create: {
          projectId,
          label,
        },
        update: {},
      });

      await auditLog(
        {
          session: ctx.session,
          resourceType: "promptProtectedLabel",
          resourceId: protectedLabel.id,
          action: "create",
          after: protectedLabel.label,
        },
        ctx.prisma,
      );

      return protectedLabel;
    }),

  removeProtectedLabel: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), label: PromptLabelSchema }))
    .mutation(async ({ input, ctx }) => {
      const { projectId, label } = input;

      throwIfNoProjectAccess({
        session: ctx.session,
        projectId,
        scope: "promptProtectedLabels:CUD",
        forbiddenErrorMessage:
          "You don't have permission to mark a label as unprotected. Please contact your project admin for assistance.",
      });

      throwIfNoEntitlement({
        projectId,
        entitlement: "prompt-protected-labels",
        sessionUser: ctx.session.user,
      });

      const protectedLabel = await ctx.prisma.promptProtectedLabels.delete({
        where: {
          projectId_label: {
            projectId,
            label,
          },
        },
      });

      await auditLog(
        {
          session: ctx.session,
          resourceType: "promptProtectedLabel",
          resourceId: protectedLabel.id,
          action: "delete",
          before: protectedLabel.label,
          after: null,
        },
        ctx.prisma,
      );

      return { success: true };
    }),
});

const getScoresForPromptIds = async (
  projectId: string,
  promptIds: string[],
  fetchScoreRelation: "observation" | "trace",
  timeWindow: {
    fromTimestamp?: Date;
    toTimestamp?: Date;
  } = {},
) => {
  const scores = await getAggregatedScoresForPrompts(
    projectId,
    promptIds,
    fetchScoreRelation,
  );

  return promptIds.map((promptId) => {
    const promptScores = scores.filter((score) => score.promptId === promptId);
    return {
      promptId,
      scores: promptScores,
    };
  });
};

/**
 * SQLite equivalent of Postgres `SPLIT_PART(<expr>, '/', 1)`: the first path
 * segment of <expr> (the whole string when there is no '/'). `<expr>` must be a
 * trusted SQL fragment (column/expression), never user input.
 */
const promptFirstPathSegment = (expr: string) =>
  `CASE WHEN INSTR(${expr}, '/') > 0 THEN SUBSTR(${expr}, 1, INSTR(${expr}, '/') - 1) ELSE ${expr} END`;

const generatePromptQuery = (
  select: Prisma.Sql,
  projectId: string,
  filterCondition: Prisma.Sql,
  orderCondition: Prisma.Sql,
  limit: number,
  page: number,
  pathFilter: Prisma.Sql = Prisma.empty,
  searchFilter: Prisma.Sql = Prisma.empty,
  pathPrefix?: string,
) => {
  const prefix = pathPrefix ?? "";

  // CTE to get latest versions (same for root and folder queries)
  const latestCTE = Prisma.sql`
    latest AS (
      SELECT p.*
      FROM prompts p
      WHERE (p.name, p.version) IN (
        SELECT name, MAX(version)
        FROM prompts p
        WHERE p.project_id = ${projectId}
          ${filterCondition}
          ${pathFilter}
          ${searchFilter}
        GROUP BY name
      )
        AND p.project_id = ${projectId}
        ${filterCondition}
        ${pathFilter}
        ${searchFilter}
    )`;

  // Common ORDER BY and LIMIT clauses
  const orderAndLimit = Prisma.sql`
    ${orderCondition.sql ? Prisma.sql`ORDER BY p.sort_priority, ${Prisma.raw(orderCondition.sql.replace(/ORDER BY /i, ""))}` : Prisma.empty}
    LIMIT ${limit} OFFSET ${page * limit}`;

  if (prefix) {
    // When we're inside a folder, show individual prompts within that folder
    // and folder representatives for subfolders

    // SQLite: CHAR_LENGTH -> LENGTH; the prefix-relative name keeps the bound
    // `prefix` param; the first-segment-after-prefix (Postgres SPLIT_PART)
    // uses the SQLite CASE/INSTR/SUBSTR idiom.
    const relativeName = Prisma.sql`SUBSTRING(p.name, LENGTH(${prefix}) + 2)`;
    const firstSegmentOfRelative = Prisma.sql`CASE WHEN INSTR(${relativeName}, '/') > 0 THEN SUBSTR(${relativeName}, 1, INSTR(${relativeName}, '/') - 1) ELSE ${relativeName} END`;

    return Prisma.sql`
    WITH ${latestCTE},
    individual_prompts_in_folder AS (
      /* Individual prompts exactly at this folder level (no deeper slashes) */
      SELECT
        p.id,
        ${relativeName} as name, -- Remove prefix, show relative name
        p.version,
        p.project_id,
        p.prompt,
        p.type,
        p.updated_at,
        p.created_at,
        p.labels,
        p.tags,
        p.config,
        p.created_by,
        2 as sort_priority, -- Individual prompts second
        'prompt' as row_type  -- Mark as individual prompt
      FROM latest p
      WHERE ${relativeName} NOT LIKE '%/%'
        AND ${relativeName} != ''  -- Exclude prompts that match prefix exactly
        AND p.name != ${prefix}  -- Additional safety check
    ),
    subfolder_representatives AS (
      /* Folder representatives for deeper nested prompts */
      SELECT
        p.id,
        ${firstSegmentOfRelative} as name, -- First segment after prefix
        p.version,
        p.project_id,
        p.prompt,
        p.type,
        p.updated_at,
        p.created_at,
        p.labels,
        p.tags,
        p.config,
        p.created_by,
        1 as sort_priority, -- Folders first
        'folder' as row_type, -- Mark as folder representative
        ROW_NUMBER() OVER (PARTITION BY ${firstSegmentOfRelative} ORDER BY p.version DESC) AS rn
      FROM latest p
      WHERE ${relativeName} LIKE '%/%'
    ),
    combined AS (
      SELECT
        id, name, version, project_id, prompt, type, updated_at, created_at, labels, tags, config, created_by, sort_priority, row_type
      FROM individual_prompts_in_folder
      UNION ALL
      SELECT
        id, name, version, project_id, prompt, type, updated_at, created_at, labels, tags, config, created_by, sort_priority, row_type
      FROM subfolder_representatives WHERE rn = 1
    )
    SELECT
      ${select}
    FROM combined p
    ${orderAndLimit};
    `;
  } else {
    const baseColumns = Prisma.sql`id, name, version, project_id, prompt, type, updated_at, created_at, labels, tags, config, created_by`;

    // When we're at the root level, show all individual prompts that don't have folders
    // and one representative per folder for prompts that do have folders
    return Prisma.sql`
    WITH ${latestCTE},
    individual_prompts AS (
      /* Individual prompts without folders */
      SELECT p.*, 'prompt' as row_type
      FROM latest p
      WHERE p.name NOT LIKE '%/%'
    ),
    folder_representatives AS (
      /* One representative per folder - return folder name, not full prompt name */
      SELECT
        p.id,
        ${Prisma.raw(promptFirstPathSegment("p.name"))} as name,  -- Return folder segment name instead of full name
        p.version,
        p.project_id,
        p.prompt,
        p.type,
        p.updated_at,
        p.created_at,
        p.labels,
        p.tags,
        p.config,
        p.created_by,
        'folder' as row_type, -- Mark as folder representative
        ROW_NUMBER() OVER (PARTITION BY ${Prisma.raw(promptFirstPathSegment("p.name"))} ORDER BY p.version DESC) AS rn
      FROM latest p
      WHERE p.name LIKE '%/%'
    ),
    combined AS (
      SELECT ${baseColumns}, row_type, 1 as sort_priority  -- Folders first
      FROM folder_representatives WHERE rn = 1
      UNION ALL
      SELECT ${baseColumns}, row_type, 2 as sort_priority  -- Individual prompts second
      FROM individual_prompts
    )
    SELECT
      ${select}
    FROM combined p
    ${orderAndLimit};
    `;
  }
};
