# Codex Guidelines for `@hanzo/console`

This file covers package-local guidance for this package.
Use root [AGENTS.md](../../AGENTS.md) for monorepo-level rules.

## Purpose

- Shared domain, database, queue, and server utilities used by `web` and
  `worker`.
- Primary owner of Postgres schema, ClickHouse schema, and queue payload
  contracts.

## Maintenance Contract

- `AGENTS.md` is a living document.
- Update this file in the same PR for material shared-package changes:
  - new/renamed schema or migration workflows
  - new/renamed queue contracts
  - changed exported surfaces or validation commands
- Because this package is consumed by both `web` and `worker`, cross-package
  changes usually require updates in root `AGENTS.md` too.

## High-Signal Entry Points

- Main exports: `src/index.ts`
- DB clients and types: `src/db.ts`
- Server exports: `src/server/index.ts`
- Server cache utilities: `src/server/cache/*`
- Domain model types: `src/domain/*`
- Repository layer: `src/server/repositories/*`
- Queue payload schemas: `src/server/queues.ts`
- Queue helpers: `src/server/redis/*`
- Dashboard/monitor query feature (data model + server-only builder/executor): `src/features/query/*`
- Application database schema (SQLite / Hanzo Base): `prisma/schema.prisma`
  - SQLite has no native enums or scalar lists. Former Prisma enums live as
    const objects + union types in `src/db-enums.ts` (re-exported from the
    barrel and `src/db.ts`); import enum values/types from there or the
    package, never from `@prisma/client`.
  - Former `Type[]` columns are `String` JSON columns; the
    `src/db-json-arrays.ts` Prisma `$extends` codec transparently
    serializes/parses them, so callers keep using real arrays. Register any
    new list column there.
  - Startup needs no Postgres and no `prisma migrate deploy`: the schema is
    materialized with `prisma db push` (see `web/entrypoint.sh`).
    `DATABASE_URL` is a `file:` SQLite path.
- For unstable public eval APIs, the public `evaluatorId` is currently the
  exact `EvalTemplate.id`. Latest-version family grouping is derived from
  `(projectId, name)` rather than stored on extra evaluator identity fields.
- ClickHouse (datastore) OLAP layer is unchanged: `DATASTORE_*` env,
  `clickhouse/migrations/{clustered,unclustered}/*`.
- Seeder and support scripts: `scripts/seeder/*`, `clickhouse/scripts/*`

## Export Entry Points

- `@hanzo/console` via `src/index.ts`: default shared surface for
  cross-runtime types, zod schemas, table definitions, domain models, prompt
  helpers, eval/model-pricing helpers, and other frontend-safe utilities.
- `@hanzo/console/src/server` via `src/server/index.ts`: server-only barrel
  for shared backend services, repositories, queue helpers/contracts, Redis and
  ClickHouse helpers, auth helpers, logger/instrumentation, ingestion helpers,
  LLM execution helpers, and server test utilities.
- `@hanzo/console/src/db` via `src/db.ts`: Prisma client singleton plus
  Prisma namespace/types for direct database access. Never route this into
  frontend-safe code.
- `@hanzo/console/src/env` via `src/env.ts`: validated shared environment
  schema/accessors used by backend runtimes and scripts.
- `@hanzo/console/encryption` via `src/encryption/index.ts`: encryption and
  signature helpers for secrets and signed payloads.
- `@hanzo/console/query` via `src/features/query/index.ts`: dashboard query feature.
- Narrower exported subpaths also exist for targeted imports:
  `@hanzo/console/src/server/auth/apiKeys`,
  `@hanzo/console/src/server/ee/ingestionMasking`, and
  `@hanzo/console/src/utils/chatml`.

When changing export surfaces, keep `package.json#exports`, the relevant barrel
file (`src/index.ts`, `src/server/index.ts`, etc.), and this guide aligned in
the same PR.

## Architecture Handbook

- For the cross-package system view, read the architecture handbook:
  [langfuse.com/handbook/product-engineering/architecture](https://langfuse.com/handbook/product-engineering/architecture).
- Source markdown lives in
  `../langfuse-docs/content/handbook/product-engineering/architecture.mdx`
  (GitHub mirror:
  [architecture.mdx](https://github.com/langfuse/langfuse-docs/blob/4188c1ba453240c90a763a8067ef442d68839323/content/handbook/product-engineering/architecture.mdx#L4)).
- Consult it when changing shared contracts that affect the web container,
  worker container, ingestion flow, or storage-layer boundaries.

## Quick Commands

- Dev watch build: `pnpm --filter @hanzo/console run dev`
- Lint: `pnpm --filter @hanzo/console run lint`
- Lint fix: `pnpm --filter @hanzo/console run lint:fix`
- Typecheck: `pnpm --filter @hanzo/console run typecheck`
- Build: `pnpm --filter @hanzo/console run build`
- Prisma generate: `pnpm --filter @hanzo/console run db:generate`
- Sync SQLite schema (no migrations): `pnpm --filter @hanzo/console run db:push`
- ClickHouse reset: `pnpm --filter @hanzo/console run ch:reset`

## Playbooks

### Application (SQLite) schema change

1. Update `prisma/schema.prisma`. Keep it SQLite-compatible: no native enums
   (use a `String` column + an entry in `src/db-enums.ts`), no scalar lists
   (use a `String` JSON column + an entry in `src/db-json-arrays.ts`), no
   Postgres-only index types (`Hash`/`Gin`) or `@db.*` Postgres attributes.
2. Regenerate client/types via `db:generate`; apply with `db:push` (there is
   no migration history).
3. Update affected repository/query code under `src/server/repositories/*`.
4. Add/adjust `web` and/or `worker` tests for changed behavior.

### ClickHouse schema change

1. Add migration under `clickhouse/migrations/*`.
2. Update ClickHouse query/mapping logic in `src/server/clickhouse/*` and
   related repositories.
3. Validate ingestion/read path impact in both `web` and `worker`.
4. If the change affects columns, types, or nullability of tables read by blob
   storage export queries (`getTracesForBlobStorageExport`,
   `getObservationsForBlobStorageExport`, `getScoresForBlobStorageExport`,
   `getEventsForBlobStorageExport`, or the EventsQueryBuilder `export` field
   set), fetch the latest published docs and check for discrepancies:
   - https://langfuse.com/docs/api-and-data-platform/features/export-to-blob-storage
   - https://langfuse.com/docs/api-and-data-platform/features/blob-storage-export-fields
     Surface any mismatches in field names, types, nullability, or filter
     descriptions so they can be addressed in the docs repo.

### Queue payload contract change

1. Update zod schemas/types in `src/server/queues.ts`.
2. Update queue helpers in `src/server/redis/*` if queue names/payload
   handling changed.
3. Update producer and consumer code in `web`/`worker`.
4. Add or update regression tests in affected packages.

- If a queue becomes sharded, add its shard-count env in `src/env.ts` and keep
  the shard-aware queue callers in `web` and `worker` aligned with the shared
  helper API.

### Export surface change

1. Decide whether the symbol belongs in the client-safe root barrel, the
   server-only barrel, or a narrower subpath export.
2. Update the owning file (`src/index.ts`, `src/server/index.ts`, `src/db.ts`,
   `src/env.ts`, or another explicit subpath).
3. Update `package.json#exports` if the public import path changed or a new
   subpath is required.
4. Update import sites in `web`, `worker`, and `ee` to use the intended
   entrypoint.
5. Update this file and any consuming package `AGENTS.md` guidance when the
   recommended import path changes.

## Package-Specific Rules

- Keep backward compatibility in queue payloads when possible during rolling
  deployments.
- Do not hand-edit generated artifacts under `prisma/generated/*` or `dist/*`.
- Avoid exposing server-only modules through `src/index.ts` if they must remain
  frontend-safe.
- Changes to domain constants consumed by blob storage exports (e.g.
  `LISTABLE_SCORE_TYPES` in `src/domain/scores.ts`, score data type enums)
  should be reviewed against the blob storage export field reference docs for
  consistency — fetch the latest page and surface any discrepancies:
  https://langfuse.com/docs/api-and-data-platform/features/blob-storage-export-fields
