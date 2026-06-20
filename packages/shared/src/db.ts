// This file exports the prisma db connection, the Prisma Object, and the Typescript types.
// This is not imported in the index.ts file of this package, as we must not import this into FE code.

import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "process";
import kyselyExtension from "prisma-extension-kysely";
import { Kysely, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from "kysely";
import { DB } from ".";
import { jsonArrayCodec } from "./db-json-arrays";
import { logger } from "./server";

export class PrismaClientSingleton {
  private static instance: PrismaClient;

  public static getInstance(): PrismaClient {
    if (PrismaClientSingleton.instance) {
      return PrismaClientSingleton.instance;
    }

    PrismaClientSingleton.instance = createPrismaInstance();

    return PrismaClientSingleton.instance;
  }
}

const createPrismaInstance = () => {
  const client = new PrismaClient<Prisma.PrismaClientOptions, "warn" | "error" | "query">({
    log: [
      { emit: "event", level: "query" },
      { emit: "event", level: "error" },
      { emit: "event", level: "warn" },
    ],
  });

  if (env.NODE_ENV === "development") {
    client.$on("query", (event) => {
      logger.info(`prisma:query ${event.query}, ${event.duration}ms`);
    });
  }

  client.$on("warn", (event) => {
    logger.warn(`prisma:warn ${event.message}`);
  });

  client.$on("error", (event) => {
    logger.error(`prisma:error ${event.message}`);
  });

  // Install the SQLite JSON-array codec so the columns that were Postgres
  // scalar lists round-trip as real arrays for every caller (see
  // db-json-arrays.ts). The extension is transparent — it adds no new client
  // surface — so we keep the PrismaClient type for the 300+ consumers.
  return client.$extends(jsonArrayCodec) as unknown as PrismaClient;
};

export class KyselySingleton {
  private static instance: { $kysely: Kysely<DB> };

  public static getInstance() {
    if (KyselySingleton.instance) {
      return KyselySingleton.instance;
    }

    KyselySingleton.instance = PrismaClientSingleton.getInstance().$extends(
      kyselyExtension({
        kysely: (driver) =>
          new Kysely<DB>({
            dialect: {
              // The Prisma extension supplies the driver; the dialect only needs
              // to describe the SQL flavour. The application database is SQLite
              // (Hanzo Base), so use the SQLite adapter/introspector/compiler.
              createDriver: () => driver,
              createAdapter: () => new SqliteAdapter(),
              createIntrospector: (db) => new SqliteIntrospector(db),
              createQueryCompiler: () => new SqliteQueryCompiler(),
            },
          }),
      }),
    );

    return KyselySingleton.instance;
  }
}

declare const globalThis: {
  prismaGlobal: PrismaClient | undefined;
  kyselyPrismaGlobal: { $kysely: Kysely<DB> } | undefined;
} & typeof global;

// eslint-disable-next-line turbo/no-undeclared-env-vars
if (process.env.NODE_ENV === "development") {
  globalThis.prismaGlobal ??= createPrismaInstance(); // regular instantiation
}

export const prisma = globalThis.prismaGlobal ?? PrismaClientSingleton.getInstance();
export const kyselyPrisma = globalThis.kyselyPrismaGlobal ?? KyselySingleton.getInstance();

// SQLite (Hanzo Base) has no native enums; surface the former Prisma enum
// values/types from ./db-enums (const objects with identical names) so that
// `@hanzo/console/src/db` keeps exporting `Role`, `JobExecutionStatus`, etc.
export * from "./db-enums";
export * from "@prisma/client";
