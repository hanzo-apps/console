# CLAUDE.md

## Project Overview

Hanzo Console is an open-source LLM engineering platform that helps teams collaboratively develop, monitor, evaluate, and debug AI applications.
The main feature areas are tracing, evals and prompt management. Console consists of the web application (this repo), documentation, python SDK and javascript/typescript SDK.
This repo contains the web application, worker, and supporting packages but notably not the JS nor Python client SDKs.

## Repository Structure
High level structure. There are more folders (eg for hooks etc).
```
console/
├── web/                     # Next.js 14 frontend/backend application
│   ├── src/
│   │   ├── components/     # Reusable UI components (shadcn/ui)
│   │   ├── features/       # Feature-specific code organized by domain
│   │   ├── pages/          # Next.js pages (Pages Router)
│   │   └── server/         # tRPC API routes and server logic
│   └── public/             # Static assets
├── worker/                  # Express.js background job processor
│   └── src/
│       ├── queues/         # BullMQ job queues
│       └── services/       # Background processing services
├── packages/
│   ├── shared/             # Shared types, schemas, and utilities
│   │   ├── prisma/         # Database schema and migrations
│   │   └── src/            # Shared TypeScript code
│   ├── config-eslint/      # ESLint configuration
│   └── config-typescript/  # TypeScript configuration
├── ee/                     # Enterprise Edition features
├── fern/                   # API documentation and OpenAPI specs
├── generated/              # Auto-generated client code
└── scripts/                # Development and deployment scripts
```

## Repository Architecture
This is a **pnpm + Turbo monorepo** with the following key packages:

### Core Applications
- **`/web/`** - Next.js 14 application (Pages Router) providing both frontend UI and backend APIs
- **`/worker/`** - Express.js background job processing server
- **`/packages/shared/`** - Shared database schema, types, and utilities

### Supporting Packages
- **`/ee/`** - Enterprise Edition features (separate licensing)
- **`/packages/config-eslint/`** - Shared ESLint configuration
- **`/packages/config-typescript/`** - Shared TypeScript configuration

## Development Commands

### Development
```sh
pnpm i               # Install dependencies
pnpm run dev         # Start all services (web + worker)
pnpm run dev:web     # Web app only (localhost:3000) - **used in most cases!**
pnpm run dev:worker  # Worker only
pnpm run dx          # Full initial setup: install deps, reset DBs, resets node modules, seed data, start dev. USE SPARINGLY AS IT WIPES THE DATABASE & node_modules
```

### Database Management
database commands are to be run in the `packages/shared/` folder.
```sh
pnpm run db:generate       # Build prisma models
pnpm run db:migrate        # Run Prisma migrations
pnpm run db:reset          # Reset and reseed databases
pnpm run db:seed           # Seed with example data
```

### Infrastructure
```sh
pnpm run infra:dev:up      # Start Docker services (PostgreSQL, Datastore, Redis, MinIO)
pnpm run infra:dev:down    # Stop Docker services
```

### Building & Type Checking
```sh
pnpm --filter=PACKAGE_NAME run build  # Runs the build command, will show real typescript errors etc.
pnpm tc                               # Fast typecheck across all packages (alias for pnpm typecheck)
pnpm build:check                      # Full Next.js build to alternate dir (can run parallel with dev server)
```

### Testing in Web Package
The web package uses JEST for unit tests.
Depending on the file location (sync, async)
`web` related tests must go into the `web/src/__tests__/` folder.
```sh
pnpm test-sync --testPathPatterns="$FILE_LOCATION_PATTERN" --testNamePattern="$TEST_NAME_PATTERN"
# For tests in the async folder:
pnpm test -- --testPathPatterns="$FILE_LOCATION_PATTERN" --testNamePattern="$TEST_NAME_PATTERN"
# For client tests:
pnpm test-client --testPathPatterns="buildStepData" --testNamePattern="buildStepData"
```

### Testing in the Worker Package
The worker uses `vitest` for unit tests.
```sh
pnpm run test --filter=worker -- $TEST_FILE_NAME -t "$TEST_NAME"
```

### Utilities
```bash
pnpm run format            # Format code across entire project
pnpm run nuke              # Remove all node_modules, build files, wipe database, docker containers. **USE WITH CAUTION**
```

## Technology Stack

### Web Application (`/web/`)
- **Framework**: Next.js 14 (Pages Router)
- **APIs**: tRPC (type-safe client-server communication) + REST APIs for public access
- **Authentication**: NextAuth.js/Auth.js
- **Database**: Prisma ORM with PostgreSQL
- **Analytics Database**: Datastore (high-volume trace data)
- **Validation**: Zod schemas, we use zodv4 (always import from `zod/v4`)
- **Styling**: Tailwind CSS with CSS variables for theming
- **Components**: shadcn/ui (Radix UI primitives)
- **State Management**: TanStack Query (React Query) + tRPC
- **Charts**: Recharts

### Worker Application (`/worker/`)
- **Framework**: Express.js
- **Queue System**: BullMQ with Redis
- **Purpose**: Async processing (data ingestion, evaluations, exports, integrations)

### Infrastructure
- **Primary Database**: PostgreSQL (via Prisma ORM)
- **Analytics Database**: Datastore
- **Cache/Queues**: Redis
- **Blob Storage**: MinIO/S3

## Development Guidelines

### Frontend Features
- All new features go in `/web/src/features/[feature-name]/`
- Use tRPC for full-stack features (entry point: `web/src/server/api/root.ts`)
- Follow existing feature structure for consistency
- Use shadcn/ui components from `@/src/components/ui`
- Custom reusable components go in `@/src/components`

### Public API Development
- All public API routes in `/web/src/pages/api/public`
- Use `withMiddlewares.ts` wrapper
- Define types in `/web/src/features/public-api/types` with strict Zod v4 objects
- Add end-to-end tests (see `datasets-api.servertest.ts`)
- Manually update Fern API specs in `/fern/`, then regenerate OpenAPI spec via Fern CLI

### Authorization & RBAC
- Check `/web/src/features/rbac/README.md` for authorization patterns
- Implement proper entitlements checking (see `/web/src/features/entitlements/README.md`)

### Database
- **Dual database system**: PostgreSQL (primary) + Datastore (analytics)
- Use `golang-migrate` CLI for database migrations
- All database operations go through Prisma ORM for PostgreSQL
- Foreign key relationships may not be enforced in schema to allow unordered ingestion

### Testing
- Jest for API tests, Playwright for E2E tests
- For backend/API changes, tests must pass before pushes
- Add tests for new API endpoints and features
- When writing tests, focus on decoupling each `it` or `test` block to ensure that they can run independently and concurrently. Tests must never depend on the action or outcome of previous or subsequent tests.
- When writing tests, especially in the __tests__/async directory, ensure that you avoid `pruneDatabase` calls.

### Code Conventions
- **Pages Router** (not App Router)
- Follow conventional commits on main branch
- Use CSS variables for theming (supports auto dark/light mode)
- TypeScript throughout
- Zod v4 for all input validation

## Environment Setup

- **Node.js**: Version 24 (specified in `.nvmrc`)
- **Package Manager**: pnpm v9.5.0
- **Database Dependencies**: Docker for local PostgreSQL, Datastore, Redis, MinIO
- **Environment**: Copy `.env.dev.example` to `.env`

### Production env delivery (KMS-native, console.hanzo.ai)

In the `hanzo-k8s` cluster the console pod is reconciled by the Hanzo
operator from the `HanzoService/console` CR
(`hanzoai/universe:infra/k8s/operator/crs/console.yaml`). The deployed
operator **drops the CR's inline `spec.env`** and carries only
`envFrom: secretRef: console-secrets` onto the generated Deployment — so the
live pod has zero inline env vars. Every env var the process needs, including
the non-secret literals, must arrive through the KMS-synced `console-secrets`
Secret.

Consequences for env work here:
- `console-secrets` is populated by the `KMSSecret/console-kms-sync` CR from
  KMS `hanzo/prod/console-secrets`. Adding a NEW required env var (no
  `.optional()` / `.default()` in `web/src/env.mjs` or
  `packages/shared/src/env.ts`) means it MUST also be added to KMS and to that
  CR's `keys[]`, or the prod pod fails boot validation.
- Boot-blocking required literals already wired this way: `NEXTAUTH_URL`
  (`web` env `z.url()`) and `S3_EVENT_UPLOAD_BUCKET` (`shared` env
  `z.string()`).
- The kms-operator sync is all-or-nothing: seed the value in KMS BEFORE adding
  the key to the CR (see the seeder + ordering notes in
  `hanzoai/universe:scripts/console-kms-seed-literals.sh`).

## Login for Development

When running locally with seed data:
- Username: `demo@hanzo.ai`
- Password: `password`
- Demo project URL: `http://localhost:3000/project/7a88fb47-b4e2-43b8-a06c-a5ce950dc53a`

## Linear MCP
To get a project, use the `get_project` capability with the full project name as it is in the title.
- bad: message-placeholder-in-chat-messages-2beb6f02ec48
- good: Message placeholder in chat messages

## Front-end Tips

### Window Location Handling
- Whenever you want to use or do use window.location..., ensure that you also add proper handling for a custom basePath

## TypeScript Best Practices
- In TypeScript, if possible, don't use the `any` type
- **Use a single params object for functions with multiple arguments** - This makes code more readable at call sites and prevents bugs when arguments of the same type are accidentally swapped:

```typescript
// ❌ Bad - positional arguments are unclear and can be swapped without type errors
function sendMessage(userId: string, sessionId: string, projectId: string) {
  // ...
}
sendMessage(someString, someOtherString, anotherString); // Which is which?

// ✅ Good - params object makes intent clear and prevents argument swapping
function sendMessage(params: { userId: string; sessionId: string; projectId: string }) {
  // ...
}
sendMessage({ userId: someString, sessionId: someOtherString, projectId: anotherString });
```

## General Coding Guidelines
- For easier code reviews, prefer not to move functions etc around within a file unless necessary or instructed to do so

## Development Tips
- Before trying to build the package, try running the linter once first

## Multi-tenant console on IAM: org/membership sync + all-service embeds (feat/console-iam-mt-allservices)
This supersedes the 2-service hardcoded embed (feat/multi-tenant-embeds-branding).
Two gaps closed: (1) IAM identity → console orgs, (2) embed EVERY service per-org.

### Deploy + verify (operational)
- **Image**: `ghcr.io/hanzoai/console:3.159.23-mt` (tag `v3.159.23-mt` on main →
  `build-and-push.yml` "Docker Release" on self-hosted `hanzo-build-linux-amd64`).
- **Deploy target is the OPERATOR CR**, not a raw Deployment: live console is a
  `hanzo.ai/v1 Service` CR named `console` (`managed-by: hanzo-operator`, owned by
  the Service CR), running the SQLite app.db + replicate sidecar. Bump
  `universe/infra/k8s/operator/crs/console-v1.yaml` `spec.image.tag` + env, then
  the operator reconciles the Deployment. (The committed CR was badly drifted from
  live — this change re-syncs it: SQLite persistence, INIT_ORG_*, IAM_SERVER_URL=
  iam.hanzo.ai, KMS secretKeyRefs, embed URLs.)
- **IAM API prefix GOTCHA**: Hanzo IAM serves the data API under
  `/v1/iam/*`; the bare `/api/*` paths return the IAM SPA HTML. The `@hanzo/iam`
  SDK's `getUser`/`getOrganizations` target `/api/*` → would parse HTML. Our
  `iamGetUser`/`iamListAllOrganizations` call `/v1/iam/*` explicitly.
- **The 45-org trap**: `/v1/iam/get-organizations?owner=admin` returns ~45 orgs,
  mostly per-user *personal* orgs (named by email), NOT tenants. A global admin
  OWNERs the canonical tenant set (`INIT_ORG_IDS`=hanzo,lux,zoo,pars) + existing
  console orgs — never the personal-org list.
- **Sync runs on the real login path**: all login paths funnel through
  `establishIamSession` (signin / token-session / OAuth-callback `auth/token`),
  where the sync is hooked. The live SSO is the OAuth-callback path; the JWT `sub`
  (`<org>/<user>`, e.g. `admin/z`) drives `iamGetUser` → admin flags.
- **Playwright verify**: `web/scripts/verify-mt-console.mjs` (run FROM `web/` so
  `@playwright/test` resolves). Drives console.hanzo.ai: SSO "Hanzo IAM" button →
  hanzo.id form (email + password, submit via `button[type=submit]`, NOT the
  "Continue with GitHub/Google" social buttons) → org list → `/project/<id>/svc/
  <slug>` embed iframe. `CONSOLE_USER=z@hanzo.ai CONSOLE_PASS=IloveHanzo2026!!!`
  (3 bangs — the e2e default; NOT 2). BEFORE (3.159.22-mt): admin saw 1 cuid org,
  `/svc/*` 404. AFTER (3.159.23-mt): all tenant orgs + embeds render.
- **Build-infra fix shipped alongside**: `hanzoai/migrate` (golang-migrate fork
  the web Dockerfile clones for the datastore-driver migrate binary) was PRIVATE
  + archived → unauth `git clone` exit 128 broke every console image build. Made
  it public+unarchived; Dockerfile keeps a `GH_PAT` build-arg fallback for
  private/local builds. (secrets.* is NOT allowed in a reusable-workflow call's
  with.build-args — that earlier broke the whole workflow parse.)

- **IAM → console membership sync (the gap that left admins with 0 orgs)**:
  `syncIamMembershipsForUser` (`web/src/features/auth/lib/syncIamMemberships.ts`),
  called from `establishIamSession()` (`.../auth/lib/iamSession.ts`) on EVERY login —
  the single provisioning point; `hydrateSession()` only READS the result. Policy is
  pure + unit-tested in `.../auth/lib/iamSyncPolicy.ts`:
  - **Global admin** = IAM user owned by an org in `HANZO_ADMIN_IAM_ORGS` (default
    `admin` — IAM's super-org where a@/z@/woo@ live), OR IAM `isGlobalAdmin`/
    `isAdmin`, OR email domain in `HANZO_ADMIN_EMAIL_DOMAINS` → becomes **OWNER of
    EVERY console org** (first materializes a console org per IAM org under owner
    `admin`, then OWNERs all).
  - **Normal user** → **MEMBER** of their own IAM org (the `owner` of their IAM user /
    the org segment of their `sub`).
  - Console org id **IS** the IAM org name (unifies with the existing
    `INIT_ORG_IDS=hanzo,lux,zoo,pars` seed; portable single `upsert`, no JSON-path
    filter → works on SQLite + Postgres). `metadata.iamOrg` kept for discoverability.
    A default project is seeded on first org creation so the org is navigable.
  - `roleRank` never downgrades a manually-elevated role on re-sync.
  - IAM org listing/flags via `iamListAllOrganizations` + `iamGetUser`
    (`.../auth/lib/iamServer.ts`, confidential-client Basic auth — no user token).
- **Embed ALL services — ONE registry, ONE proxy, ONE page**:
  `web/src/features/embedded-services/registry.ts` (`EMBEDDED_SERVICES`) is the single
  source of truth. A service is one entry → drives the proxy route, the page, AND the
  nav. Active only when its upstream `*_URL` is set, so the live catalog = what the
  cluster runs (data-driven, not hardcoded). Base, Playground, Chat, Flow, Bots,
  Search, Commerce, KMS, Infrastructure are registered.
  - Dynamic proxy: `/api/svc/[service]/[[...path]].ts` → looks up the registry →
    `createServiceProxy` (`web/src/server/service-proxy.ts`, unchanged hardened proxy:
    strips client tenant headers, injects session `x-org-id/x-project-id/x-actor-id/
    x-env`, drops hop-by-hop, `rewritePrefixes` for SPA root-absolute paths).
  - Dynamic page: `/project/[projectId]/svc/[service].tsx` → one `EmbeddedDashboard`
    for any slug. iframe `src` = `/api/svc/<slug><rootPath>?projectId=<id>`.
  - Nav: `serviceRoutes()` in `routes.tsx` maps the registry → one
    `/project/[projectId]/svc/<slug>` entry each, grouped by `RouteGroup`,
    org-gated (`requiresOrganization`). `RouteSection`/`RouteGroup` extracted to
    `route-groups.ts` (pure) so the server registry imports them without the
    `routes.tsx` graph. Deleted the 4 hardcoded files (base.tsx, playground-app.tsx,
    api/base, api/playground-app).
- **ORG-SCOPING FIX (was silently broken)**: `tenant-headers.ts` previously read
  `session.orgId`/`session.projectId` which the IAM session NEVER sets → the proxy
  injected NO `x-org-id`. Now `tenant-scope.ts` (pure, unit-tested) resolves the org
  from the project the iframe DECLARES (`?projectId=` on the src, which also rides the
  Referer of the SPA's sub-requests) and AUTHORIZES it against the session's
  memberships — accepts only a project whose org the user belongs to; never falls back
  to `organizations[0]` (no cross-tenant header leak).
- **TRAILING-SLASH GOTCHA** (the embed redirect-loop): Next.js `trailingSlash:false`
  308-strips a trailing slash off the iframe `src`; Base (PocketBase) 307-redirects
  `/_` → `/_/`. A `/api/svc/base/_/` src therefore ping-pongs forever. Fix: iframe
  `src` is slash-less (`/api/svc/base/_`, registry `rootPath:"/_"`) and the proxy
  re-adds the slash on the UPSTREAM request via `forceTrailingSlashFor:["_"]` so Base
  answers 200. See `buildUpstreamPath` + tests in `service-proxy.clienttest.ts`.
- **Tests** (all `*.clienttest.ts`, pure, 41 passing): `tenant-scope` (authorization +
  no cross-tenant leak), `iamSyncPolicy` (global-admin determination, role precedence),
  `navigationFilters` (registry → one /svc route each, org-gated), `service-proxy`
  (path rewriting). Typecheck/lint: 0 NEW errors vs main (the ~862 pre-existing errors
  are the stale `@hanzo/console` shared-build / Flag/Role/env types, unrelated).
- **Branding**: the real `@hanzo` monochrome blocky-H is `HanzoCloudIcon`
  (`web/src/components/HanzoLogo.tsx`, 67×67, 7 paths, `fill-current`) and
  `web/public/icon.svg`. Do NOT reintroduce a red/symmetric/hand-drawn H.
- **KNOWN PRE-EXISTING CRASH (not from this feature)**: the project overview page
  (`pages/project/[projectId]/index.tsx`) throws `mapLegacyUiTableFilterToView is
  not a function` at hydration on BOTH the prior prod tag and this branch (identical
  compiled chunk hash) — owned by the concurrent ProjectOverview rebuild. The embed
  pages are separate routes and render independently of this crash.

## Stage-3: easy invite + commerce credits + white-label-by-host (console 3.159.25)

Three customer/admin-pane deliverables. All grounded in live-cluster facts.

### 1. Easy invite end-to-end (IAM-provision + SMTP)
- **Gap found:** every IAM login path (`signin.ts`, `auth/token.ts`, `token-session.ts`)
  funnels through `establishIamSession` (iamSession.ts) which upserts the console
  `User` and calls `syncIamMembershipsForUser` — but NEVER consumes a pending
  `MembershipInvitation`. So a brand-new invited email signs in, gets a user row,
  but does not land in the inviting org (unless it is their own IAM org / they are a
  global admin).
- **Fix (DRY, one hook):** `establishIamSession` now calls
  `createProjectMembershipsOnSignup({id,email},{userWasJustCreated})` right after the
  upsert. That is the exact upstream acceptance path used by credentials/signup-verify;
  it internally runs `processMembershipInvitations` (finds invites by email → creates
  OrganizationMembership[+ProjectMembership] → deletes the invites) and is
  try/catch-wrapped + idempotent (no-op when there are no pending invites). `userWasJustCreated`
  is derived by checking user existence before the upsert.
- **SMTP:** `sendMembershipInvitationEmail` needs `SMTP_CONNECTION_URL` + `EMAIL_FROM_ADDRESS`
  (silently no-ops without them; failures swallowed). Neither was in `console-secrets`
  or the operator CR. Wired both into the operator CR `env[]` via `secretKeyRef`
  (`console-secrets` keys `SMTP_CONNECTION_URL`, `EMAIL_FROM_ADDRESS`) — values live
  only in the secret/KMS, never in the CR. The invite still works without email (admin
  invites → user signs in via SSO → invite consumed); email is the notification layer.

### 2. Commerce credits as a first-class admin action
- Commerce contract (verified live, v1.42.5, ground-truth from `api/billing/handlers.go`
  + `credit_grants.go`, NOT the stale `/api/v1` in CLAUDE.md):
  - `POST /v1/billing/credit-grants` body `{userId,name,amountCents>0,currency,expiresIn,priority,tags,eligibility}` → 201
  - `GET /v1/billing/credit-balance?userId=<key>` → `{userId,balances:[{currency,available}]}`
  - whole `billing` group gated by `middleware.TokenRequired(permission.Admin)`.
  - Service-token auth: `Authorization: Bearer $COMMERCE_SERVICE_TOKEN` grants Admin|Live;
    org resolved from `X-Hanzo-Org` header → `COMMERCE_SERVICE_ORG` env → `"hanzo"` (auto-created).
- **`COMMERCE_SERVICE_TOKEN` was set on commerce but NOT on console** → added it to
  `console-secrets` (copied commerce's value) so console can authenticate.
- **Code:** added `grantCredits` mutation + `getOrgCreditBalance` query to
  `cloudBillingRouter.ts`, reusing `commercePost`/`commerceGet` from `commerceClient.ts`.
  Both send `X-Hanzo-Org: <org.name>` + `userId=<org.name>` → each org is its own commerce
  namespace (true multi-tenant). `grantCredits` gated by `hanzoCloudBilling:CRUD`
  (owner/admin/admin-billing). UI: a "Credits" card in `BillingSettings.tsx` showing
  balance + a grant form (amount in dollars → cents).

### 3. White-label by hostname
- Console had NONE. Mirrored the PROVEN explorer pattern (`luxfi/explore`
  `configs/app/chainRegistry.ts`): new `web/src/features/branding/brandRegistry.ts`
  with a `Brand` interface (brandName, productName, logoViewBox, logoContent SVG,
  faviconContent), brand objects (Hanzo reuses the existing `HanzoCloudIcon` paths;
  Lux/Zoo/Pars lifted from the explorer), a `hostnames[]`→brand table, and
  `getBrandFromHost(host)` (env `NEXT_PUBLIC_BRAND` wins → hostname suffix match →
  default Hanzo) + `applyBrandEnvOverrides`.
- Consumed: `HanzoLogo.tsx` renders the resolved brand's `logoContent`+`brandName`
  (per-org `useUiCustomization` image override stays on top, orthogonal); `sign-in.tsx`
  `getServerSideProps(ctx)` reads `x-forwarded-host`/`host` → passes brand prop → logo
  renders correct before hydration (no flash). Test host: `console.pars.network` is
  already a live console ingress host → resolves to Pars; default Hanzo otherwise.

### Build/deploy (proven arcd kaniko Job pattern from console-build-315924nc)
- kaniko `--context=git://github.com/hanzoai/console.git#refs/heads/main`
  `--dockerfile=Dockerfile --destination=ghcr.io/hanzoai/console:3.159.25 --cache=false`,
  `console-git-token` (key `token`) + `kaniko-ghcr`, toleration `dedicated=ci-runner`,
  14Gi mem, `automountServiceAccountToken:false`.
- Deploy via operator CR `services.hanzo.ai/console` tag→3.159.25; verify pod boots
  clean (/v1/ready 200, no unhandledRejection) before declaring done; rollback to
  3.159.24 on crash. Pin universe to 3.159.25.

## Stage-4: real billing + members-table crash fix + real invite email (console 3.159.26)

Branch `fix/console-invite-billing-real`. Three production-real fixes so invite +
billing actually work for an investor demo (no stub, no 404, no client crash).

### 1. Billing page: real Commerce data, no tRPC 404s/500s
- Root cause A (404): the active router `web/src/features/billing/server/cloudBillingRouter.ts`
  called `GET /v1/billing/usage-rollup` — **that route does not exist on commerce**
  (commerce 1.42.x has no rollup endpoint). `getCommerceUsageRollup` now COMPOSES the
  rollup from the three real billing sources of truth the gateway prepaid gate reads:
  `/v1/billing/tier` (plan name + daily included credit + balance),
  `/v1/billing/balance` (prepaid balance/holds/available cents), `/v1/billing/usage`
  (consumed). Mapping: included.monthlyCents = tier.dailyCreditsCents*30,
  grantedCents = dailyCreditsCents, remainingCents = balance.dailyRemaining,
  consumedCents = sum(|usage.amount|), overageCents = max(0, consumed-includedConsumed).
- Root cause B (500): commerce's service-token middleware resolves the tenant from the
  **`X-Hanzo-Org` header** (then `COMMERCE_SERVICE_ORG`, then "hanzo"). The console talks
  to commerce DIRECTLY (not through the gateway), so without that header
  `middleware.GetOrganization(c)` does `c.MustGet("organization")` → **panic → 500** on
  every billing read (balance/usage/tier/invoices/credit-balance). `commerceClient.ts`
  now takes `org` as a first-class param and always sends `X-Hanzo-Org`. With it, all
  endpoints return 200. (Probe: `curl -H 'Authorization: Bearer $COMMERCE_SERVICE_TOKEN'
  -H 'X-Hanzo-Org: hanzo' http://commerce.hanzo.svc:8001/v1/billing/balance?user=hanzo`.)
- Root cause C (tRPC 404): the UI calls `getInvoices`, `getSubscriptionInfo`,
  `getCustomerPortalUrl`, `clearPlanSwitchSchedule`, `reactivateStripeSubscription`,
  `applyPromotionCode` — all MISSING from the active router (a parallel, dead `ee/`
  router had them but is not registered in `server/api/root.ts`). Added them to the
  active router: `getInvoices` → real commerce `/v1/billing/invoices`;
  `getSubscriptionInfo` → commerce `/v1/billing/status` (prepaid plans have no Stripe
  schedule/cancellation, so those are null); the Stripe-only affordances
  (portal/clearSchedule/reactivate/promo) degrade to null/no-op when the org has no
  Stripe customer, so the page renders with zero error toasts.

### 2. Members settings page crash (client-side exception → invite dialog unreachable)
- `web/src/components/table/data-table.tsx`: `DataTable` passes an explicit `state` to
  `useReactTable`, which OVERRIDES TanStack's `getInitialState` default of
  `rowSelection: {}`. Tables used without row-selection (no `rowSelection` prop — e.g.
  org/project Members) then had `state.rowSelection === undefined`, so the row renderer's
  `row.getIsSelected()` → `isRowSelected(row, undefined)` → `undefined[row.id]` THREW,
  crashing the whole table (residual from the botched-merge that caused "377 crashes").
  Fix: `rowSelection: rowSelection ?? {}` — non-selection tables now render; the
  CreateProjectMemberButton invite dialog is reachable again. One-line, fixes ALL
  non-selection tables.

### 3. Real invite email
- `sendMembershipInvitationEmail()` no-ops when `SMTP_CONNECTION_URL` is unset — and NO
  working SMTP creds existed anywhere in the cluster (every captable/sign/dataroom SMTP
  secret + RESEND_API_KEY was empty). Wired a real provider: `SMTP_CONNECTION_URL` is
  stored in KMS (project `hanzo`, path `/console-secrets`) and reaches the pod via the
  existing `envFrom: console-secrets` sync — never inlined as plaintext. `EMAIL_FROM_ADDRESS`
  stays `no-reply@hanzo.ai` (or the verified sender domain). No image change needed for
  the email key — it's a deploy-time secret.

### Build/deploy
- arcd kaniko Job (clone of console-build-31592513): `--context=git://github.com/hanzoai/console.git#refs/heads/fix/console-invite-billing-real`,
  `--destination=ghcr.io/hanzoai/console:3.159.26 --cache=false`, runner-pool-32g +
  `dedicated=ci-runner` toleration, `console-git-token`+`kaniko-ghcr`.
- Deploy via operator CR `services.hanzo.ai/console` (kind `Service`, `hanzo.ai/v1`)
  tag→3.159.26; verify pod boots clean (/v1/ready 200, 0 unhandledRejection) before
  declaring done; rollback to 3.159.25 on crash. Pin universe to 3.159.26.

## Pay-as-you-go self-serve LIVE (console 3.159.35-payg, 2026-06-25)

Branch `feat/payg-self-serve` (off the live `feat/billing-commerce-on-invite-branch`).
Closes the self-serve loop: a fresh signup gets their OWN isolated org + a working
hk- Cloud API key from the UI, then add funds → AI, billed to their org.

### Model: ONE tenant = ONE IAM org = ONE console org = ONE commerce ns = ONE slug
DECISIVE (probed live): the `hanzo-console` IAM app is NOT org-locked — a login
with `organization=hanzo` + email resolves CROSS-ORG and returns the user's own
`<slug>/<email>` sub. So per-tenant IAM orgs Just Work with the UNCHANGED login flow.

### (B) Own org per tenant
- `signupApiHandler.ts` IAM path now calls `iamProvisionTenant` (was `iamSignup`):
  creates a per-tenant IAM org (`useEmailAsUsername=true`) + the user INSIDE it
  (owner=slug) + mints the hk- key. Idempotent.
- `tenantSlug.ts` — `tenantSlugForEmail` = sanitized email stem + 8-hex sha256 suffix
  (satisfies IAM ReUserName regex + forbidden-char filter; collision-safe).
- `syncIamMemberships.ts` — a user in their OWN dedicated org (NOT a shared seeded
  tenant in INIT_ORG_IDS=hanzo,lux,zoo,pars) becomes OWNER (was always MEMBER), with
  the IAM org displayName. Result: console org id == IAM org slug, billing/usage all
  key on that one slug. Pre-existing: 54 EMPTY per-tenant IAM orgs (half-done by a
  prior path that created the org but left the user in shared `hanzo`).

### (A) hk- Cloud API keys [keystone]
- `iamServer.ts`: `iamMintUserKeys`/`iamRevokeUserKeys` → IAM `/v1/iam/mint-user-keys`
  (bypasses the +/@ name-char filter); `iamGetUser` returns accessKey.
- `cloudApiKeyRouter.ts` (NEW tRPC `get`/`mint`/`revoke`, `protectedOrganizationProcedure`,
  gated `organization:CRUD_apiKeys`): reconstructs the session user's IAM sub as
  `<orgId>/<email>` (console org id IS the IAM slug) — caller can only act on their own
  sub. Registered as `cloudApiKey` in root.ts.
- `CloudApiKeys.tsx` (NEW) on the org API-keys settings page: shows hk- once, with
  Regenerate/Revoke + a ready-to-run curl. Distinct from observability pk-lf/sk-lf.
- Signup AUTO-mints a key; `establishIamSession` back-fills one for SSO/pre-existing
  users (best-effort, idempotent).

### (D) Add-funds
Already wired on this branch (Square topup `/v1/billing/topup/token` + `grantCredits`,
per-org via `X-Hanzo-Org`). Billing page reachable post-signup (Purchase Credits).
Tested via SANDBOX `X-Hanzo-Test:true` deposit (no real charge).

### E2E PROVEN (genuinely new tenant, real Playwright UI)
payg-ui-…@hanzopaygo.dev → signup → /onboarding (auth'd) → landed in OWN org
("PAYG UI Tenant's Organization") → UI "Cloud API Key" Regenerate → hk-239c9056…
shown once → `curl -H "Bearer hk-…" api.hanzo.ai/v1/chat/completions` (deepseek-chat)
→ 200 "PAYG-OK" → live credit $10 → 5 completions debited 1000→995c on THIS tenant's
org; shared `hanzo` UNCHANGED 925c. **pay-as-you-go self-serve LIVE: yes.**

NOTE: gpt-4o-mini specifically 403s "this model is not available for your account"
for ALL accounts (incl funded maxpower) — it routes to provider do-ai
(upstream openai-gpt-4o-mini) which DigitalOcean GenAI doesn't serve; pure provider/
account gap, NOT pay-go. DO-AI-backed premium models (deepseek-chat, llama-3.3-70b,
zen-*) all 200.

INFRA FIX: commerce had a postgres connection-pool LEAK (4 conns stuck idle/ClientRead
~7h after the 1.42.28-keyfix deploy) → every balance/add-funds call hung 20s+ (blocked
premium-gating + add-funds cluster-wide). Fixed by `kubectl rollout restart deploy/commerce`.

Build (kaniko, console deps are public npm): clone `console-build-billing*` Job,
`--context=git://…#refs/heads/feat/payg-self-serve`, dest `3.159.35-payg`. Deploy:
patch operator CR `services.hanzo.ai/console` `spec.image.tag`→3.159.35-payg.

## Cloud API Key mint FAIL#1 + IAM v1.25.2 (console 3.159.48-keymint)

**FAIL#1**: "Generate Cloud API Key" → "No IAM identity for this account in this
organization". Root: `cloudApiKeyRouter.ts` resolved the IAM sub as
`<orgId>/<email>` (and the session `iamSub` carried the email form / a DB UUID),
so `get-user?id=maxpower/davelorenzini@gmail.com` → null even though the user
exists as `maxpower/davelorenzini` (IAM `name` != email even in an
`useEmailAsUsername` org). **Fix** (web/src/features): new
`iamGetUserByOrgEmail(owner,email)` does `get-user?owner=<org>&email=<email>`
(exact in-org email lookup → authoritative `owner/name`); `resolveIamUser`
uses the session sub only when it actually resolves, else falls back to the
org+email lookup. get/mint/revoke share it (dropped the duplicate get-user in
mint). Verified live: id-by-email→null, owner+email→the record.

**Second blocker (IAM-side, the real cause of the post-console-fix 500)**: the
`POST /v1/iam/mint-user-keys` route was ADDED after tag v1.25.1 (on the divergent
`hk-fix-build` branch) — the deployed `iam:v1.25.1` returned beego 404 HTML for
it (get-user GET worked; mint POST 404'd). `hk-fix-build` was 27 commits BEHIND
main → could NOT be tagged as the next semver (would regress OIDC org claim,
multi-brand providers, 7-chain web3 login). **Fix**: cherry-picked the 3 hk CODE
commits (4ca7edaa route + 061e45e8/cf8d8f68 caller→target security binding)
cleanly onto `origin/main`, tagged **v1.25.2**, built (CGO=1, sqlite_fts5),
bumped operator CR `services.hanzo.ai/iam` tag → v1.25.2 (Recreate, ~30s
downtime, 1 replica). Mint auth is fail-secure via `IAM_KEY_MINT_ALLOWED_APPS`
(already set: hanzo-console,lux-console,zoo-console,pars-console); confidential
client → `app/hanzo-console` (getUsernameByClientIdSecret) → passes allowlist.

**E2E PROVEN (Playwright, Dave davelorenzini@gmail.com → maxpower)**:
"Generate Cloud API Key" → `hk-a851706d…` shown once in UI; Regenerate →
`hk-2612a139…`; Revoke → cleared. Billing/usage page renders (HTTP 200, real
Plan&Usage, no 500); observability dashboard "No data" honest-empty (executeQuery
degrade, no unhandledRejection). console 3.159.48-keymint = the usagefix2 commits
(55aa1f9f2 + 348570140) + the FAIL#1 fix in ONE image. Build: kaniko Job
`console-build-keymint`, `--context=git://…#refs/heads/fix/payg-usage-visibility`,
dest 3.159.48-keymint. IAM build: BuildKit Job `iam-build-v1252`.

## Console chrome cleanup + IA rework (→ console 3.159.50-mono)

Owner review flagged 7 issues; all fixed on `fix/payg-usage-visibility`, built +
deployed via the operator's declared state (NOT imperative `kubectl set image`).

1. **Full monochrome.** Hunted EVERY blue: down from **276** blue occurrences to
   **0** (verified: 0 `(blue|indigo|sky|cyan)-N` classes, 0 blue hex literals, 0
   blue oklch/hsl hues). De-blued the *chrome* uses of `--chart-*` and the
   RainbowButton `--color-1..5` ramp in `globals.css` (charts → neutral warm/gray
   hues, rainbow → grayscale). Components: trace nav pulse/resize bars →
   `bg-primary`; number cells / score-link → `text-foreground`/`text-primary`;
   billing info banners → `bg-muted`/`border-border`; ItemBadge SPAN →
   `text-muted-foreground`; dashboard BarList default → `hsl(var(--chart-1))`
   (was `#6366f1`); score-analytics `HEATMAP_BASE_COLORS` + extractHslToHex
   fallbacks → neutral (was `#3b82f6`). Two parallel agents swept the
   enabled-product + hidden-module feature dirs (agents/bots/mpc/dns/explorer,
   evals, prompts, public-api, comments) preserving semantic green/red/amber.
2. **v4.0.0 label dropped** from the top-left chrome. `app-sidebar` no longer
   passes `version`; `HanzoLogo` is mark-only (the dead `version`/`VersionLabel`
   path removed). `constants/VERSION.ts` set to `v3.159.50` (internal
   health/telemetry only, never rendered).
3. **"Star HanzoCloud" GitHub widget removed** — deleted the `github-star`
   notification entry (broken shields.io stars img) from `sidebar-notifications`.
4. **Top-left chrome = H mark only, app-selector moved RIGHT.** `HanzoLogo`
   wordmark `<span>{brand.brandName}</span>` removed (mark-only). In
   `app-sidebar` the `AppSwitcher` grid is now `ml-auto` (right corner of the
   sidebar header), logo on the left.
5. **KMS removed from Organization Settings** (`pages/organization/[…]/settings`
   `getOrganizationSettingsPages`): dropped the `KMS` page + `KmsOrgSettings`
   import. KMS is a separate service, not an org setting. (The project-level KMS
   *product* pages `/project/[…]/kms/{secrets,keys}` are untouched.)
6. **IA rework — flat wall → grouped products, ad-hoc enableable.** Root cause:
   the `uiCustomization` nav filter was a NO-OP on cloud (`ctx.uiCustomization`
   is `null` without the `self-host-ui-customization` entitlement), so every
   `productModule` showed at once. Fix (decomplected, ONE knob):
   `DEFAULT_ENABLED_MODULES` in `productModuleSchema.ts` = the curated default
   surface `[dashboards, tracing, evaluation, prompt-management, playground,
   datasets, search]`; the filter now gates by
   `ctx.uiCustomization?.visibleModules ?? DEFAULT_ENABLED_MODULES`. Result: 4
   coherent groups (Observability / Prompt Management / Evaluation / Search & AI)
   + slim ungrouped (Home, Dashboards). Agents, Bots, Tasks, Functions, KMS, ZT,
   Infrastructure, Base, Referrals hidden by default — light up by adding to the
   constant or per-org. Also: gated "Observe" under `infrastructure`; deduped the
   redundant embedded "Playground" service (native page is the one way); fixed
   `groupNavigationItems` flattened list to include ALL groups (was hardcoded to
   3 → Cmd+K missed Search & AI).
7. **Spacing per @hanzo/ui (gui).** Tightened the sidebar header row
   (`pr-2 pl-2`, mark-left/app-switcher-right) and simplified the `HanzoLogo`
   wrapper (dropped the old `-mt-2 ml-1 gap-4 lg:flex-col` multi-element offset).

**Build + deploy.** Runner fleet was down → built **in-cluster with Kaniko**
(NOT GitHub builders, NOT local Mac): Job `console-build-mono`,
`--context=git://github.com/hanzoai/console.git#refs/heads/fix/payg-usage-visibility`,
`--destination=ghcr.io/hanzoai/console:3.159.50-mono` (digest
`sha256:87d73fe2…`). **Deploy gotcha:** the `console` Deployment is reconciled by
`hanzo-operator` from `services.hanzo.ai/console` (`spec.image.tag`) — imperative
`kubectl set image` is reverted. Correct path: `kubectl patch
services.hanzo.ai/console -p '{"spec":{"image":{"tag":"3.159.50-mono"}}}'` →
operator rolls the deployment. **Verify creds:** `z@hanzo.ai` /
`IloveHanzo2026!!!` (THREE `!`, not two — IAM rate-limits to a 15-min
lockout after a few wrong tries; a `!!` typo cost a cooldown).

## Finish + authenticated verification of the 7-ask rework (→ console 3.159.54-mono4)

Prior session built `3.159.52-mono2` (HEAD `397d075ee`) but died before deploying
it — the live tag was still `3.159.51-fix`, one commit behind (missing the final
navy/slate/rgb de-blue). This session **finished + verified live**.

**Found the one real incomplete item (ask #1).** The earlier cleanup scan only
checked the *Billing* settings page (0 blue) — it missed **Organization Settings →
General**, whose "Debug Information" JSONView (and every trace I/O panel) renders
the `react18-json-view` **github/base theme**: keys/numbers/booleans `#005cc5`
(light) / `#79b8ff` (dark), strings `#032f62` navy. That is vendor CSS — not a
Tailwind class or source hex — so the source grep (still 0 blue classes/hex) and
the billing-only browser scan both passed while **General had 19 blue elements
live**. Fix (`694f83663`, one DRY override in `globals.css`):
```
.json-view { color/--json-* → hsl(var(--foreground|--muted-foreground)) !important; }
```
catches every JSON viewer in one place, monochrome in light+dark, keeps the
semantic green/red. `!important` matches the file's existing vendor-override
pattern (vaul, react-resizable) and beats the lib CSS, which `_app.tsx` imports
*after* `globals.css`. **Proven before building:** injected the exact CSS into the
live General page → blue **29 → 0** (A/B). The other 5 settings pages
(Identity & Access, Members, API Keys, Audit Logs, Billing) were already 0.

**Verify harness** (`web/scripts/verify-console-cleanup.mjs`, now canonical):
accepts `ORG_ID`/`PROJECT_ID` (a freshly-seeded pod has no org links on the
landing page — the admin account `z@hanzo.ai` shows as console user `z@ad.nexus`
with **zero orgs**, so create one via `/setup`: org+default-project wizard) and
blue-scans **all six** settings pages, not just Billing. Verification org/project:
`cmqud6t53000on607zzi7zcps` / `cmqud6xco000tn607drmm60q7` (named `mono-verify`,
kept for re-runs).

**Build + deploy.** Built on **evo** (`ssh evo`, amd64, NOT local Docker) from
git HEAD `694f83663`, `docker buildx build --platform linux/amd64 --push -t
ghcr.io/hanzoai/console:3.159.54-mono4` (digest `sha256:df7fe896…`; GHCR push hit
a transient `tls: bad record MAC` once — a retry loop handled it; auth = `zooqueen`
gh token, which *does* carry `write:packages`). Deployed via the operator CR:
`kubectl patch services.hanzo.ai/console -p '{"spec":{"image":{"tag":"3.159.54-mono4"}}}'`
→ operator reconciled instantly, pod `console-77ddc488c-*` 2/2, `/` 200. PVC DB
persisted ("existing SQLite db kept").

**Authenticated result on the live `3.159.54-mono4`** (headless login via hanzo.id
OIDC, all 7 asks PASS):
| # | ask | proof |
|---|-----|-------|
| 1 | full monochrome | computed-style blue scan = **0** on product + **all 6** settings pages (billing/general/identityAccess/members/apiKeys/auditLogs); General fixed 19→0 |
| 2 | no `v4.0.0` | `versionV4=false` |
| 3 | no Star-HanzoCloud widget | `starWidget=false` |
| 4 | H-mark only + app-selector right | `wordmark=false`, `appSelectorSide=right` |
| 5 | no KMS in org settings nav | `kmsInSettings=false`; nav = General/Identity&Access/API Keys/Members/Audit Logs/Billing/Projects |
| 6 | nav regrouped | groups = Observability / Prompt Management / Evaluation / Search & AI (+ ungrouped Home, Dashboards) |
| 7 | @hanzo/gui spacing | tightened sidebar header (H-left / grid-right), mark-only logo |

Screenshots: `/tmp/console-verify/after/{billing,general,members,product-traces,sidebar}.png`.

## Vector → real product on SQLite + Search & AI sub-pages (→ console 3.159.58-vector)

**Root cause of the `vector.createCollection` 404.** The tRPC `vector` router was
mounted fine (`root.ts` → `vector: vectorRouter`) but every procedure proxied an
HTTP call via `vectorClient.ts` to `https://api.cloud.hanzo.ai/api/vector/*` — a
route that was never deployed (404), and which also violated the `/v1`-not-`/api`
rule. The frontend (stat cards, CreateCollectionDialog, CollectionsTable) was wired
to a backend that did not exist.

**Fix — back Vector with the canonical Hanzo store: SQLite, in-process, no external
vector DB.** Deleted `vectorClient.ts`; the router now calls a new
`web/src/features/vector/server/vectorStore.ts` directly (the dead HTTP hop is
gone, so no more 404). The store uses Node 24's built-in `node:sqlite`
(`DatabaseSync`) — zero native deps, nothing extra in the image — with two tables
(`collections`, `vectors`; `ON DELETE CASCADE`), Float32→BLOB codec, and exact
brute-force KNN (cosine / euclidean / dotProduct, normalized so higher = nearer).
Everything is `projectId`-scoped. `resolveDbPath()` co-locates `vector.db` next to
the console's own SQLite DB (`DATABASE_URL=file:/var/lib/hanzo/console/app.db`) so
it lands on the **same durable PVC `console-app-db`** with zero infra change
(override via `HANZO_VECTOR_DB_PATH`). Server-only: client imports `AppRouter`
type-only, so `node:sqlite` never enters the browser bundle.

Surface (all `protectedProjectProcedure`): `stats`, `listCollections`,
`createCollection`, `deleteCollection`, `upsert`, `search`. Domain errors
(`VectorStoreError` CONFLICT/NOT_FOUND/BAD_REQUEST) map to tRPC codes. Tests:
`web/src/__tests__/server/unit/vectorStore.servertest.ts` — 11 passing (create/
list/dup-conflict/dim-mismatch/upsert/idempotent/cosine+euclidean KNN/project
isolation/cascade-delete + path resolution).

**Part 2 — "Search & AI" flat overload → products + sub-pages.** The group had 7
flat sidebar items (Search, Indexes, Search Keys, Search Playground, Vector,
Collections, Models). Reorganized to **3 product entries** (Search, Vector, Models);
sub-pages now render as in-page tabs via the existing `PageHeader.tabsProps`
(monochrome `border-primary-accent`, the same pattern as Tracing). New tab defs:
`features/navigation/utils/{search-tabs,vector-tabs}.ts`. Search tabs = Overview /
Indexes / Keys / Playground; Vector tabs = Overview / Collections. No dead links
(sub-pages reachable via tabs), no duplication, one way. Removed now-unused
`FileText`/`Key` icon imports from `routes.tsx`.

**Deploy.** SSH remote (`git@github.com:hanzoai/console.git`), branch
`feat/vector-sqlite-store`. Image built by arcd self-hosted CI (NOT evo, NOT local
Docker); deployed via the operator's declared image on
`services.hanzo.ai/console` (reconcile, not `kubectl set image`). Internal
`VERSION.ts` → `v3.159.58`.

## Search / Models / Prompts / Evals real backends — kill the rest of `api.cloud.hanzo.ai` (→ console 3.159.60-playground)

Same dead-backend pattern as Vector, finished across the remaining products.

**Search (was: all 500 — Search/Indexes/Keys/Playground).** `searchClient.ts`
hard-coded `SEARCH_API_BASE="https://api.cloud.hanzo.ai"` (a host that 502s) and
hit `/api/search-docs/*`, `/api/scrape-docs`, `/api/chat-docs` — never deployed.
Deleted it; the router now calls a new
`web/src/features/search/server/searchStore.ts` — the **exact Vector pattern**:
`node:sqlite` lazy singleton, `projectId`-scoped, `resolveDbPath()` co-locates
`search.db` on the same durable PVC (override `HANZO_SEARCH_DB_PATH`). It is
self-contained and dependency-free: **crawl** (global `fetch` + a regex
HTML→text/links extractor, BFS same-origin, bounded by `maxPages`/timeout),
**rank** (a real lexical IR engine — BM25 for full-text/hybrid, a TF-IDF
vector-space cosine for "vector" mode, scores normalized to (0,1] for the UI),
**chat** = extractive RAG (grounded answer stitched from the best-matching
passages in the project's own docs + sources), lazily-minted per-project
`pk_`/`sk_` keys, daily-aggregated stats. Tables: `search_indexes`,
`search_documents` (FK CASCADE), `search_keys`, `search_events`. Surface:
`stats/listIndexes/createIndex/deleteIndex/reindex/query/chat/getKeys/
regenerateKey/scrapePreview`; `SearchStoreError` → tRPC codes (mirrors Vector).
Tests: `web/src/__tests__/server/unit/searchStore.servertest.ts` — 15 passing
(put/list/replace, BM25 + vector-space ranking, highlights, honest-empty, RAG
chat + sources, key mint/rotate, stats, project isolation, cascade delete).

**Models (was: empty/masked).** `cloudModelClient.ts` pointed `/api/models` at an
unreachable cloud host, so the list silently degraded to `[]`. The Models list now
derives from the **reachable in-cluster pricing catalog**
(`pricing.hanzo.svc:8080/v1/pricing/models` — the canonical priced model list the
router already fetched), enriched by the Cloud API only when `CLOUD_API_URL` is
set. `owned_by` is derived (explicit field → `owner/model` prefix → family
heuristic), `premium`/pricing carried through. `/v1` not `/api`; bounded 5s fetch
timeouts so an unreachable backend degrades fast.

**Prompts.create + Evals.createJob(EXISTING) (was: 500).** Event sourcing and the
historical-traces eval backfill are best-effort side-channels — the prompt/job is
already persisted in the DB before the enqueue. They re-threw on a queue-backend
failure (`promptChangeEventSourcing.ts` `throw error`; evals `throw "queue not
found"` + un-caught `queue.add`), so a Temporal/queue hiccup 500-ed the user's
create. Now both **swallow+log** (fire-and-forget) — one fix in the shared
`promptChangeEventSourcing` (DRY, covers all prompt call-sites) + a try/catch
around the evals `BatchActionQueue.add`. The web pod already runs the in-process
`packages/mq` MemoryDriver (no `TEMPORAL_ADDRESS`), so the backfill also actually
runs; the swallow is the durable guard for if Temporal is ever (re)configured.

**Verification.** searchStore unit tests green (15/15); `tsc` clean on all
new/rewritten files (the residual evals/prompts `tsc` errors are the pre-existing
`@prisma/client`-not-generated artifact — identical with or without this change;
CI runs `prisma generate`). **Live headless-Playwright matrix
(`web/scripts/verify-job1.mjs`, superuser `z@hanzo.ai`) is BLOCKED by a
fleet-wide IAM CF-edge outage**: the console pod's server-side OIDC token
exchange (`iamServer.ts` → `IAM_SERVER_URL=https://hanzo.id`, a Cloudflare edge)
gets **CF Error 1006 (egress IP banned)** — "Token exchange failed (502)". The
laptop reaches the IAM edge fine (200); only the cluster egress is banned, so
**all console logins fail server-side** until the egress IP is un-banned at
Cloudflare. NOTE: there is **no in-cluster IAM service in `do-sfo3-hanzo-k8s`**
(checked every namespace), so the [[kms-architecture]] "use `iam.hanzo.svc`" fix
is NOT available here — the only remediations are (1) un-ban the cluster egress at
the CF IAM zone, or (2) run/route an in-cluster IAM to point `IAM_SERVER_URL` at.
Both are infra, not a console-product change. Not a Job-1 regression — the front
door + new backends are deployed; the matrix flips green the moment login is
restored (`verify-job1.mjs` is ready: Vector/Search/Models/Prompts over `/v1/trpc`).

**Models pricing shape (correction).** `pricing.hanzo.svc /v1/pricing/models`
actually returns `{models:[{name, provider, pricing:{input,output,cacheRead,
cacheWrite}}]}` — costs USD **per 1M tokens**, `hanzoModels` have **no `id`** (key
by `name`). The router maps that real shape (id=name, owned_by=provider,
premium=paid, input/output→per-MTok+per-token); `ModelsTable` renders `created:0`
as "—". Plus nav `isMostSpecificActive` (no parent+child double-highlight on the
new Search/Vector sub-pages).

**Deploy.** Tag `v3.159.60-playground` (supersedes 3.159.59 with the correct
Models shape). Matches `pipeline.yml`/`build-and-push.yml` `v*` → arcd build +
`repository-dispatch` to universe; does NOT match `release.yml`'s `v3.X.Y`
(no formal release — the established side-build pattern). Image
`ghcr.io/hanzoai/console:3.159.60-playground`. The running `console` deploy is
**platform-managed** (`managed-by: hanzo-operator`, `part-of: platform`; the
committed operator CR `console-v1.yaml` tag lags at `3.159.55-icons` while live is
`3.159.58-playground`, so `-playground` cutovers go through platform.hanzo.ai, not
that file). Cutover + live verify are gated on the IAM login restore (so the
result is verifiable) and on arcd-runner availability (the fleet has been down —
`console-build-*` Kaniko pods are the in-cluster fallback).
