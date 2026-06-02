import { z } from "zod/v4";
import { createTRPCRouter, protectedProjectProcedure } from "@/src/server/api/trpc";
import { throwIfNoProjectAccess } from "@/src/features/rbac/utils/checkProjectAccess";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import {
  DEFAULT_TRACE_JOB_DELAY,
  deriveEvaluatorDisplayStateFromExecutionCounts,
  type OrderByState,
  singleFilter,
  variableMapping,
  paginationZod,
  type JobConfiguration,
  JobType,
  Prisma,
  JobTimeScopeZod,
  TimeScopeSchema,
  JobConfigState,
  EvaluatorBlockReason,
  orderBy,
  jsonSchema,
} from "@hanzo/shared";
import {
  getQueue,
  getCostByEvaluatorIds,
  getEvaluatorExecutionStatusCountsByEvaluatorId,
  getScoresByIds,
  logger,
  QueueName,
  QueueJobs,
  tableColumnsToSqlFilterAndPrefix,
  orderByToPrismaSql,
  DefaultEvalModelService,
  testModelCall,
  clearNoJobConfigsCache,
} from "@hanzo/shared/src/server";
import { TRPCError } from "@trpc/server";
import { EvalReferencedEvaluators } from "@/src/features/evals/types";
import { EvaluatorStatus } from "../types";
import { traceException } from "@hanzo/shared/src/server";
import { isNotNullOrUndefined } from "@/src/utils/types";
import { v4 as uuidv4 } from "uuid";
import { env } from "@/src/env.mjs";
import { type JobExecution, type PrismaClient } from "@prisma/client";
import { type JobExecutionState } from "@/src/features/evals/utils/job-execution-utils";
import { evalConfigFilterColumns, evalConfigsTableCols } from "@/src/server/api/definitions/evalConfigsTable";
import { evalExecutionsFilterCols } from "@/src/server/api/definitions/evalExecutionsTable";
import {
  resetEvalConfigBlockFields,
  selectDatasetEvaluatorsForStatusChange,
  shouldValidateBeforeActivation,
} from "@/src/features/evals/server/evalConfigState";
import {
  EVAL_TEMPLATE_AUDIT_LOG_RESOURCE_TYPE,
  JOB_CONFIGURATION_AUDIT_LOG_RESOURCE_TYPE,
} from "@/src/features/evals/server/audit-log-resource-types";
import { getEvaluatorDefinitionPreflightError } from "@/src/features/evals/server/evaluator-preflight";
import {
  runCodeEvalTest,
  runCodeEvalTestForJobConfig,
} from "@/src/features/evals/server/codeEvalTestRun";
import {
  CODE_EVAL_TEMPLATE_VARIABLES,
  CreateEvalTemplateInputSchema,
  validateEvalTemplateCreation,
} from "@/src/features/evals/server/evalTemplateCreation";
import {
  getCodeEvalCapabilities,
  isCodeEvalEnabled,
  isCodeEvalSourceCodeLanguageSupported,
} from "@/src/features/evals/server/isCodeEvalEnabled";
export { CreateEvalTemplateInputSchema } from "@/src/features/evals/server/evalTemplateCreation";

// Filter columns that used to be backed by the Postgres `traces` and
// `scores` JOINs.  Those tables now live in ClickHouse, so the eval logs
// query can no longer resolve them.  Filters referencing these columns are
// dropped server-side to keep bookmarked URLs from failing.
const DEPRECATED_FILTER_COLUMNS = new Set(["scoreValue", "sessionId"]);

const ConfigWithTemplateSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  evalTemplateId: z.string(),
  scoreName: z.string(),
  targetObject: EvalTargetObjectSchema,
  filter: z.array(singleFilter).nullable(), // reusing the filter type from the tables
  variableMapping: z.array(variableMapping),
  sampling: z.instanceof(Prisma.Decimal),
  delay: z.number(),
  status: z.enum(JobConfigState),
  blockedAt: z.date().nullable(),
  blockReason: z.enum(EvaluatorBlockReason).nullable(),
  blockMessage: z.string().nullable(),
  jobType: z.enum(JobType),
  createdAt: z.date(),
  updatedAt: z.date(),
  timeScope: TimeScopeSchema,
  evalTemplate: z
    .object({
      name: z.string(),
      partner: z.string().nullable(),
      id: z.string(),
      createdAt: z.coerce.date(),
      updatedAt: z.coerce.date(),
      projectId: z.string().nullable(),
      prompt: z.string().nullable(),
      provider: z.string().nullable(),
      model: z.string().nullable(),
      modelParams: jsonSchema.nullable(),
      vars: z.array(z.string()),
      outputDefinition: jsonSchema.nullable(),
      version: z.number(),
      type: z.enum(EvalTemplateType),
    })
    .nullish(),
});

type EvalJobConfigWithTemplate = z.infer<typeof ConfigWithTemplateSchema>;

/**
 * Use this function when pulling a list of evaluators from the database before using in the application to ensure type safety.
 * All evaluators are expected to pass the validation. If an evaluator fails validation, it will be logged to Otel.
 * @param evaluators
 * @returns list of validated evaluators
 */
const filterAndValidateDbEvaluatorList = (
  evaluators: JobConfiguration[],
  onParseError?: (error: z.ZodError) => void,
): EvalJobConfigWithTemplate[] =>
  evaluators.reduce((acc, ts) => {
    const result = ConfigWithTemplateSchema.safeParse(ts);
    if (result.success) {
      acc.push(result.data);
    } else {
      console.error("Evaluator parsing error: ", result.error);
      onParseError?.(result.error);
    }
    return acc;
  }, [] as ConfigWithTemplate[]);

export const CreateEvalTemplate = z.object({
  name: z.string().min(1),
  projectId: z.string(),
  prompt: z.string(),
  provider: z.string().nullish(),
  model: z.string().nullish(),
  modelParams: ZodModelConfig.nullish(),
  vars: z.array(z.string()),
  outputSchema: z.object({
    score: z.string(),
    reasoning: z.string(),
  }),
  cloneSourceId: z.string().optional(),
  referencedEvaluators: z.enum(EvalReferencedEvaluators).optional().default(EvalReferencedEvaluators.PERSIST),
});

const CreateEvalJobSchema = z.object({
  projectId: z.string(),
  evalTemplateId: z.string(),
  scoreName: z.string().min(1),
  target: EvalTargetObjectSchema,
  filter: z.array(singleFilter).nullable(), // reusing the filter type from the tables
  mapping: z.array(variableMapping),
  sampling: z.number().gt(0).lte(1),
  delay: z.number().gte(0).default(DEFAULT_TRACE_JOB_DELAY), // 10 seconds default
  timeScope: TimeScopeSchema,
});

const CodeEvalTestRunSchema = z.object({
  projectId: z.string(),
  evalTemplateId: z.string(),
  target: z.union([
    z.literal(EvalTargetObject.EVENT),
    z.literal(EvalTargetObject.EXPERIMENT),
  ]),
  mapping: z.array(observationVariableMapping),
  scoreName: z.string().min(1),
  observationId: z.string(),
  traceId: z.string(),
  startTime: z.coerce.date(),
  shouldReadFromObservationsTable: z.boolean().optional().default(false),
});

const getSupportedCodeEvalTemplateLanguages =
  (): EvalTemplateSourceCodeLanguage[] => {
    const capabilities = getCodeEvalCapabilities();

    return capabilities.enabled
      ? capabilities.supportedSourceCodeLanguages
      : [];
  };

const getCodeEvalTemplateWhere = (): Prisma.EvalTemplateWhereInput => {
  const supportedLanguages = getSupportedCodeEvalTemplateLanguages();

  if (supportedLanguages.length === 0) {
    return { type: { not: EvalTemplateType.CODE } };
  }

  return {
    AND: [
      {
        OR: [
          { type: { not: EvalTemplateType.CODE } },
          {
            sourceCodeLanguage: {
              in: supportedLanguages,
            },
          },
        ],
      },
    ],
  };
};

const assertCodeEvalEnabled = () => {
  if (!isCodeEvalEnabled()) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Code evals are not enabled",
    });
  }
};

const getCodeEvalTemplateRawSqlCondition = () => {
  const supportedLanguages = getSupportedCodeEvalTemplateLanguages();

  if (supportedLanguages.length === 0) {
    return Prisma.sql`AND type != ${EvalTemplateType.CODE}::"EvalTemplateType"`;
  }

  const supportedLanguageSql = Prisma.join(
    supportedLanguages.map(
      (language) => Prisma.sql`${language}::"EvalTemplateSourceCodeLanguage"`,
    ),
  );

  return Prisma.sql`AND (type != ${EvalTemplateType.CODE}::"EvalTemplateType" OR source_code_language IN (${supportedLanguageSql}))`;
};

const assertCodeEvalTemplateCanRun = (params: {
  sourceCodeLanguage: EvalTemplateSourceCodeLanguage | null;
}) => {
  assertCodeEvalEnabled();

  if (!isCodeEvalSourceCodeLanguageSupported(params.sourceCodeLanguage)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This code evaluator language is not supported by the configured dispatcher.",
    });
  }
};

const UpdateEvalJobSchema = z.object({
  scoreName: z.string().min(1).optional(),
  filter: z.array(singleFilter).optional(),
  variableMapping: z.array(variableMapping).optional(),
  sampling: z.number().gt(0).lte(1).optional(),
  delay: z.number().gte(0).optional(),
  status: z.enum(EvaluatorStatus).optional(),
  timeScope: z.array(JobTimeScopeZod).optional(),
});

const validateVariableMappingForTarget = ({
  targetObject,
  mapping,
}: {
  targetObject: string;
  mapping: unknown;
}) => {
  const result =
    targetObject === EvalTargetObject.EVENT ||
    targetObject === EvalTargetObject.EXPERIMENT
      ? z.array(observationVariableMapping).safeParse(mapping)
      : targetObject === EvalTargetObject.TRACE ||
          targetObject === EvalTargetObject.DATASET
        ? z.array(variableMapping).safeParse(mapping)
        : null;

  if (!result?.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Variable mapping does not match evaluator target.",
    });
  }

  return result.data;
};

const validateEvalTemplateCanRun = async ({
  prisma,
  projectId,
  evalTemplateId,
}: {
  prisma: PrismaClient;
  projectId: string;
  evalTemplateId: string;
}) => {
  const template = await prisma.evalTemplate.findFirst({
    where: {
      id: evalTemplateId,
      OR: [{ projectId }, { projectId: null }],
    },
  });

export const calculateEvaluatorFinalStatus = (
  status: string,
  timeScope: string[],
  jobExecutionsByState: JobExecutionState[],
): string => {
  // If timeScope is only "EXISTING" and there are no pending jobs and there are some jobs,
  // then the status is "FINISHED", otherwise it's the original status
  const hasPendingJobs = jobExecutionsByState.some((je) => je.status === "PENDING");
  const totalJobCount = jobExecutionsByState.reduce((acc, je) => acc + je._count, 0);

  if (timeScope.length === 1 && timeScope[0] === "EXISTING" && !hasPendingJobs && totalJobCount > 0) {
    return "FINISHED";
  }

  const error = await getEvaluatorDefinitionPreflightError({
    projectId,
    template: {
      name: template.name,
      type: template.type,
      provider: template.provider,
      model: template.model,
      modelParams: template.modelParams,
      outputDefinition: template.outputDefinition,
    },
  });

  if (error) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error,
    });
  }
};

const assertCodeEvalJobConfigTestSucceeds = async ({
  prisma,
  orgId,
  projectId,
  evalTemplateId,
  target,
  mapping,
  scoreName,
  filter,
}: {
  prisma: PrismaClient;
  orgId: string;
  projectId: string;
  evalTemplateId: string;
  target: EvalTargetObject;
  mapping: unknown;
  scoreName: string;
  filter: z.infer<typeof singleFilter>[] | null;
}) => {
  if (
    target !== EvalTargetObject.EVENT &&
    target !== EvalTargetObject.EXPERIMENT
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Code evaluators can only run on observations or experiments.",
    });
  }

  const parsedMapping = z.array(observationVariableMapping).parse(mapping);

  if (env.LANGFUSE_ENABLE_EVENTS_TABLE_UI === "true") {
    const result = await runCodeEvalTestForJobConfig({
      prisma,
      orgId,
      projectId,
      evalTemplateId,
      target,
      mapping: parsedMapping,
      scoreName,
      filter,
    });

    if (!result) {
      if (target !== EvalTargetObject.EXPERIMENT) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No matching observation found to test this code evaluator. Adjust the filters and try again.",
        });
      }

      return;
    }

    if (!result.success) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: result.error.message,
      });
    }
  } else if (target === EvalTargetObject.EXPERIMENT) {
    return;
  } else {
    // TODO: add self-hosting path for target events
    return;
  }
};

export const evalRouter = createTRPCRouter({
  codeEvalCapabilities: authenticatedProcedure.query(() =>
    getCodeEvalCapabilities(),
  ),

  globalJobConfigs: protectedProjectProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "evalJob:read",
      });
      return env.HANZO_MAX_HISTORIC_EVAL_CREATION_LIMIT;
    }),
  counts: protectedProjectProcedure.input(z.object({ projectId: z.string() })).query(async ({ input, ctx }) => {
    throwIfNoProjectAccess({
      session: ctx.session,
      projectId: input.projectId,
      scope: "evalJob:read",
    });

    const [configCount, configActiveCount, templateCount] = await Promise.all([
      ctx.prisma.jobConfiguration.count({
        where: {
          projectId: input.projectId,
          jobType: "EVAL",
        },
      }),
      ctx.prisma.jobConfiguration.count({
        where: {
          projectId: input.projectId,
          jobType: "EVAL",
          status: "ACTIVE",
        },
      }),
      ctx.prisma.evalTemplate.count({
        where: {
          projectId: input.projectId,
        },
      }),
    ]);

    return {
      configCount,
      configActiveCount,
      templateCount,
    };
  }),
  allConfigs: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(), // Required for protectedProjectProcedure
        filter: z.array(singleFilter),
        orderBy: orderBy,
        searchQuery: z.string().nullish(),
        ...paginationZod,
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "evalJob:read",
      });

      const filterCondition = tableColumnsToSqlFilterAndPrefix(
        input.filter,
        evalConfigFilterColumns,
        "job_configurations",
      );

      const orderByCondition = orderByToPrismaSql(input.orderBy, evalConfigsTableCols);

      const searchCondition =
        input.searchQuery && input.searchQuery.trim() !== ""
          ? Prisma.sql`AND jc.score_name ILIKE ${`%${input.searchQuery}%`}`
          : Prisma.empty;

      const [configs, configsCount] = await Promise.all([
        // job configs with their templates
        ctx.prisma.$queryRaw<
          Array<
            Omit<JobConfiguration, "projectId" | "jobType" | "variableMapping" | "sampling" | "delay"> & {
              templateName: string;
              templateVersion: number;
              templateProjectId: string;
            }
          >
        >(
          generateConfigsQuery(
            Prisma.sql`
            jc.id,
            jc.status,
            jc.blocked_at as "blockedAt",
            jc.block_reason as "blockReason",
            jc.block_message as "blockMessage",
            jc.created_at as "createdAt",
            jc.updated_at as "updatedAt",
            jc.score_name as "scoreName",
            jc.target_object as "targetObject",
            jc.filter as "filter",
            jc.time_scope as "timeScope",
            et.id as "evalTemplateId",
            et.name as "templateName",
            et.version as "templateVersion",
            et.project_id as "templateProjectId"`,
            input.projectId,
            filterCondition,
            searchCondition,
            orderByCondition,
            input.limit,
            input.page,
          ),
        ),
        // count
        ctx.prisma.$queryRaw<Array<{ totalCount: bigint }>>(
          generateConfigsQuery(
            Prisma.sql`count(*) AS "totalCount"`,
            input.projectId,
            filterCondition,
            searchCondition,
            Prisma.empty,
            1, // limit
            0, // page
          ),
        ),
      ]);

      return {
        configs: configs.map((config) => ({
          ...config,
          evalTemplate: config.evalTemplateId
            ? {
                id: config.evalTemplateId,
                name: config.templateName,
                version: config.templateVersion,
                projectId: config.templateProjectId,
              }
            : null,
          jobExecutionsByState: jobExecutionsByState.filter((je) => je.jobConfigurationId === config.id),
          finalStatus: calculateEvaluatorFinalStatus(
            config.status,
            Array.isArray(config.timeScope) ? config.timeScope : [],
            jobExecutionsByState.filter((je) => je.jobConfigurationId === config.id),
          ),
        })),
        totalCount: configsCount.length > 0 ? Number(configsCount[0]?.totalCount) : 0,
      };
    }),

  configById: protectedProjectProcedure
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
        scope: "evalJob:read",
      });

      const config = await ctx.prisma.jobConfiguration.findUnique({
        where: {
          id: input.id,
          projectId: input.projectId,
        },
        include: {
          evalTemplate: true,
        },
      });

      if (!config) return null;

      const displayStatus = deriveEvaluatorDisplayStateFromExecutionCounts({
        status: config.status,
        blockedAt: config.blockedAt,
        timeScope: Array.isArray(config.timeScope) ? config.timeScope : [],
      });

      return {
        ...config,
        displayStatus,
      };
    }),

  allTemplatesForName: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string(),
        isUserManaged: z.boolean().default(true),
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "evalTemplate:read",
      });

      const templates = await ctx.prisma.evalTemplate.findMany({
        where: {
          name: input.name,
          ...(input.isUserManaged ? { projectId: input.projectId } : { projectId: null }),
        },
        orderBy: [{ version: "desc" }],
      });

      return {
        templates: templates,
      };
    }),

  templateNames: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        page: z.number(),
        limit: z.number(),
        searchQuery: z.string().nullish(),
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "evalTemplate:read",
      });

      const searchCondition =
        input.searchQuery && input.searchQuery.trim() !== ""
          ? Prisma.sql`AND name ILIKE ${`%${input.searchQuery}%`}`
          : Prisma.empty;
      const typeCondition = getCodeEvalTemplateRawSqlCondition();

      const [templates, count] = await Promise.all([
        ctx.prisma.$queryRaw<
          Array<{
            latestId: string;
            name: string;
            projectId: string;
            version: number;
            latestCreatedAt: Date;
            usageCount: number;
            partner?: string;
            provider?: string;
            model?: string;
            type: EvalTemplateType;
            sourceCodeLanguage: EvalTemplateSourceCodeLanguage | null;
            outputDefinition: unknown;
          }>
        >`
        WITH latest_templates AS (
          SELECT 
            et.id,
            et.name,
            et.project_id,
            et.provider,
            et.model,
            et.type,
            et.source_code_language,
            et.partner,
            et.version,
            et.created_at,
            et.output_schema,
            (
              SELECT COUNT(jc.id)
              FROM job_configurations jc
              WHERE jc.eval_template_id IN (
                SELECT id 
                FROM eval_templates 
                WHERE name = et.name AND 
                      type = et.type AND
                      (project_id = et.project_id OR (project_id IS NULL AND et.project_id IS NULL))
              )
              AND jc.project_id = ${input.projectId}
            ) as usage_count
          FROM (
            SELECT DISTINCT ON (project_id, name, type) *
            FROM eval_templates
            WHERE (project_id = ${input.projectId} OR project_id IS NULL)
            ${searchCondition}
            ${typeCondition}
            ORDER BY project_id, name, type, version DESC
          ) et
        )
        SELECT 
          id as "latestId",
          name,
          provider,
          model,
          type,
          source_code_language as "sourceCodeLanguage",
          partner,
          project_id as "projectId",
          version,
          created_at as "latestCreatedAt",
          output_schema as "outputDefinition",
          COALESCE(usage_count, 0)::int as "usageCount"
        FROM 
          latest_templates
        ORDER BY project_id, partner, name, type
        LIMIT ${input.limit}
        OFFSET ${input.page * input.limit}
        `,
        ctx.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) as count
          FROM (
            SELECT DISTINCT project_id, name, type
            FROM eval_templates
            WHERE (project_id = ${input.projectId} OR project_id IS NULL)
            ${searchCondition}
            ${typeCondition}
          ) t
        `,
      ]);

      return {
        templates,
        totalCount: Number(count[0]?.count) || 0,
      };
    }),

  templateById: protectedProjectProcedure
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
        scope: "evalTemplate:read",
      });

      const template = await ctx.prisma.evalTemplate.findFirst({
        where: {
          id: input.id,
          OR: [{ projectId: input.projectId }, { projectId: null }],
          ...getCodeEvalTemplateWhere(),
        },
      });

      return template;
    }),
  allTemplates: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string().optional(),
        limit: z.number().optional(),
        page: z.number().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "evalTemplate:read",
      });

      const templates = await ctx.prisma.evalTemplate.findMany({
        where: {
          OR: [{ projectId: input.projectId }, { projectId: null }],
          ...(input.id ? { id: input.id } : undefined),
          ...getCodeEvalTemplateWhere(),
        },
        ...(input.limit && input.page ? { take: input.limit, skip: input.page * input.limit } : undefined),
      });

      const count = await ctx.prisma.evalTemplate.count({
        where: {
          OR: [{ projectId: input.projectId }, { projectId: null }],
          ...(input.id ? { id: input.id } : undefined),
          ...getCodeEvalTemplateWhere(),
        },
      });
      return {
        templates: templates,
        totalCount: count,
      };
    }),

  // to be deprecated, only kept for cases of client side caching of routes
  evaluatorsByTemplateName: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), evalTemplateName: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "evalJob:read",
      });

      const templates = await ctx.prisma.evalTemplate.findMany({
        where: {
          projectId: input.projectId,
          name: input.evalTemplateName,
        },
        select: {
          id: true,
        },
      });

      return {
        evaluators: await ctx.prisma.jobConfiguration.findMany({
          where: {
            projectId: input.projectId,
            evalTemplateId: { in: templates.map((t) => t.id) },
          },
        }),
      };
    }),

  jobConfigsByTarget: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), targetObject: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "evalJob:read",
      });

      const evaluators = await ctx.prisma.jobConfiguration.findMany({
        where: {
          projectId: input.projectId,
          targetObject: input.targetObject,
        },
        include: {
          evalTemplate: true,
        },
      });

      return filterAndValidateDbEvaluatorList(evaluators, traceException);
    }),

  jobConfigsByTemplateName: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), evalTemplateName: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "evalJob:read",
      });

      const templates = await ctx.prisma.evalTemplate.findMany({
        where: {
          projectId: input.projectId,
          name: input.evalTemplateName,
        },
        select: {
          id: true,
        },
      });

      return {
        evaluators: await ctx.prisma.jobConfiguration.findMany({
          where: {
            projectId: input.projectId,
            evalTemplateId: { in: templates.map((t) => t.id) },
          },
        }),
      };
    }),

  createJob: protectedProjectProcedure.input(CreateEvalJobSchema).mutation(async ({ input, ctx }) => {
    throwIfNoProjectAccess({
      session: ctx.session,
      projectId: input.projectId,
      scope: "evalJob:CUD",
    });

    const evalTemplate = await ctx.prisma.evalTemplate.findUnique({
      where: {
        id: input.evalTemplateId,
        OR: [{ projectId: input.projectId }, { projectId: null }],
      },
    });

    if (!evalTemplate) {
      logger.warn(`Template not found for project ${input.projectId} and id ${input.evalTemplateId}`);
      throw new Error("Template not found");
    }

    const jobId = uuidv4();
    await auditLog({
      session: ctx.session,
      resourceType: "job",
      resourceId: jobId,
      action: "create",
    });

    const job = await ctx.prisma.jobConfiguration.create({
      data: {
        id: jobId,
        projectId: input.projectId,
        jobType: "EVAL",
        evalTemplateId: input.evalTemplateId,
        scoreName: input.scoreName,
        targetObject: input.target,
        filter: input.filter ?? [],
        variableMapping: input.mapping,
        sampling: input.sampling,
        delay: input.delay,
        status: "ACTIVE",
        timeScope: input.timeScope,
      },
    });

    // Clear the "no job configs" cache since we just created a new job configuration
    await clearNoJobConfigsCache(input.projectId);

    if (input.timeScope.includes("EXISTING")) {
      logger.info(`Applying to historical traces for job ${job.id} and project ${input.projectId}`);
      const batchJobQueue = getQueue(QueueName.BatchActionQueue);
      if (!batchJobQueue) {
        throw new Error("Batch job queue not found");
      }
      await batchJobQueue.add(
        QueueJobs.BatchActionProcessingJob,
        {
          name: QueueJobs.BatchActionProcessingJob,
          timestamp: new Date(),
          id: uuidv4(),
          payload: {
            projectId: input.projectId,
            actionId: "eval-create",
            configId: job.id,
            cutoffCreatedAt: new Date(),
            targetObject: input.target,
            query: {
              filter: input.filter ?? [],
              orderBy: {
                column: "timestamp",
                order: "DESC",
              },
            },
          },
        },
        { delay: input.delay },
      );
    }
  }),
  createTemplate: protectedProjectProcedure.input(CreateEvalTemplate).mutation(async ({ input, ctx }) => {
    throwIfNoProjectAccess({
      session: ctx.session,
      projectId: input.projectId,
      scope: "evalTemplate:CUD",
    });

    const modelConfig = await DefaultEvalModelService.fetchValidModelConfig(
      input.projectId,
      input.provider ?? undefined,
      input.model ?? undefined,
      input.modelParams,
    );

    if (!modelConfig.valid) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No valid llm model found for this project",
      });
    }

    try {
      // Make a test structured output call to validate the LLM key
      await testModelCall({
        provider: modelConfig.config.provider,
        model: modelConfig.config.model,
        apiKey: modelConfig.config.apiKey,
        modelConfig: input.modelParams,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Model configuration not valid for evaluation. ${message}`,
      });
    }

    /**
     * CREATION OF PROJECT-LEVEL TEMPLATE
     *
     * Option 1: Create a new project-level template
     * - Find existing project-level templates, templates are unique by [name, projectId]
     * - If a template already exists, we will create a new version of the template
     * - Otherwise, we will create a new template with version 1
     *
     * Option 2: Clone a hanzo managed template
     * - Find the hanzo managed template
     * - Clone the hanzo managed template by creating a new project-level template from the cloned hanzo managed template
     */

    // find all versions of the project-level template, should return null if input.cloneSourceId is provided
    return ctx.prisma.$transaction(async (tx) => {
      const templates = await tx.evalTemplate.findMany({
        where: {
          projectId: input.projectId,
          name: input.name,
        },
        orderBy: [{ version: "desc" }],
        select: {
          id: true,
          version: true,
        },
      });

      // find the latest user managed template, should be null if input.cloneSourceId is provided
      const latestTemplate = Boolean(templates.length) ? templates[0] : undefined;

      // Create a new project-level template either by cloning a hanzo managed template or by creating a new project-level template
      const evalTemplate = await tx.evalTemplate.create({
        data: {
          version: (latestTemplate?.version ?? 0) + 1,
          name: input.name,
          projectId: input.projectId,
          prompt: input.prompt,
          // if using default model, leave model, provider and modelParams empty
          // otherwise we will not pull the most recent default evaluation model
          provider: input.provider,
          model: input.model,
          modelParams: input.modelParams ?? undefined,
          vars: input.vars,
          outputSchema: input.outputSchema,
        },
      });

      /**
       * END OF CREATION OF PROJECT-LEVEL TEMPLATE
       * - Net new project-level template has been created, or
       * - New version of existing project-level template has been created
       */

      /**
       * UPDATE OF JOB CONFIGS REFERENCING THE NEW/UPDATED TEMPLATE
       */
      if (input.referencedEvaluators === EvalReferencedEvaluators.UPDATE) {
        /**
         * Option 2: Clone a hanzo managed template
         *
         * - Find the hanzo managed template
         * - Create a new project-level template from the cloned hanzo managed template
         * - Update all job configs that had referenced the hanzo managed template to now reference the cloned project-level template
         */
        if (input.cloneSourceId) {
          // find the hanzo managed template to clone
          const cloneSourceTemplate = await tx.evalTemplate.findUnique({
            where: {
              id: input.cloneSourceId,
              projectId: null,
            },
          });

          if (!cloneSourceTemplate) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Hanzo managed template not found",
            });
          }

          // find all versions of the hanzo managed template
          const cloneSourceTemplateList = await tx.evalTemplate.findMany({
            where: {
              projectId: null,
              name: cloneSourceTemplate.name,
            },
          });

          if (Boolean(cloneSourceTemplateList.length)) {
            // update all job configs that had referenced any version of the hanzo managed template to now reference the cloned user managed template
            await tx.jobConfiguration.updateMany({
              where: {
                evalTemplateId: {
                  in: cloneSourceTemplateList.map((t) => t.id),
                },
                projectId: input.projectId,
              },
              data: { evalTemplateId: evalTemplate.id },
            });
          }
          /**
           * Option 1: Create a new project-level template
           *
           * - Use previously found versions of the project-level template
           * - Update all job configs that had referenced any version of the project-level template to now reference the new project-level template
           */
        } else if (Boolean(templates.length)) {
          await tx.jobConfiguration.updateMany({
            where: {
              evalTemplateId: { in: templates.map((t) => t.id) },
              projectId: input.projectId,
            },
            data: {
              evalTemplateId: evalTemplate.id,
            },
          });
        }
      }

      /**
       * END OF UPDATE OF JOB CONFIGS REFERENCING THE NEW/UPDATED TEMPLATE
       */

      await auditLog({
        session: ctx.session,
        resourceType: "evalTemplate",
        resourceId: evalTemplate.id,
        action: "create",
      });

      return evalTemplate;
    });
  }),

  updateAllDatasetEvalJobStatusByTemplateId: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        evalTemplateId: z.string(),
        datasetId: z.string(),
        newStatus: z.enum(EvaluatorStatus),
      }),
    )
    .mutation(async ({ ctx, input: { projectId, evalTemplateId, datasetId, newStatus } }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: projectId,
        scope: "evalJob:CUD",
      });

      const oldStatus = newStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";

      const evaluators = await ctx.prisma.jobConfiguration.findMany({
        where: {
          projectId: projectId,
          evalTemplateId: evalTemplateId,
          status: oldStatus,
          targetObject: "dataset",
        },
      });

      const filteredEvaluators =
        evaluators?.filter(({ filter }) => {
          const parsedFilter = z.array(singleFilter).safeParse(filter);
          if (!parsedFilter.success) return false;
          if (parsedFilter.data.length === 0) return true;
          else
            return parsedFilter.data.some(({ type, value }) => type === "stringOptions" && value.includes(datasetId));
        }) || [];

      await ctx.prisma.jobConfiguration.updateMany({
        where: {
          id: { in: filteredEvaluators.map((e) => e.id) },
        },
        data: { status: newStatus },
      });

      return {
        success: true,
        message: `Updated ${filteredEvaluators.length} evaluators to ${newStatus}`,
      };
    }),

  updateEvalJob: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        evalConfigId: z.string(),
        config: UpdateEvalJobSchema,
      }),
    )
    .mutation(async ({ ctx, input: { config, projectId, evalConfigId } }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: projectId,
        scope: "evalJob:CUD",
      });

      const existingJob = await ctx.prisma.jobConfiguration.findUnique({
        where: {
          id: evalConfigId,
          projectId: projectId,
        },
        include: {
          evalTemplate: true,
        },
      });

      if (!existingJob) {
        logger.warn(`Job for update not found for project ${projectId} and id ${evalConfigId}`);
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      if (
        // check if:
        // - existing job ran on existing traces
        // - user wants to update the time scope
        // - new time scope does not include EXISTING
        existingJob.timeScope.includes("EXISTING") &&
        config.timeScope &&
        !config.timeScope.includes("EXISTING")
      ) {
        logger.error(
          `Job ${evalConfigId} for project ${projectId} ran on existing traces already. This cannot be changed anymore`,
        );
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The evaluator ran on existing traces already. This cannot be changed anymore.",
        });
      }

      if (
        existingJob.timeScope.includes("EXISTING") &&
        !existingJob.timeScope.includes("NEW") &&
        config.status === "INACTIVE"
      ) {
        logger.error(
          `Job ${evalConfigId} for project ${projectId} is running on existing traces only and cannot be deactivated`,
        );
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The evaluator is running on existing traces only and cannot be deactivated.",
        });
      }

      const validatedConfig = {
        ...config,
        ...(config.variableMapping !== undefined
          ? {
              variableMapping: validateVariableMappingForTarget({
                targetObject: existingJob.targetObject,
                mapping: config.variableMapping,
              }),
            }
          : {}),
      };
      const filterValidation = validateEvaluatorFiltersForTarget({
        targetObject: existingJob.targetObject as EvalTargetObject,
        filter: config.filter ?? existingJob.filter ?? [],
      });
      if (!filterValidation.isValid) {
        throw new InvalidRequestError(
          filterValidation.issues[0]?.message ??
            "Evaluator filters are invalid. Remove unsupported or incomplete filters and try again.",
        );
      }
      const validatedFilter = filterValidation.validatedFilters;

      if (existingJob.evalTemplate?.type === EvalTemplateType.CODE) {
        assertCodeEvalTemplateCanRun({
          sourceCodeLanguage: existingJob.evalTemplate.sourceCodeLanguage,
        });

        await assertCodeEvalJobConfigTestSucceeds({
          prisma: ctx.prisma,
          orgId: ctx.session.orgId,
          projectId,
          evalTemplateId: existingJob.evalTemplate.id,
          target: existingJob.targetObject as EvalTargetObject,
          mapping:
            validatedConfig.variableMapping ?? existingJob.variableMapping,
          scoreName: config.scoreName ?? existingJob.scoreName,
          filter: validatedFilter ?? [],
        });
      }

      await auditLog({
        session: ctx.session,
        resourceType: JOB_CONFIGURATION_AUDIT_LOG_RESOURCE_TYPE,
        resourceId: evalConfigId,
        action: "update",
      });

      if (
        shouldValidateBeforeActivation({
          currentStatus: existingJob.status,
          blockedAt: existingJob.blockedAt,
          nextStatus: config.status,
        })
      ) {
        if (!existingJob.evalTemplateId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Evaluator template not found",
          });
        }

        await validateEvalTemplateCanRun({
          prisma: ctx.prisma,
          projectId,
          evalTemplateId: existingJob.evalTemplateId,
        });
      }

      const updatedConfig = {
        ...validatedConfig,
        ...(config.filter !== undefined
          ? {
              filter: validatedFilter ?? [],
            }
          : {}),
        ...(validatedConfig.status !== undefined
          ? resetEvalConfigBlockFields
          : {}),
      };

      const updatedJob = await ctx.prisma.jobConfiguration.update({
        where: {
          id: evalConfigId,
          projectId: projectId,
        },
        data: updatedConfig,
      });

      // Clear the "no job configs" cache if we're activating a job configuration
      if (config.status === "ACTIVE") {
        await clearNoJobConfigsCache(projectId);
      }

      if (config.timeScope?.includes("EXISTING")) {
        logger.info(`Applying to historical traces for job ${evalConfigId} and project ${projectId}`);
        const batchJobQueue = getQueue(QueueName.BatchActionQueue);
        if (!batchJobQueue) {
          throw new Error("Batch job queue not found");
        }
        await batchJobQueue.add(
          QueueJobs.BatchActionProcessingJob,
          {
            name: QueueJobs.BatchActionProcessingJob,
            timestamp: new Date(),
            id: uuidv4(),
            payload: {
              projectId: projectId,
              actionId: "eval-create",
              configId: evalConfigId,
              cutoffCreatedAt: new Date(),
              targetObject: existingJob?.targetObject,
              query: {
                where: config.filter ?? [],
                orderBy: {
                  column: "timestamp",
                  order: "DESC",
                },
              },
            },
          },
          { delay: config.delay },
        );
      }

      return updatedJob;
    }),

  deleteEvalJob: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), evalConfigId: z.string() }))
    .mutation(async ({ ctx, input: { projectId, evalConfigId } }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: projectId,
        scope: "evalJob:CUD",
      });

      const existingJob = await ctx.prisma.jobConfiguration.findUnique({
        where: {
          id: evalConfigId,
          projectId: projectId,
        },
      });

      if (!existingJob) {
        logger.warn(`Job for deletion not found for project ${projectId} and id ${evalConfigId}`);
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      await auditLog({
        session: ctx.session,
        resourceType: JOB_CONFIGURATION_AUDIT_LOG_RESOURCE_TYPE,
        resourceId: evalConfigId,
        action: "delete",
      });

      await ctx.prisma.jobConfiguration.delete({
        where: {
          id: evalConfigId,
          projectId: projectId,
        },
      });
    }),

  // TODO: moved to LFE-4573
  // deleteEvalTemplate: protectedProjectProcedure
  //   .input(z.object({ projectId: z.string(), evalTemplateId: z.string() }))
  //   .mutation(async ({ ctx, input: { projectId, evalTemplateId } }) => {
  //     throwIfNoEntitlement({
  //       entitlement: "model-based-evaluations",
  //       projectId: projectId,
  //       sessionUser: ctx.session.user,
  //     });
  //     throwIfNoProjectAccess({
  //       session: ctx.session,
  //       projectId: projectId,
  //       scope: "evalTemplate:CUD",
  //     });

  //     const existingTemplate = await ctx.prisma.evalTemplate.findUnique({
  //       where: {
  //         id: evalTemplateId,
  //         projectId: projectId,
  //       },
  //     });

  //     if (!existingTemplate) {
  //       logger.warn(
  //         `Template for deletion not found for project ${projectId} and id ${evalTemplateId}`,
  //       );
  //       throw new TRPCError({
  //         code: "NOT_FOUND",
  //         message: "Template not found",
  //       });
  //     }

  //     await auditLog({
  //       session: ctx.session,
  //       resourceType: "evalTemplate",
  //       resourceId: evalTemplateId,
  //       action: "delete",
  //     });

  //     await ctx.prisma.evalTemplate.delete({
  //       where: {
  //         id: evalTemplateId,
  //         projectId: projectId,
  //       },
  //     });
  //   }),
  getLogs: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        filter: z.array(singleFilter),
        jobConfigurationId: z.string().optional(),
        ...paginationZod,
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "evalJobExecution:read",
      });

      // Strip deprecated filters — these columns were removed from the UI
      // because they required traces/scores data that no longer lives in
      // Postgres, but bookmarked URLs may still include them.
      const filters = input.filter.filter(
        (f) => !DEPRECATED_FILTER_COLUMNS.has(f.column),
      );

      const filterCondition = tableColumnsToSqlFilterAndPrefix(
        filters,
        evalExecutionsFilterCols,
        "job_executions",
      );

      const [jobExecutions, count] = await Promise.all([
        ctx.prisma.$queryRaw<
          Array<
            Pick<
              JobExecution,
              | "status"
              | "startTime"
              | "endTime"
              | "jobOutputScoreId"
              | "jobInputTraceId"
              | "jobTemplateId"
              | "jobConfigurationId"
              | "executionTraceId"
              | "error"
            >
          >
        >(
          generateExecutionsQuery(
            Prisma.sql`
            je.status,
            je.start_time as "startTime",
            je.end_time as "endTime",
            je.job_output_score_id as "jobOutputScoreId",
            je.job_input_trace_id as "jobInputTraceId",
            je.job_template_id as "jobTemplateId",
            je.job_configuration_id as "jobConfigurationId",
            je.execution_trace_id as "executionTraceId",
            je.error
            `,
            input.projectId,
            filterCondition,
            Prisma.sql`ORDER BY je.created_at DESC`,
            input.limit,
            input.page,
            input.jobConfigurationId,
          ),
        ),
        ctx.prisma.$queryRaw<Array<{ totalCount: bigint }>>(
          generateExecutionsQuery(
            Prisma.sql`COUNT(*) AS "totalCount"`,
            input.projectId,
            filterCondition,
            Prisma.empty,
            1, // limit
            0, // page
            input.jobConfigurationId,
          ),
        ),
      ]);

      const scoreIds = jobExecutions.map((je) => je.jobOutputScoreId).filter(isNotNullOrUndefined);

      const scores = scoreIds.length > 0 ? await getScoresByIds(input.projectId, scoreIds) : [];

      return {
        data: jobExecutions.map((je) => ({
          ...je,
          score: scores.find((s) => s?.id === je.jobOutputScoreId),
        })),
        totalCount: count.length > 0 ? Number(count[0]?.totalCount) : 0,
      };
    }),

  jobConfigsByDatasetId: protectedProjectProcedure
    .input(z.object({ projectId: z.string(), datasetId: z.string() }))
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "evalJob:read",
      });

      // Get all evaluators (jobConfigs) for the project, refactor to reuse filter builder pattern in lfe-2887
      const evaluators = await ctx.prisma.$queryRaw<
        Array<{
          id: string;
          scoreName: string;
        }>
      >(Prisma.sql`
      SELECT DISTINCT
        jc.id,
        jc.score_name as "scoreName"
      FROM
        "job_configurations" as jc
      WHERE
        jc.project_id = ${input.projectId}
        AND jc.job_type = 'EVAL'
        AND jc.target_object = 'dataset'
        AND jc.status = 'ACTIVE'
        AND (
          jc.filter IS NULL
          OR jsonb_array_length(jc.filter) = 0
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(jc.filter) as f
            WHERE f->>'column' = 'Dataset'
              AND f->>'type' = 'stringOptions'
              AND (
                (f->>'operator' = 'any of' AND ${Prisma.sql`${input.datasetId}`}::text = ANY(SELECT jsonb_array_elements_text(f->'value')))
                OR
                (f->>'operator' = 'none of' AND NOT (${Prisma.sql`${input.datasetId}`}::text = ANY(SELECT jsonb_array_elements_text(f->'value'))))
              )
          )
        )
      `);

      return evaluators;
    }),

  jobExecutionCountsByEvaluatorIds: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        evaluatorIds: z.array(z.string()),
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "evalJob:read",
      });

      if (input.evaluatorIds.length === 0) {
        return {};
      }

      return getEvaluatorExecutionStatusCountsByEvaluatorId({
        prisma: ctx.prisma,
        projectId: input.projectId,
        evaluatorIds: input.evaluatorIds,
      });
    }),

  costByEvaluatorIds: protectedProjectProcedure
    .input(
      z.object({
        projectId: z.string(),
        evaluatorIds: z.array(z.string()),
      }),
    )
    .query(async ({ input, ctx }) => {
      throwIfNoProjectAccess({
        session: ctx.session,
        projectId: input.projectId,
        scope: "evalJob:read",
      });

      const costs = await getCostByEvaluatorIds(input.projectId, input.evaluatorIds);

      // Convert array to map for easier lookup
      return costs.reduce(
        (acc, { evaluatorId, totalCost }) => {
          acc[evaluatorId] = totalCost;
          return acc;
        },
        {} as Record<string, number>,
      );
    }),
});

const generateConfigsQuery = (
  select: Prisma.Sql,
  projectId: string,
  filterCondition: Prisma.Sql,
  searchCondition: Prisma.Sql,
  orderCondition: Prisma.Sql,
  limit: number,
  page: number,
) => {
  return Prisma.sql`
  SELECT
   ${select}
   FROM job_configurations jc
   LEFT JOIN eval_templates et ON jc.eval_template_id = et.id AND (jc.project_id = et.project_id OR et.project_id IS NULL)
   WHERE jc.project_id = ${projectId}
   AND jc.job_type = 'EVAL'
   ${filterCondition}
   ${searchCondition}
   ${orderCondition}
   LIMIT ${limit} OFFSET ${page * limit};
  `;
};

const getEvaluatorConfigsOrderByCondition = (orderByState: OrderByState) => {
  const orderByCondition = orderByToPrismaSql(
    orderByState,
    evalConfigsTableCols,
  );

  if (orderByState?.column !== "status" && orderByState?.column !== "Status") {
    return orderByCondition;
  }

  return Prisma.sql`${orderByCondition}, jc.created_at DESC`;
};

const generateExecutionsQuery = (
  select: Prisma.Sql,
  projectId: string,
  filterCondition: Prisma.Sql,
  orderCondition: Prisma.Sql,
  limit: number,
  page: number,
  jobConfigurationId?: string,
) => {
  const configCondition = jobConfigurationId
    ? Prisma.sql`AND je.job_configuration_id = ${jobConfigurationId}`
    : Prisma.empty;

  return Prisma.sql`
  SELECT
   ${select}
   FROM job_executions je
   WHERE je.project_id = ${projectId}
   ${filterCondition}
   AND je.status != 'CANCELLED'
   ${configCondition}
   ${orderCondition}
   LIMIT ${limit} OFFSET ${page * limit};
  `;
};
