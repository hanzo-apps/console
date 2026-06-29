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
