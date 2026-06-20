import type { PrismaClient } from "../../db";
import { Prisma } from "../../db";
import { filterOperators } from "../../interfaces/filters";

/**
 * Supported object types for comment filtering
 */
export type CommentObjectType = "TRACE" | "OBSERVATION" | "SESSION" | "PROMPT";

/**
 * Operators for comment count filters.
 * Extends filterOperators.number with "!=" for additional filtering capability.
 */
export type CommentCountOperator = (typeof filterOperators.number)[number] | "!=";

/**
 * Operators for comment content filters.
 * Uses the same operators as filterOperators.string.
 */
export type CommentContentOperator = (typeof filterOperators.string)[number];

/**
 * Query the application database for object IDs that have a specific number of
 * comments. Uses GROUP BY + HAVING to efficiently filter by comment count.
 *
 * @example
 * // Get traces with >= 3 comments
 * await getObjectIdsByCommentCount({
 *   prisma,
 *   projectId: "abc123",
 *   objectType: "TRACE",
 *   operator: ">=",
 *   value: 3
 * });
 */
export async function getObjectIdsByCommentCount({
  prisma,
  projectId,
  objectType,
  operator,
  value,
}: {
  prisma: PrismaClient;
  projectId: string;
  objectType: CommentObjectType;
  operator: CommentCountOperator;
  value: number;
}): Promise<string[]> {
  // Validate operator to prevent SQL injection
  const validOperators: CommentCountOperator[] = [">=", "<=", "=", ">", "<", "!="];
  if (!validOperators.includes(operator)) {
    throw new Error(`Invalid operator: ${operator}`);
  }

  // SQLite: `object_type` is a TEXT column (no enums), so no cast is needed.
  const rawQuery = Prisma.sql`
    SELECT object_id
    FROM comments
    WHERE project_id = ${projectId} AND object_type = ${objectType}
    GROUP BY object_id
    HAVING COUNT(*) ${Prisma.raw(operator)} ${value}
  `;

  const results = await prisma.$queryRaw<{ object_id: string }[]>(rawQuery);
  return results.map((r) => r.object_id);
}

/**
 * Query the application database for object IDs where comments match a text
 * search query. SQLite has no Postgres full-text search, so "contains" and the
 * other operators degrade to case-insensitive substring matching (LIKE).
 *
 * @example
 * // Get traces with comments containing "bug"
 * await getObjectIdsByCommentContent({
 *   prisma,
 *   projectId: "abc123",
 *   objectType: "TRACE",
 *   searchQuery: "bug",
 *   operator: "contains"
 * });
 */
export async function getObjectIdsByCommentContent({
  prisma,
  projectId,
  objectType,
  searchQuery,
  operator = "contains",
}: {
  prisma: PrismaClient;
  projectId: string;
  objectType: CommentObjectType;
  searchQuery: string;
  operator?: CommentContentOperator;
}): Promise<string[]> {
  if (operator === "contains") {
    const trimmedQuery = searchQuery.trim();

    if (!trimmedQuery) {
      return [];
    }

    // SQLite does not have Postgres full-text search (`to_tsvector @@
    // plainto_tsquery`). The `comments` table is a plain table with no FTS5
    // virtual companion, so we degrade to a case-insensitive substring match
    // (SQLite `LIKE` is ASCII case-insensitive by default). Difference vs
    // Postgres: no stemming/tokenization ("running" no longer matches "run"),
    // and matches are substring rather than whole-word.
    const comments = await prisma.comment.findMany({
      where: {
        projectId,
        objectType,
        content: { contains: trimmedQuery },
      },
      select: { objectId: true },
      distinct: ["objectId"],
    });

    return comments.map((c) => c.objectId);
  }

  // For other operators, use Prisma's query builder. SQLite `LIKE` (which
  // backs contains/startsWith/endsWith) is ASCII case-insensitive by default;
  // Prisma's `mode: "insensitive"` is unsupported on SQLite, so it is omitted.
  let whereCondition: Prisma.CommentWhereInput;

  if (operator === "does not contain") {
    whereCondition = {
      projectId,
      objectType,
      NOT: {
        content: {
          contains: searchQuery,
        },
      },
    };
  } else if (operator === "starts with") {
    whereCondition = {
      projectId,
      objectType,
      content: {
        startsWith: searchQuery,
      },
    };
  } else if (operator === "ends with") {
    whereCondition = {
      projectId,
      objectType,
      content: {
        endsWith: searchQuery,
      },
    };
  } else {
    // Default to contains (for "=" operator which maps to exact match in string filters)
    whereCondition = {
      projectId,
      objectType,
      content: {
        contains: searchQuery,
      },
    };
  }

  const comments = await prisma.comment.findMany({
    where: whereCondition,
    select: { objectId: true },
    distinct: ["objectId"],
  });

  return comments.map((c) => c.objectId);
}
