# console2 — Hanzo Cloud Console

Unified admin console for **Hanzo Cloud** and all cloud products. Our code,
BSD-3-Clause, built on **@hanzo/gui** (the Tamagui-based cross-platform UI).
NOT a Langfuse fork, NOT casibase — it is a clean client over the unified `/v1`
backend (`hanzoai/cloud`, the casibase API at https://cloud.hanzo.ai/v1/*).

## Base: Next.js 15 (app router) + @hanzo/gui

The @hanzo/gui `expo-router` template was evaluated first and **rejected for a
standalone repo**: it declares `workspace:*` dependencies (`hanzogui`,
`@hanzogui/config`, `@hanzogui/babel-plugin`, …) that only resolve inside the gui
bun monorepo — `npm install` of a copy fails with
`EUNSUPPORTEDPROTOCOL "workspace:"`. It is also native-first with no real
typecheck (`"test": "true"`), a poor fit for a data-heavy web admin.

So the base is **Next.js + @hanzo/gui (npm)**. Gui is consumed at **runtime**:
Next's built-in `transpilePackages` transpiles the Gui ESM packages (discovered
from `node_modules/@hanzogui`, not hardcoded) and `GuiProvider` injects CSS at
runtime. Gui is designed to work this way — the optimizing compiler is an
optimization, not a requirement.

The canonical `@hanzogui/next-plugin@7.3.0` is **broken on npm**: it depends on
`hanzogui-loader@7.3.0` (unpublished — only `2.x`/`102.x` fork tags exist), and
that fork renames the export the plugin imports (`GuiPlugin` → `HanzoguiPlugin`).
Pinning the fork via overrides surfaces the rename at build time. So the plugin
is unusable standalone; `transpilePackages` is the clean, supported path.

**v5 config uses `onlyShorthandStyleProps`** — components use Gui shorthand style
props (`p`, `px`, `bg`, `items`, `justify`, `self`, `rounded`, `minH`, …), not
longhands. With shorthands, `tsc --noEmit` (strict) passes clean and the build
type-checks with no suppression.

**Next 15, not 14:** @hanzo/gui requires `react>=19`. Next 14 ships React 18 and
cannot run React 19 (App Router server components are version-locked to the
bundled React). Next 15.5.x is the current stable that natively supports React
19 — so 15 is the correct, non-degrading choice. The task's "Next 14" is
impossible without downgrading Gui or breaking the peer tree.

## Layout

```
app/                         Next.js app router
  layout.tsx                 html shell, dark default, mounts <Provider>
  globals.css                base resets (Gui CSS injected via plugin)
  signin/page.tsx            sign-in (delegates to IAM)
  auth/callback/page.tsx     OIDC callback -> /v1/signin -> session
  (dashboard)/
    layout.tsx               AuthGate + DashboardShell
    page.tsx                 product overview cards
    [...slug]/page.tsx       catch-all: resolves a module+route from the registry
src/
  config/index.ts            single env reader (NEXT_PUBLIC_*), branding
  lib/
    api/                     typed /v1 client (ours)
      client.ts              core request: cookies, envelope unwrap, ApiError
      types.ts               Provider, ModelRoute, Application, Store, Chat, Account
      providers|model-routes|applications|stores|chats|account.ts
      index.ts               barrel
    auth/
      iam.ts                 @hanzo/iam-js-sdk wrapper (browser-only), getSigninUrl
      session.tsx            SessionProvider/useSession (account, signIn, signOut)
    products/
      registry.tsx           ProductModule[] — the extensibility backbone
      match.ts               slug -> {module, route, params}
  components/
    Provider.tsx             GuiProvider + next-theme + SessionProvider (dark)
    DashboardShell.tsx       sidebar (from registry) + topbar (adapts dashboard-shell recipe)
    AuthGate.tsx             gate authenticated routes
    SignInForm.tsx           adapts sign-in-form recipe; IAM redirect
    ui/                      PageHeader, DataTable, Field*
    products/
      ProvidersModule.tsx    FULL surface: list + view/edit
      providers/             logic.ts (pure cascade/visibility), List/Edit views
      ModelsModule.tsx       routes list <-> new/edit
      models/                logic.ts (newModelRoute), ModelRoute List/Edit views
      ApplicationsModule.tsx routes list <-> edit
      applications/          logic.ts (newApplication), List/Edit (deploy/undeploy)
      StoresModule.tsx       routes list <-> edit
      stores/                logic.ts (newStore), List (refresh-vectors)/Edit views
      ChatModule.tsx         routes list <-> read-only chat view
      chat/                  ChatListView + ChatView (message thread)
```

Each product module mirrors Providers: a router module (`<X>Module.tsx`), a
list view + an edit/view, and a pure `logic.ts` (new-record templates / option
lists). Every module declares a `''` (list) and `:name` (edit/view) route in the
registry; Models also handles `:name === 'new'` for create (model routes are
keyed by `owner/modelName`, so modelName is form-entered, not generated).

## /v1 backend client

One `request()` in `lib/api/client.ts`: always `credentials: 'include'` (the
backend sets a session cookie at `/v1/signin`), forwards `Accept-Language`,
unwraps the casibase `{ status, msg, data, data2 }` envelope, throws typed
`ApiError` (401/403 carry status). Base URL = `config.cloudUrl` (default
`https://cloud.hanzo.ai`, override `NEXT_PUBLIC_CLOUD_URL`).

Endpoint surface ported from `hanzoai/ai` `web/src/backend/*.js`
(see `docs/endpoints.md`):
- **ProviderApi** — get-global-providers, get-providers, get-provider,
  add/update/delete-provider, refresh-mcp-tools
- **ModelRouteApi** — get(-model-routes|-route), add/update/delete-model-route
- **ApplicationApi** — get(-applications|-application), add/update/delete,
  deploy/undeploy-application
- **StoreApi** — get-global-stores, get-stores, get-store, get-store-names,
  add/update/delete-store, refresh-store-vectors
- **ChatApi** — get-global-chats, get-chats, get-chat, add/update/delete-chat
- **AccountApi** — get-account, signin, signout

## Auth (Hanzo IAM)

`@hanzo/iam-js-sdk` against **`hanzo.id`** — the canonical OIDC issuer
(`iss=https://hanzo.id`), the one the cloud `/v1` backend validates. `getSigninUrl()`
builds the authorize URL (`https://hanzo.id/login/oauth/authorize?...redirect_uri=
<origin>/auth/callback`). IAM returns `?code&state`; the callback posts them to
`/v1/signin`, which the cloud backend exchanges and mints the session cookie;
`useSession` then loads `/v1/get-account`.

App/client is **`hanzo-cloud`**, org `hanzo` — NOT a console-specific app. console2
is a front-end OF the shared cloud `/v1` backend, which exchanges the code and
validates the token as app `hanzo-cloud` (`aud=hanzo-cloud`), so the browser MUST
present the same `client_id`. (The `hanzo-cloud` IAM app already whitelists
`https://console2.hanzo.ai/auth/callback`.)

**Build-time gotcha (the 2026-06 sign-in bug):** every `NEXT_PUBLIC_IAM_*` is
inlined at BUILD time (browser config), so the *image* — not runtime env — decides
the issuer. The mainnet image MUST bake `NEXT_PUBLIC_IAM_URL=https://hanzo.id`.
Baking `iam.hanzo.ai` (the legacy zone, `iss=https://iam.hanzo.ai`) dropped the user
on iam.hanzo.ai with an issuer mismatch. Fixed in `src/config/index.ts` (default),
`.env.example`, the `Dockerfile` ARG default, and the mainnet `iam_url` build-arg in
`.github/workflows/build-image.yml`.

## Product-module registry (extensibility)

`lib/products/registry.tsx` is the single source of nav + routing truth. Each
cloud product is a `ProductModule { id, label, icon, description, routes }`. The
sidebar, overview, and the catch-all route all render from it. **Adding a cloud
product = appending one entry + its module component(s); no shell or route
edits.** A module owns its routes and components and knows nothing about
siblings (orthogonal).

## Dev

```bash
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_IAM_CLIENT_ID for live auth
npm run typecheck            # tsc --noEmit (strict) — clean
npm run build                # next build (type-checks; Gui CSS injected at runtime)
npm run dev                  # http://localhost:4000
```

Data layer is the unified `/v1` backend — this repo is frontend only. Do NOT
add Postgres/Mongo/etc. Do NOT build Docker images locally (CI/CD does that).

## Cloud console — 10-category CLOUD AXIS + embedded PaaS (feat/cloud-taxonomy-10cat)

The catalog (`src/lib/products/registry.tsx`) is reorganized from 6 ad-hoc
categories to the canonical **10-category cloud axis** (the same taxonomy as the
hanzo.ai product surface, `/tmp/hanzo-cloud-taxonomy.md`), so console2 reads like
a cloud console (GCP/AWS) — resources grouped by cloud primitive, two rows of
five:

```
AI        Compute     Data        Network     Security
Dev       Deploy      Observe     Chain       Apps
```

**Three entry kinds, zero dead links, zero fakes** (`CatalogEntry.kind` +
`status`):
- `module`  — in-console admin surface (Providers/Models/Chat/Stores=Vector/
  Applications, + the embedded PaaS).
- `external`— a REAL Hanzo product on its own domain (Inference→api.hanzo.ai,
  Search→search.hanzo.ai, Bot→hanzo.bot, IAM→iam, KMS→kms, Observe/Traces/
  Dashboards→console.hanzo.ai, Analytics, Cost→billing, Object Storage→s3,
  Edge, Flow, Sign, Crawl, Studio).
- `soon`    — a real cloud primitive without a UI yet (GPUs, VPC, HSM, Settlement,
  …). Renders an HONEST in-console "coming soon" overview (`ComingSoon.tsx`,
  resolved by id from the path) that points at the API/CLI — **never a 404 and
  never a fabricated product card**. A `soon` entry is a `module` under the hood
  (single route → `ComingSoon`), so routing is unchanged.

The nav shell, catalog home, favorites, and router still render from the one
`catalog` list. `status: 'soon'` shows a "Coming soon" badge + affordance.

### Job 3 — PaaS embedded natively under Deploy (NOT an iframe)

`PlatformModule.tsx` is the embedded PaaS, wired to the REAL platform.hanzo.ai
control plane. The browser calls console2's OWN origin under `/paas/*`; the
server route `app/paas/[...path]/route.ts` forwards to `platform.hanzo.ai/v1/*`
with the service token from **server-only** env `PAAS_SERVICE_TOKEN` (sourced via
KMS — never `NEXT_PUBLIC_`, never in the browser bundle, no CORS). It lists real
apps across clusters with **declared vs running tag + drift** and a real
health-gated **redeploy** (`POST /v1/apps/<id>/redeploy`). The six Deploy
sub-pages (Projects/Environments/Builds/Registry/Releases/Pipelines) are tabs
over the same real inventory. States are honest: loading, **not-configured (501
when `PAAS_SERVICE_TOKEN` is unset)**, error, empty — it never invents rows.
To light up real data in prod: add `PAAS_SERVICE_TOKEN` (+ optional
`PLATFORM_URL`) to the console2 deployment env via a KMSSecret.

### Job 4 — no fake/placeholder/stub data

The catalog is honest by construction (every leaf → real module, real product
domain, or honest `soon` overview). The PaaS embed shows only real control-plane
data with honest empty/not-configured states. No lorem stats, no demo projects,
no placeholder cards.

Build: arcd self-hosted CI (`.github/workflows/build-image.yml`, push to `main` →
`ghcr.io/hanzoai/console2:v<package.json version>`, SEMVER only). The
`hanzo-build-linux-amd64` ARC runner pool is the builder (online; not GHA-hosted).

Deploy: console2 IS an operator `Service` CR now (`hanzo.ai/v1`, `hsvc console2`,
ns `hanzo`) — declared in `universe/infra/k8s/operator/crs/console2-v1.yaml`.
Bump `spec.image.tag`, `kubectl apply`, the operator reconciles. Verify live with
headless Playwright on console2.hanzo.ai.

## Live verification + backend wiring (v0.1.8)

> v0.1.7 was a parallel CTO branch (`fix/paas-live-data`) that wired only
> Clusters/Kubernetes/Status to the platform `/v1` surface; it is integrated here
> (`-s ours`) and superseded — v0.1.8 is the cumulative release with the full set
> below.

Every embedded module was Playwright-verified live against the real `/v1` backend
(authenticated hanzo-org admin). The backend topology console2 actually talks to:
the same-origin `/v1` ingress routes to **cloud-api** directly (NOT the full
api.hanzo.ai gateway), and `/paas/*` is console2's own server route → platform.

Findings + fixes (all in console2; honest states everywhere, no fakes):
- **X-Org-Id (the big one).** The provisioning sub-service (vector/sql/kv/s3/
  datastore/docdb/search) requires an `X-Org-Id` header and 403s `"X-Org-Id
  required"` without it — cloud-api on the direct path does NOT inject it from the
  session. Fix: `lib/api/client.ts` now stamps `X-Org-Id: config.iamOrgName`
  (brand org, the user's own) on every cloud call (`baseHeaders`). All 7 data
  modules now return real data / honest empty `[]`.
- **PaaS token was wrong.** The CR wired `PAAS_SERVICE_TOKEN` to
  `hanzo-paas/MASTERTOKEN` (`hanzo-master-token`), which platform.hanzo.ai
  **rejects (401)**. The correct token is in secret **`paas-console-token`** key
  `PAAS_SERVICE_TOKEN` (== `platform-service-token`). CR repointed there.
- **Platform contract was wrong.** The real platform serves `GET /v1/apps` (the
  apps inventory: declared/running/latest tag + drift + health + cluster +
  namespace, ~100 services) and `GET|POST /v1/org/{org}/cluster` — NOT
  `/v1/clusters` and NOT any `/k8s/{kind}` passthrough (those 401/404). `lib/api/
  platform.ts` reworked to `PlatformApi.apps()` + org-scoped `listClusters`/
  `provisionCluster`; dead `KubernetesApi`/`CLUSTER_ROUTES` removed.
  - **Status** now reads `/v1/apps` → REAL health board (Services/Healthy/Clusters).
  - **Kubernetes** now reads `/v1/apps` → REAL workloads per cluster (picker from
    the clusters that actually appear).
  - **Clusters** lists real dedicated DOKS via `/v1/org/{org}/cluster` (honest
    empty; provision form wired to the real endpoint). Attach-by-kubeconfig dropped
    (no backend).
  - `interpretPlatformError` maps upstream 401/403 → honest "not configured".
- **Bot** `/v1/bot/health` 404s on cloud-api (bot-gateway runs behind
  api.hanzo.ai/hanzo.bot, not this host) → honest "not routed on this host" state
  (was a red error).
- **Wallet** cloud-credit `/v1/billing/balance` 404s here (billing ships
  separately) → honest "not available on this deployment" (was a scary error).
  HUSD balance/top-up already honest "coming" (token unconfigured).
- **Providers was broken** — `ProviderListView`/`ProviderEditView` imported the
  ZAP twin (`~/lib/zap`), but the cloud `/zap` WS face is NOT served (the edge
  returns SPA HTML, 200 not a WS upgrade — documented in `lib/zap/client.ts`), so
  the module showed "Failed to load providers". Switched both back to the working
  REST `~/lib/api` (identical surface). The ZAP twin stays as the proof-of-pattern
  until `/zap` is bound. Providers now shows real/empty over REST like every module.
- Already-correct honest states (unchanged): IAM/Audit + KMS/Secrets (`/v1/iam`,
  `/v1/kms` 404 → "not available on this deployment"); Observability (`/v1/o11y`
  503 → "runtime not initialized"). Plans/Embeddings show real data; Models/
  Providers/Applications/Chat honest-empty.

`StatusTag` now also understands platform health verdicts (green/yellow/red).

## Working AI + API keys + chrome polish (v0.6.0)

The investor-demo wave. ROOT CAUSE of "chats/playground don't work": the gateway
chat endpoints REQUIRE `Authorization: Bearer` — a session cookie alone is
rejected ("Invalid API key format"). The browser sent cookie-only, so every AI
call (chat, playground, cmd+K `>`/`?`) failed. Fixed with two server routes that
keep all credentials server-side (the browser only ever sends its session cookie):

- **`app/ai/[...path]/route.ts`** — keyless AI proxy. Resolves the user from the
  session cookie (cloud `/v1/get-account`), mints a SHORT-LIVED user-bound IAM
  token (`/v1/iam/issue-user-token`, cached per-user until ~60s pre-expiry) as the
  confidential `hanzo-console` client, and forwards to `AI_GATEWAY_URL/v1/<path>`
  with `Bearer <token>`. Allow-listed to `v1/models|chat|chat/completions|
  embeddings|rerank` (not a general tunnel). `playground.ts` now points at this
  proxy (`<origin>/ai`), so Models/Playground/Chat/cmd+K all work with no key in
  the browser and no rotation on a chat turn.
- **`app/keys/route.ts`** — per-user `hk-` Cloud API key. POST mint/rotate, DELETE
  revoke, GET status (no secret). Same app-on-behalf pattern via
  `/v1/iam/mint-user-keys` + `/v1/iam/revoke-user-keys`. The `hk-` secret is shown
  ONCE (POST). `ApiKeysModule` is now create/copy/rotate/revoke.
- Shared trust boundary: `src/lib/server/identity.ts` (server-only) — `resolveUser`
  + `mintUserKey`/`revokeUserKey`/`issueUserToken`. The `hanzo-console` client is
  allow-listed in IAM `IAM_KEY_MINT_ALLOWED_APPS`; verified end-to-end that a
  minted `hk-` key and an issued user JWT both 200 on `api.hanzo.ai/v1/chat/
  completions`.
- **Chat is interactive** (`chat/ChatConversation.tsx`): a real multi-turn
  conversation over `AiApi.chat` (→ the `/ai` proxy), with a Zen default model,
  honest 402 "add credits" state, and a "History" toggle to the old session list.
- **Chrome**: the sidebar/header show the Hanzo **H mark + "Console"**
  (`ui/HanzoMark.tsx` + `ui/BrandLogo.tsx`; `BrandLogo` shows the org's IAM logo
  when set, else the H). A fullscreen **app launcher** (`components/AppLauncher.tsx`,
  Launchpad-style grid + filter) opens from the header "Apps" button, the sidebar
  grid icon, and the command palette's "Browse all apps". cmd+K stays the palette.

Server-only env the routes need (added to `console2-v1.yaml`, never `NEXT_PUBLIC_`):
`IAM_URL`, `CLOUD_API_URL` (in-cluster cloud-api), `AI_GATEWAY_URL` (api.hanzo.ai),
and `IAM_MINT_CLIENT_ID`/`IAM_MINT_CLIENT_SECRET` from secret `hanzo-console-iam-creds`.

## Admin console live data + org switching (v0.7.0)

The "models empty" + "org switcher broken" wave. ONE root cause: `/v1/iam`,
`/v1/kms`, `/v1/models` 404 (or 401 cookie-only) on the console host, so the
catalog, switcher, IAM, and KMS modules rendered honest-empty. Fix = route every
privileged call through console2's OWN server proxies (which add the user bearer +
the admin gate), and make org scope a first-class, switchable value.

- **Model catalog (the "models missing" bug).** `CloudModelApi.list()` hit cloud
  `/v1/models` with a cookie only → 401 → empty. Repointed at the `/ai` proxy via
  the shared `aiV1Url('models')` (`lib/api/client.ts` now owns `aiBase`/`aiV1Url` —
  ONE place defines the proxy origin; `playground.ts` uses it too). The proxy mints
  a short-lived user token, so the catalog populates with the live Zen models.
  Pricing stays best-effort on the cloud origin (degrades to "—", never fabricated).
- **Org scope is a value, not a place** (`lib/org-scope.ts`). `currentOrg()` /
  `setCurrentOrg()` / `isScopedAway()` / `filterOrgs()`. Default = the brand org;
  a global admin (z@hanzo.ai) can switch to ANY org. Brand identity (host wordmark/
  logo) is orthogonal and unchanged — only the DATA scope moves. `client.ts`
  `baseHeaders` now stamps `X-Org-Id: currentOrg()` (was the fixed brand org), so
  every cloud-data module re-scopes on switch.
- **OrgSwitcher** lists ALL visible orgs (`IamAdminApi.organizations()` via the
  `/admin/iam` proxy → global admin sees every org), adds a **filter** box
  (`filterOrgs`), and **switches in place**: `setCurrentOrg` + reload refetches
  every module under the new `X-Org-Id`. The IAM/KMS proxies authorize a global
  admin for any org and pin a brand admin to their own, so the re-scope is safe.
- **IAM module** (`AdminModule.tsx` `IamModule`/`AuditModule`) reads users/roles/
  records for `currentOrg()` (the org list itself is unscoped — what powers the
  switcher). **KMS module** (`KmsModule.tsx`) was a dead cloud-path probe; now a
  names-only inventory over `KmsAdminApi.list({ org })` (the `/admin/kms` proxy +
  kmsd's metadata-list endpoint, v0.159.4+). Values are NEVER fetched/rendered;
  honest states: loading, operator-access-required (403), listing-unavailable (404),
  empty.
- **Decomplected gate** (`lib/server/admin-policy.ts`, pure, tested). `gateAllows`
  (`@<adminDomain>` email AND IAM admin), `ownerAllowed`, `orgFor` — extracted from
  `getAdminGate` + the IAM/KMS routes so the SAME predicate that ships is the one
  unit-tested. A brand admin can never `orgFor` to another org's KMS (no secret
  leak across orgs).
- **Tests** (vitest, `npm test`): `admin-policy.test.ts` (gate allow/deny + tenant
  scoping), `org-scope.test.ts` (default→switch→reset + filter), `models-catalog.
  test.ts` (catalog fetches `<origin>/ai/v1/models`, never the cookie-only cloud
  path). RED→GREEN, 22 tests. `tsc --noEmit` + `next build` clean.
- The console2 CR already carries the env the proxies need (`IAM_URL`,
  `CLOUD_API_URL`, `AI_GATEWAY_URL`, `IAM_MINT_CLIENT_*`); `KMS_URL` defaults to
  `http://kms.hanzo.svc`. `admin.hanzo.ai` added to the CR ingress hosts.

## First-run org onboarding + waitlists (v0.7.8)

This release is based on the live GitHub `main` at `88d4c68` (v0.7.7), including
the org → project → environment scope model. `Projects` remains a single Deploy
module backed by the IAM project endpoints and the top-bar `ScopeSwitcher`; do
not add a duplicate Apps/Projects entry.

- **One instruction source.** `AGENTS.md` and `CLAUDE.md` are symlinks to
  `LLM.md`; keep agent guidance here only so Codex and Claude stay in sync.
- **First-run org onboarding.** `OrgGate` now sends signed-in users with no org
  to `OrgOnboarding` instead of a dead "no organization" state. The same-origin
  `/onboard` route acts as the confidential `hanzo-console` IAM client, creates
  a customer org (or personal org), moves the caller into it as admin, then the
  client re-authenticates so the new session carries the org. Normal privileged
  routes still use `resolveUser()` (org required); onboarding alone uses
  `resolveAuthenticatedUser()` so it can handle the zero-org session safely.
- **Coming-soon waitlists.** `ComingSoon` renders `WaitlistForm`, which posts to
  `/waitlist`. The server route requires a session and forwards to
  `WAITLIST_URL/v1/waitlist/join`; when `WAITLIST_URL` is unset it returns an
  honest 501 and never fabricates a confirmation.
- **Motion primitive.** `FadeIn` plus the single `.hz-fade-up` keyframe in
  `globals.css` is the shared entrance animation. It honors
  `prefers-reduced-motion`.

Server-only env added by this wave: `WAITLIST_URL` for waitlist forwarding. Org
onboarding uses the existing `IAM_URL`, `CLOUD_API_URL`, and
`IAM_MINT_CLIENT_ID`/`IAM_MINT_CLIENT_SECRET` confidential-client wiring.

## CI base image mirror (v0.7.9)

The ARC runner was still blocked by Docker Hub's unauthenticated pull limit while
pre-pulling `node:22-alpine`. `Dockerfile` now uses
`public.ecr.aws/docker/library/node:22-alpine` for all stages, and
`.github/workflows/build-image.yml` pre-pulls the same ECR Public Docker-library
mirror image. This keeps the host-builder cache behavior but removes Docker Hub
from the cold-runner path.

## Console parity audit + remaining feature ports (2026-06-29)

Old `console/web/src/pages/project/[projectId]` still had routes with no
console2 destination: experiments, dashboard/widgets, integrations
(blob-storage, Slack, Mixpanel, Insights), referrals, zero-trust, prompt
detail/create/metrics, dataset items/runs, annotation queue detail/items, and
score analytics. These are now represented in console2 without copying the old
Langfuse internals.

- `ConsoleFeatureModule.tsx` is the shared forward-compatible shell: each moved
  surface declares its exact `/v1` endpoint, renders real rows when the endpoint
  exists, and uses `BackendStateCard` for 404/405/503/access/billing. It never
  fabricates rows.
- New catalog entries: `experiments`, `integrations`, `referrals`, and
  `zero-trust`. `dashboards` is now a native module with an external handoff to
  analytics.hanzo.ai instead of external-only. `scores/analytics` is routed as a
  score subpage.
- Expanded existing modules: Prompts now has list/detail/create/metrics routes;
  Datasets has datasets/items/runs; Annotation Queues has queue detail + work
  items. `EvalsApi` and `O11yApi` carry the corresponding typed
  forward-compatible methods.
- Verification for this wave: `npm run typecheck` and `npm test` both pass
  locally (48 Vitest tests).

## Embeddings — full product surface (feat/embeddings-page)

The `embeddings` catalog entry is upgraded from the old single Stores admin
(`StoresModule`, now deleted along with `StoreListView` — superseded, not
duplicated) into a six-tab product over the REAL `hanzoai/ai` `/v1` backend.
`StoreEditView` + `stores/logic.ts` (`newStore`) are reused for the collection
editor + create; nothing is forked.

- **EmbeddingsModule** routes `''`→Overview, `:tab`→Overview/Explore/Collections/
  Jobs/Models/Settings, `collections/:name`→the store editor (unambiguous by
  segment count — same pattern as Models' `:tab`). The ONE create path
  (`add-store` + `newStore`) backs both the header "Create collection" and the
  Collections "New".
- **Collections = stores.** `EmbeddingsApi.collections` = `get-stores` → a
  `Collection` view-model; each maps to the Qdrant/Search index
  `{owner}-{store}-docs` (the backend's `GetSearchIndexName`). The store object
  carries NO vector count / dimension / index-size / `updatedTime`, and the metric
  is fixed to cosine at index-create — so those columns render an honest "—"
  (CREATED shows `createdTime`, the only timestamp; the metric is the real cosine).
- **Explore** → real `POST /v1/search?store=` (`{query,limit,mode}` → `{hits}`).
  Hits carry no per-hit score (backend RRF-drops it) so score reads "—";
  url/breadcrumbs are the locator. Model+Dimension are read-only collection
  metadata (search uses the store's own embedding config, not query-time).
  Vector-inspect is honest-empty (no point-lookup endpoint).
- **Models** = `/v1/models` filtered by id (no category field exists; many
  embedding routes are `hidden` and absent — honest); generate = real
  `POST /v1/embeddings` via the keyless `/ai` proxy (already allow-listed).
- **Jobs** = per-file index status (`get-files`: Pending/Processing/Finished/
  Error — there is no async job entity) + a real upload ingest
  (`POST /v1/docs/ingest`, source=upload).
- **Overview** metric cards (vectors/storage/queries/latency/cost) read
  `GET /v1/get-cloud-usages` — a forward-compatible client coded to the documented
  shape that degrades EVERY field to "—" with no sparkline today (the read API
  has no unique commits yet on `feat/cloud-usage-read-api`). The model donut is
  the real collection-by-model mix; dimension bars light up when metering reports
  per-dimension counts; index-health is per-collection state enriched best-effort
  with live `/v1/search/stats`.
- New: `src/lib/api/embeddings.ts` (`EmbeddingsApi`), the pure
  `components/products/embeddings/logic.ts` (+15 Vitest), and the dependency-free
  `components/ui/Charts.tsx` (Sparkline/Donut/BarChart — monochrome SVG, render
  nothing/"—" rather than a fabricated trend).
- Shared-infra touched: registry (`embeddings` row upgraded, not duplicated),
  `lib/api/index.ts` (barrel export). Reuses the unified `EmptyState`,
  `BackendStateCard`, `DataTable`, `PageHeader`, `PrimaryButton`, `Field*`.
- Drive-by: corrected a STALE assertion in `admin-policy.test.ts` — the
  `built-in` org-metadata owner was deliberately dropped in v0.7.15 (9b59dec,
  "standardize the global-admin org on 'admin'") but the test still expected the
  old wider allow-set; the gate code is unchanged (the tighter shipped policy is
  the correct one).
- Verification: `tsc --noEmit` clean, `vitest` 67/67 (8 files), `next build`
  green (14/14 pages). Authenticated visual e2e is gated behind a deploy + IAM
  session — left for live verification (the catch-all `/[...slug]` route that
  renders this compiled and type-checked).

## Native control planes — ZERO external link-outs + Hanzo Functions (claude/console2-native-control-planes)

Three deliverables, one PR, all over the one `/v1` surface (no `/api/` prefixes).

- **No external link-outs (the priority).** The catalog's `external` kind is GONE:
  `CatalogEntry` is now `module`-only and `ProductStatus` is `'enabled' | 'soon'`.
  Every product that used to open another domain in a tab (Gateway, DNS, CDN, MPC,
  CLI, SDKs, API, IDE, Desktop, Registry, Metrics, Crawl, Studio, Console) is now a
  native in-console route. They render ONE shared `NativeOverview`
  (`components/products/overview/NativeOverview.tsx`, wired via `overviewFor(id)` +
  `overviewRoutes(id)` in the registry — the DRY twin of `soonRoutes`): header +
  what-it-is, a REAL health band (probes `PlatformApi.apps()` for the product's
  operator service; honest "not deployed / not reporting" states, never a fabricated
  "operational"), key-fact cards (honest "—"), native primary actions (in-console
  routes only), and INLINE docs (rendered in-console; the docs SITE is a small
  secondary reference, never the way to use the product). Content is a pure
  `OverviewSpec` per product (`overview/spec.ts` + `resolve.ts` — a catalog-derived
  `defaultSpec` covers any product with no bespoke spec). The `external` branches in
  `open.ts`, `DashboardShell`, `AppLauncher`, `CommandPalette`, `ProductInterstitial`,
  and `OverviewModule` are removed — there is one way to open anything: a native route.
- **Hanzo Functions dashboard.** `FunctionsModule` is rebuilt from the old single
  `/paas/functions` table into a polished tabbed product (Overview · Functions ·
  Deployments · Triggers · Secrets · Settings, `:tab` route like GPUs/Models) over
  the rich `lib/api/functions.ts` (`GET /v1/functions*`). Branded **Hanzo Functions**
  with the honest **Fission** engine badge (the mock said "OpenFaaS", but the live
  engine per `go.mod` + `universe/infra/k8s/functions` is Fission — we label the real
  one). Overview: 6 KPI cards (Functions/Invocations 7D/Success/Avg duration/Errors/
  Cost) derived from real rows via `deriveOverview` (each degrades to "—"), with real
  series sparklines + `trendPct` deltas; an "Invocations over time" `LineChart` with
  1H/6H/24H/7D/30D range toggles; an "Invocation status" `Donut`; and the shared
  `FunctionsBrowser` (table + `DetailRail`, DRY across Overview and the Functions tab).
  All chart/donut/cost read `FunctionsApi.metrics(range)`; until that route is bound
  they show honest "time-series not connected" — never a placeholder trend. Secrets is
  names-only (values never fetched — Secret Manager principle). `functions/{FunctionsTable,
  DetailRail,parts}.tsx` (already built on the feature branch) are reused unchanged.
- **Overview "Explore products" — enablement gate dropped.** The home cards lose the
  Enabled/External/Soon `StatusBadge` and the open-vs-learn gate; every product is
  open-for-all with an "Open" (native) + a "Learn more" affordance (the native
  `/discover/:id` interstitial, which itself surfaces docs + OSS source inline — not a
  link-out).
- Idiom: strictly `@hanzo/gui` v5 shorthands (`bg`/`maxW`/`rounded`/`items`/`self`/
  `p`/`px`/`py`/`gap`), matching every existing module. New tests: `overview/resolve.test.ts`
  (spec resolution + honest default; the no-`external`/no-`href` invariant is enforced at
  compile time by the collapsed `CatalogEntry` union). Verification: `npm run typecheck`
  clean (0 errors), `npm test` 298/298 (31 files), and every route (`/functions/*`, all
  native overviews, `/`, `/discover/:id`) compiles + returns 200 on the dev server.
- Repo drive-by: removed the bogus tracked `node_modules` self-symlink blob (mode
  120000 → itself) that broke `npm install`/`vitest`; `.gitignore` already ignores
  `node_modules/`, so it was never meant to be committed.

## Living overview — one reusable, videogame-like overview across products (claude/living-overview)

The admin Platform Overview (KPI tiles + sparklines, usage/cost timeseries, revenue
donut, live activity, alerts, system-health) is now a **reusable `LivingOverview`
component system**, not a one-off. The old bespoke `OverviewModule.tsx` +
`AiMetricsModule.tsx` (+ its `aimetrics/{StatTile,UsageChart,format}` sub-parts) are
**deleted** — superseded, one overview system, DRY.

- **`src/components/products/overview/living/`** — the system:
  - `config.ts` — the DECLARATIVE contract: a `LivingOverviewConfig` names a product's
    tiles (`metric`/`timeseries`/`distribution`/`activity`/`alerts`/`health`, discriminated
    on `tile`) in ordered `rows`, a single REAL-data `load(ctx) => OverviewData`, and a
    `live` block (`pollMs` + `countUp`). Tiles read their slice out of the normalized
    `OverviewData` by key — a missing slice → honest empty tile (over-declaring is safe).
  - `motion.ts` (pure, unit-tested) — count-up curve (`countUpValue` lands EXACTLY on
    target), live-sparkline ring (`pushSample`), self-correcting poll clock
    (`shouldTick`/`effectiveInterval`, hidden-tab-paused). `hooks.ts` — the thin rAF/interval
    drivers (`useCountUp` animates from the CURRENT on-screen value on retarget — smooth;
    `usePoll`, `useReducedMotion`, `usePageHidden`), all self-cleaning (no leaked frames/timers).
  - `logic.ts` (pure, unit-tested) — the tile decisions: unit-aware `formatMetric`
    (count/cents/ms/pct, em-dash for non-finite), `deltaOf` (null → honest "—"), `hasTrend`
    (≥2 real points), status/health/severity colors, `mergeActivity` (dedupe+newest-first for
    the streaming feed), `windowRows` (virtualization), `worstHealth`/`healthTally`.
  - `tiles.tsx` — the thin animated tiles (reuse `ui/Charts` verbatim; count-up + live
    sparkline + skeleton/empty/error paths; the activity stream virtualizes past a viewport).
  - `LivingOverview.tsx` — the driver: ONE throttled poll loop (floored at 5s, paused when
    hidden OR errored), a `reqRef` race guard, range selector; a background refetch never
    blanks a board that already has real data (last real data stays until new lands); the
    first-load failure shows the shared `ErrorState`. `.hz-skeleton`/`.hz-pulse`/`.hz-row-in`
    keyframes in `globals.css`, all reduced-motion-guarded.
- **Backed by REAL `/v1` data, no mocks** (`adapters.ts`, pure, unit-tested): `fromCloudUsage`
  (commerce usage ledger → the platform + AI-usage overviews), `fromAdminOverview`
  (`src/lib/api/admin-overview.ts` — the `/v1/admin/overview` aggregate, optional-safe
  normalizer, degrades to honest empty on 404), `fromFunctions` (real inventory + metrics),
  `healthFromApps` (operator inventory → the health tile, composable into any board).
- **Wired across products** (`overview/living/registry.ts` — the declarative catalog):
  `overview` (platform centerpiece, rendered at `/` home AND `/overview`; primary source
  `/v1/admin/overview`, honest fallback to the real usage ledger + operator health so it is
  never blank), `ai-metrics` (commerce usage), `functions` (inventory + metrics), `gpus`
  (operator inventory). The product route's `''` renders `livingOverviewModule(id)`; the
  tabbed products keep their `:tab` module, reachable from the sidebar's level-2 sub-nav
  (declared `subpages`) so the overview is never a dead-end.
- **Adding a new product overview is one config** — no overview UI:
  ```ts
  // overview/living/registry.ts
  myproduct: {
    id: 'myproduct', title: 'My Product', subtitle: '…',
    live: { pollMs: 15000, countUp: true },
    rows: [
      [{ tile: 'metric', key: 'foo', label: 'Foo', icon: Zap }],
      [{ tile: 'timeseries', key: 'foo', title: 'Foo over time' },
       { tile: 'distribution', key: 'bar', title: 'By kind' }],
      [{ tile: 'activity' }, { tile: 'health' }],
    ],
    load: async ({ range }) => fromMyApi(await MyApi.overview(range)), // REAL data
  }
  // registry.tsx: const MyLiving = livingOverviewModule('myproduct'); route '' → MyLiving
  ```
- **All real, all tested**: `npm run typecheck` clean (0 errors), `npm test` 449/449 (42
  files; +78 new across motion/logic/adapters/registry/tile-contract/admin-overview,
  −10 from the deleted `aimetrics/format.test.ts`), `next build` green (14/14 pages).
  Visual proof (headless Playwright, no live session needed): the platform overview renders
  the full board with count-up KPIs + live sparklines + streaming feed + donut + health
  tally, values change across a 5s poll (live), the reduced-motion path snaps to real values
  with no error, and the `functions`/`gpus` overviews render their honest empty/error states
  (em-dashes + "not reporting" / "Could not load" + Retry) against a feed-less local backend
  without crashing.

## All-pages production build — external→native re-applied + billing/marketplace (claude/console-all-pages)

Branched off `main`; a completeness pass over the whole page taxonomy. Two audits
(a full catalog inventory + a per-module skeptical review) confirmed console2 was
**already ~95% production-complete**: ZERO mock modules, ZERO thin/incomplete modules
— every leaf hits a real `/v1`/proxy feed with honest loading/empty/error states. So
this pass is small and precise, not padding.

- **External→native re-applied (the priority fix).** `main` was inconsistent: `open.ts`,
  `match-core`, `NativeOverview`, `overviewFor` were all collapsed to a no-external world,
  but the registry STILL declared 14 `kind:'external'` entries (gateway, dns, cdn, mpc, cli,
  sdks, api, ide, desktop, registry, metrics, crawl, studio, console). Result: those 14 pushed
  `/${id}` → `resolveProductView` returned `notfound` → **hard 404 dead links** from the
  overview grid + app launcher. (The `claude/console2-native-control-planes` branch had fixed
  this but is 19 commits behind `main` and was never merged.) Fixed here by converting each to
  `kind:'module'` `routes: overviewRoutes(id)` (the DRY twin of `soonRoutes`), rendering the
  already-merged `NativeOverview` from its bespoke `OVERVIEW_SPEC`. `CatalogEntry` union
  collapsed to module-only; `ProductStatus` → `enabled|soon`; dead `external` branches removed
  from `DashboardShell`/`OverviewModule`; stale `ext`/`href` config trimmed. `resolve.test.ts`
  already pins all 14 specs; `match-core.test.ts` updated so the `kind`-guard fails closed for
  a non-module entry.
- **Subscriptions + Payment Methods** (`Observe`, next to `cost`/`plans`) — real commerce via
  the `/billing` per-tenant proxy: `GET /v1/billing/subscriptions`, `GET /v1/billing/payment-methods`.
  `billing.ts` gains `Subscription`/`PaymentMethod` types + normalizers that handle Stripe
  snake_case AND camelCase, the nested `card` object, and Unix-seconds/ms dates. Card data is
  **masked by construction** — the normalizer extracts only brand/last4/exp/isDefault; a
  PAN/CVV/token in the payload is dropped and never reaches the display object (a dedicated
  `billing.test.ts` leak test asserts it). Read-only; add/manage link to the brand portal.
- **Marketplace** (`Apps`, next to `chat`/`bot`/`search`) — the storefront over the real model
  catalog: `aicatalog.fetchCatalog()` → `GET /v1/pricing/models` via the authed `/ai` proxy.
  Category tiles + featured shelf (real catalog flag) + filterable listings with real per-Mtok
  pricing + Try-it→Playground CTA. Reuses the existing `aicatalog` client + `ProviderLogo` — a
  distinct storefront view over the SAME catalog, NOT a duplicate of Model Catalog/Providers.
  Pure `marketplace/logic.ts` (categorize/featured/applyFilters/marketStats) with 16 tests incl.
  a regex-injection guard (search is a literal substring filter).
- **Intentionally NOT built (honest):** Feature Flags / Backups / Support Tickets have NO backend
  anywhere in the Hanzo stack — adding permanent empty-state pages would be fabricated padding.
  Regions/Nodes duplicate `clusters`/`kubernetes`/`machines` (nodes derive from cluster node
  pools; there is no `/v1/machines` route by design). Jobs is intentionally Tasks (registry's own
  decision). No `Billing` category exists in `brand-scope.ts` — billing lives under `Observe`.
- **No cloud changes.** The billing sub-pages ride the existing `/billing/*` proxy (which already
  forwards any path with server-side org scoping); commerce already serves subscriptions +
  payment-methods natively. `go build ./clients/...` clean; cloud version NOT bumped.
- Verification: `npm run typecheck` 0 errors, `npm test` **406/406** (38 files), `next build` ✓
  compiled successfully (lint+types clean). Idiom: `@hanzo/gui` v5 shorthands only.
- **RED review fixes (billing-proxy tenant isolation — the one HIGH finding).** The `/billing`
  proxy's tenant scoping was INERT: it stamped `X-Hanzo-Org` (commerce reads `X-Org-Id` on the
  service-token path — `commerce/middleware/accesstoken.go`; the header fell back to the service
  org) and pinned only `?user=` (subscriptions filter `?userId=` — `commerce/api/billing/
  subscriptions.go`; with no `userId` the query returned every subject's rows = cross-tenant
  leak). Fix: send **`X-Org-Id`** (matching the `/ai` proxy) and pin the **FULL** subject-key set
  `{user,userId,customerId}` — identical to commerce's own `billingSubjectKeys` (`commerce/
  middleware/edgeauth.go`) — so no billing endpoint is left unfiltered whichever param it reads.
  The scoping is extracted to a pure `src/lib/server/billing-scope.ts` (`scopedBillingSearch` +
  `billingSubject`) and unit-tested (`billing-scope.test.ts`, 11 tests incl. the client-forged-
  subject overwrite + two-tenant disjointness). Also (defense-in-depth) `normalizePaymentMethods`
  clamps `last4` to the last 4 digits even if commerce puts a full PAN there (+ test). New live
  two-tenant isolation e2e (`e2e/billing-isolation.spec.ts`) asserts two distinct-org sessions get
  disjoint subscription/payment-method row sets through the proxy. `npm test` **487/487**.

## Consolidation — two Network modules onto main + one authoritative tag (v8.3.1)

The single-consolidator pass that ends the console2 deploy-war: main is the one
authoritative source, the operator CR is pinned to exactly what main builds, and
every stale session branch is pruned. Two genuinely-unmerged Network-category
modules land; everything else was already on main (verified by `git cherry`) and
was deleted, not re-merged.

- **Nodes** (`components/products/NodesModule.tsx`, `app/nodes/[...path]/route.ts`,
  `lib/api/nodes.ts`, `lib/products/brand-scope.ts` `nodeNetworksForBrand`) —
  per-node blockchain infrastructure (validators via P-chain
  `platform.getCurrentValidators` + peers via `info.peers`) over LIVE luxd RPC.
  Same-origin session-gated proxy (mirrors `/bootnode`), brand-scoped DATA
  (hanzo = all networks; lux/zoo/pars = own chain only), honest not-reporting per
  unreachable network. Tests: normalizers over real wire shapes + brand→network
  scope.
- **DNS** (`components/products/DnsModule.tsx`, registry `dns` entry) — per-org
  managed DNS (zones + records → CoreDNS + Cloudflare sync) on the unified
  `/v1/dns` surface; honest BackendStateCard states until the route is bound. The
  cherry-pick collided with main's existing DNS overview stub (same `id:'dns'`),
  resolved by upgrading that well-placed Network-cluster entry to render the real
  `DnsModule` and dropping the duplicate — one id, one entry.
- **Not merged (already on main, branches deleted):** the `/v1/iam` account
  reorg (revert-pair, net no-op; main has #20), the `cloud.hanzo.svc` default
  (main already there), the visor `:19000` default (main already ahead). The
  `api.hanzo.ai`-gateway default change was **rejected**: the CR documents that
  the DOKS pod's egress is Cloudflare-403'd on public `api.hanzo.ai`, so the safe
  env-less default is the in-cluster `cloud.hanzo.svc`.
- Drive-by: the pre-existing `observability/metrics.test.ts` null-override type
  errors are fixed (a `NullablePartial<T>` factory-override type) so
  `tsc --noEmit` is fully green.
- Verification: `tsc --noEmit` clean; `next build` is the authoritative gate
  (Node 24, on-cluster Kaniko — no GitHub builders). One tag `v8.3.1` from main
  HEAD, pinned in `universe/.../crs/console2.yaml`.
