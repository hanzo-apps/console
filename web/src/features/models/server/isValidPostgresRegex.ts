import { type prisma as _prisma } from "@hanzo/console/src/db";

/**
 * Validates a model `match_pattern` regex.
 *
 * The application database is SQLite, which has no POSIX regex operator (`~`),
 * and model matching now compiles `match_pattern` with the JavaScript `RegExp`
 * engine (see `modelMatch.ts`). So we validate the pattern the same way it is
 * later executed — by attempting to compile it with `RegExp` — rather than
 * round-tripping to the database.
 *
 * The `prisma` parameter is kept for call-site compatibility; it is unused.
 */
export const isValidPostgresRegex = async (
  regex: string,
  _prismaClient?: typeof _prisma,
): Promise<boolean> => {
  try {
    new RegExp(regex);
    return true;
  } catch {
    return false;
  }
};
