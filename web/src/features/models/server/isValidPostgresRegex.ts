import { Prisma, type prisma as _prisma } from "@hanzo/console/src/db";

export const isValidPostgresRegex = async (
  regex: string,
  prisma: typeof _prisma,
): Promise<boolean> => {
  try {
    await prisma.$queryRaw(Prisma.sql`SELECT 'test_string' ~ ${regex}`);
    return true;
  } catch {
    return false;
  }
};
