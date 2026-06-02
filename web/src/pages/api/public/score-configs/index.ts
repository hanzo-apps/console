import { createAuthedProjectAPIRoute } from "@/src/features/public-api/server/createAuthedProjectAPIRoute";
import { withMiddlewares } from "@/src/features/public-api/server/withMiddlewares";
import { isBooleanDataType } from "@/src/features/scores/lib/helpers";
import { filterAndValidateDbScoreConfigList, validateDbScoreConfig } from "@hanzo/shared";
import { Prisma, prisma } from "@hanzo/shared/src/db";
import { traceException } from "@hanzo/shared/src/server";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import {
  GetScoreConfigsQuery,
  GetScoreConfigsResponse,
  PostScoreConfigBody,
  PostScoreConfigResponse,
} from "@/src/features/public-api/types/score-configs";

export default withMiddlewares({
  POST: createAuthedProjectAPIRoute({
    name: "Create Score Config",
    bodySchema: PostScoreConfigBody,
    responseSchema: PostScoreConfigResponse,
    fn: async ({ body, auth }) => {
      return await createScoreConfig({
        context: auth.scope,
        body,
      });
    },
  }),
  GET: createAuthedProjectAPIRoute({
    name: "Get Score Configs",
    querySchema: GetScoreConfigsQuery,
    responseSchema: GetScoreConfigsResponse,
    fn: async ({ query, auth }) => {
      const { page, limit } = query;
      return await listScoreConfigs({
        projectId: auth.scope.projectId,
        page,
        limit,
      });

      const configs = filterAndValidateDbScoreConfigList(rawConfigs, traceException);

      const totalItemsRes = await prisma.$queryRaw<{ count: bigint }[]>(
        Prisma.sql`
          SELECT
            COUNT(*) as count
          FROM
            "score_configs" AS sc
          WHERE sc.project_id = ${auth.scope.projectId}
        `,
      );

      const totalItems = totalItemsRes[0] !== undefined ? Number(totalItemsRes[0].count) : 0;

      return {
        data: configs,
        meta: {
          page: page,
          limit: limit,
          totalItems,
          totalPages: Math.ceil(totalItems / limit),
        },
      };
    },
  }),
});
