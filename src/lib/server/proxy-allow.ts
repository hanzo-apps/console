/**
 * Least-privilege allow-lists for the same-origin user-bearer proxies (pure, tested).
 *
 * Each proxy mints a user-bound Bearer and forwards to a backend; the JWT owner
 * claim scopes tenancy server-side, so these lists are DEFENSE IN DEPTH — they keep
 * a proxy from becoming a general tunnel to everything the cloud-api or visor binary
 * mounts (e.g. `/v1` must never reach `v1/iam/*` or admin endpoints).
 */

/**
 * Cloud-api surfaces reachable through `/v1` as the signed-in user. These are exactly
 * the data + serverless products whose backends authorize on the Bearer owner claim
 * (and 403 a cookie-only call): the managed data resources plus the serverless /
 * prompt / agent surfaces.
 *
 * An entry is the PREFIX of what it admits, matched on segment boundaries (HIP-0139:
 * a capability answers at ONE address, so a capability's whole subtree is one entry,
 * and a deeper entry admits one route of it and nothing beside it).
 */
export const CLOUD_HEADS: readonly string[] = [
  // The API describing itself (/v1/openapi/commands) — every operation cloud answers,
  // each reduced to the name it is addressed by, its method, path and prose. Cloud
  // composes it from each subsystem's own projection of its router, so nothing in it is
  // written twice, and it grants nothing: every route it names stays individually gated,
  // which is why cloud serves it unauthenticated. The per-product brief reads a
  // product's operations from here, through the one same-origin form every other read
  // uses. The document describing the API lives with the document itself.
  'openapi/commands',
  // The caller's OWN account (/v1/account/{keys,orgs,csrf,avatar,appearance,embed}) — the
  // per-user sk- credential, the orgs they belong to, the CSRF token the embed's money
  // writes carry, their picture and their theme. Every route under it is about the person
  // holding the bearer, which is why the head is the right grain here: there is nothing
  // beneath it they should not reach about themselves. /v1/iam/* routes to IAM, which
  // answers a request meant for cloud with its own 401, so the credential is NOT there.
  'account',
  // Managed data resources: /v1/provisioning/{sql,vector,kv,datastore,docdb,search,s3}
  // [/<name>]. One service, one address — the per-kind REST heads were seven addresses
  // for one capability. The DATA planes each keep their own head below.
  'provisioning',
  'search',
  's3',
  // DNS control plane (hanzoai/dns at dns.hanzo.ai): /v1/dns/{zones,sync}[/…]. The
  // consolidated DNS service — authoritative zones served by CoreDNS plus
  // third-party providers (Cloudflare) via the org's KMS-sealed token. The
  // service validates the IAM JWT and scopes every zone/record to the owner claim,
  // and 403s a cookie-only call, so it routes through /v1 exactly like the data
  // resources.
  'dns',
  // Serverless + prompt/agent/eval surfaces (org resolved from the Bearer owner claim).
  'functions',
  'prompts',
  'agents',
  // The unified tool plane (cloud apps/tools): /v1/tools — discovery across every
  // source (connector actions, functions, zap-service routes, agents, skills, the
  // org's own MCP servers), deduplicated by name. `scopeOf` derives the org+project
  // from the Bearer owner and 403s a cookie-only call, so it routes through /v1
  // exactly like agents/prompts. Discovery only — `/v1/tools/call` is refused below,
  // because running a tool belongs to whatever runs an agent, not to a browser tab.
  'tools',
  // Login manager (cloud clients/link): /v1/link[/…] — the org+user-scoped registry
  // of which AI provider accounts are signed in on which machines + their usage. The
  // handler resolves org from the Bearer owner + the user from the validated subject
  // and 403s a cookie-only/forged call, so it routes through /v1 like agents/prompts.
  'link',
  // Automations (cloud clients/automations): /v1/auto/{pieces,flows,runs,connectors,
  // hooks}[/…]. The ONE native Connectors + Automations engine — flows/versions/runs
  // over the go:embed'd 706-connector catalogue, run durably on the shared hanzoai/tasks
  // engine. The handler resolves the org from the Bearer owner (principal.Tenant) and
  // 403s a cookie-only or forged-header call, so it routes through /v1 exactly like
  // prompts/agents — the single `auto` head admits every sub-path (pieces, flows CRUD +
  // enable/disable/run, runs, connectors, hooks).
  'auto',
  // Webhooks (cloud clients/webhooks): /v1/webhooks[/:id[/{deliveries,test,secret}]].
  // The org's outbound event destinations — the handler resolves the org from the Bearer
  // owner (principal.Tenant) and 403s a cookie-only or forged-header call, so it routes
  // through /v1 exactly like automations/agents. The single `webhooks` head admits every
  // sub-path (endpoint CRUD + enable/disable, per-endpoint deliveries, test-send, rotate).
  'webhooks',
  // Framework (cloud clients/framework): /v1/framework/{doctypes,roles,modules,:doctype}[/…].
  // The metadata-driven DocType engine — the FOUNDATION CMS/ERP/CRM/Helpdesk are "just
  // DocTypes" on. Per-org on Base/SQLite; the engine derives the org from the Bearer owner
  // (principal.Tenant) and 403s a cookie-only or forged-header call, so it routes through
  // /v1 exactly like prompts/agents — the single `framework` head admits every sub-path
  // (doctypes, roles, modules install, and the generic /:doctype document CRUD).
  'framework',
  // Knowledge (cloud clients/knowledge): /v1/knowledge/{graph,import,search,connectors}
  // [/…] — the knowledge graph + vault import + RAG retrieval. The handler resolves the
  // org from the Bearer owner (principal.Org) and 403s a cookie-only call, so it routes
  // through /v1 exactly like framework/prompts. One capability, one head.
  'knowledge',
  // ML serving (cloud clients/ml): /v1/ml/{models,health}[/:name[/predict]] — the org's
  // deployed KServe InferenceServices. The handler resolves the org from the Bearer owner
  // and lands every request in a PER-ORG namespace ("ml-"<org>); a cookie-only call 403s,
  // so it routes through /v1 exactly like agents/functions. One head admits the models
  // list/get + the create/predict sub-paths (the Inference product's endpoints source).
  'ml',
  // Code intelligence (cloud clients/code, order 134): /v1/code/{search,ask,context,
  // index}. Native per-org HYBRID retrieval (lexical + symbolic + semantic, RRF-fused)
  // over the org's indexed repos. The tenant boundary is a PHYSICAL per-org SQLite file
  // and the handler resolves the org from the Bearer owner (principal.Tenant) — a
  // cookie-only / forged-header call 403s, so it routes through /v1 exactly like
  // agents/prompts. The single `code` head admits every sub-path (search, ask, the
  // context bundle, and the index write).
  'code',
  // Business AI Guide (cloud clients/guide): /v1/guide + /v1/guide/{curriculum,steps/:id/
  // {start,done,skip,reset,do},actions}. The interactive launch checklist — a curriculum
  // drives the steps, per-org progress tracks a state per step, and the Business AI runs a
  // step for you (JSON or an SSE stream). The handler resolves the org from the Bearer owner
  // (principal.Tenant) and 403s a cookie-only call, so it routes through /v1 exactly like
  // crm/agents — the single `guide` head admits every sub-path (overview, curriculum GET/
  // PUT/DELETE, the per-step transitions + do, and the action ledger).
  'guide',
  // CRM (cloud clients/crm): /v1/crm/{summary,companies,contacts,opportunities}[/:id].
  // Native-Go per-org CRM on Base/SQLite (companies/contacts/opportunities). The
  // handler resolves the org from the Bearer owner (X-Org-Id) and 403s a cookie-only
  // call, so it routes through /v1 exactly like prompts/agents — the single `crm`
  // head admits every sub-path (summary, the three collections, their :id detail).
  'crm',
  // Company formation (cloud clients/company): /v1/company + /v1/company/{structure,
  // founders,kyc,payment,documents,esign,genesis,advance,skip,import/*,fundraise/*}.
  // The per-org incorporation state machine on Base/SQLite (structure → founders →
  // payment → documents → esign → genesis → company). The handler resolves the org
  // from the Bearer owner (principal.Org) and 403s a cookie-only call, so it routes
  // through /v1 exactly like crm — the single `company` head admits the formation
  // read + every stage-action + transition sub-path.
  'company',
  // Cap table (cloud clients/captable): /v1/captable/{company,stakeholders,classes,
  // plans,shares,options,safes,convertibles,rounds,investments,summary}[/:id].
  // The per-org capitalization ledger on Base/SQLite (HIP-0106); every route resolves
  // the org from the Bearer owner (principal.Org) and 403s a cookie-only call, so it
  // routes through /v1 exactly like crm — the single `captable` head admits every
  // sub-path (the computed summary, the collections, their :id detail + share transfer).
  'captable',
  // Marketing (cloud clients/marketing): /v1/marketing/{summary,campaigns[/:id]}.
  // Native-Go per-org campaign store on Base/SQLite (the in-process fold of
  // github.com/hanzoai/marketing, twin of crm). The handler resolves the org from
  // the Bearer owner (X-Org-Id) and 403s a cookie-only call, so it routes through
  // /v1 exactly like crm — the single `marketing` head admits every sub-path
  // (summary, the campaigns collection, its :id detail).
  'marketing',
  // Ads (cloud clients/ads): /v1/ads/{summary,campaigns[/:id]}. Native-Go per-org
  // ad-campaign store on Base/SQLite (net-new, twin of crm). The handler resolves the
  // org from the Bearer owner (X-Org-Id) and 403s a cookie-only call, so it routes
  // through /v1 exactly like crm — the single `ads` head admits every sub-path
  // (summary, the campaigns collection, its :id detail).
  'ads',
  // Social (cloud clients/social): /v1/social/{summary,accounts[/:id],posts[/:id]}.
  // Native-Go per-org accounts+posts store on Base/SQLite (the in-process fold of the
  // live social stack github.com/hanzoai/social, twin of crm). The handler resolves
  // the org from the Bearer owner (X-Org-Id) and 403s a cookie-only call, so it routes
  // through /v1 exactly like crm — the single `social` head admits every sub-path
  // (summary, the two collections, their :id detail).
  'social',
  // Referrals (cloud clients/referrals): /v1/referrals + /v1/referrals/claim. Native
  // per-org viral loop on Base/SQLite (referral code/link, claim, credit earned). The
  // handler resolves the org from the Bearer owner (X-Org-Id) and 403s a cookie-only
  // call, so it routes through /v1 exactly like crm — the single `referrals` head
  // admits the overview read + the claim POST (the /v1/admin/referrals* surface is a
  // separate global-admin head handled by app/admin/aggregate, not this proxy).
  'referrals',
  // Affiliates (cloud clients/affiliates): /v1/affiliates + /v1/affiliates/{apply,
  // attribute}. Native per-org partner-commission loop on Base/SQLite (apply, code/
  // link, attribution, accrued/pending/paid, payout history). The handler resolves the
  // org from the Bearer owner (X-Org-Id) and 403s a cookie-only call, so it routes
  // through /v1 exactly like referrals — the single `affiliates` head admits the
  // overview read + the apply/attribute POSTs (the /v1/admin/affiliates* surface is a
  // separate global-admin head handled by app/admin/aggregate, not this proxy).
  'affiliates',
  // Authors (cloud clients/authors): /v1/authors + /v1/authors/{connect,repos/verify}.
  // Native per-org OSS-author royalty loop on Base/SQLite (connect GitHub, verify owned
  // repos, share of deploying-org spend, accrued/pending/paid, payout history). The
  // handler resolves the org from the Bearer owner (X-Org-Id) and 403s a cookie-only
  // call, so it routes through /v1 exactly like affiliates — the single `authors`
  // head admits the overview read + the connect/verify POSTs (the /v1/admin/authors*
  // surface is a separate global-admin head handled by app/admin/aggregate, not this proxy).
  'authors',
  // Issue tracker (cloud clients/tracker): /v1/todo/{board,issues,projects[/:key[/issues
  // [/:num]]]}. Native per-org tracker on Base/SQLite (projects + issues, rows grouped by
  // status). The handler resolves the org from the Bearer owner (X-Org-Id) and 403s a
  // cookie-only call, so it routes through /v1 exactly like crm/agents — the single
  // `todo` head admits every sub-path (board, issues, projects, their :num detail).
  'todo',
  // Telecom (cloud apps/tel): /v1/tel/{summary,numbers[/available|/:id],calls[/:id],
  // messages}. Native per-org telecom plane on Base/SQLite (numbers held, call and
  // message records), carrier-agnostic. Every op resolves the org from the Bearer
  // owner (principal.RequireOrg) and 403s a cookie-only call, so it routes through
  // /v1 exactly like crm/tracker — the single `tel` head admits every sub-path
  // (the availability search, a number's :id release, a call's :id hangup).
  'tel',
  // Integrations (cloud clients/connectors): /v1/integrations — the list, a provider's
  // detail (/:provider), its connect/disconnect/verify actions, the connector REGISTRY
  // (/connectors[/:id][/refresh|/token|/credential|/device]) and the per-provider read
  // surfaces the console drives (github/repos, github/issues/backfill, cloudflare, …).
  // Each resolves the org from the Bearer owner (principal.Org) and 403s a cookie-only
  // call, so they route through /v1 exactly like crm/agents. One capability, one head —
  // the registry and the actions are two halves of connecting an account, and splitting
  // them across two entries would refuse half of every flow.
  //
  // The INBOUND doors under the same head are refused below: a webhook, a slash command,
  // a chat-platform event and an OAuth callback are all provider-initiated and
  // state-authed, and they reach cloud directly at api.hanzo.ai. A browser tab has no
  // business posting to any of them.
  'integrations',
  // Unified usage summary (cloud clients/usage): /v1/usage/summary — the org's cost
  // roll-up (spend by category over time + wallet) + LLM usage totals, composed from
  // the commerce ledger + the warehouse. The handler resolves the org from the Bearer
  // owner (principal.Tenant) and 401s a cookie-only call, so it routes through /v1
  // exactly like analytics. One `usage` head admits the summary sub-path.
  'usage',
  // Org-scoped audit trail (cloud clients/auditlog): /v1/audit — the caller's OWN org
  // security events off the tamper-evident, hash-chained store (the per-org twin of the
  // global-admin /v1/admin/audit). Org is PINNED from the Bearer owner (principal.Tenant);
  // a cookie-only call 401s, so it routes through /v1 like the rest. Distinct from the
  // admin god-view, which stays on the global-admin aggregate proxy.
  'audit',
  // Evals facade (cloud clients/eval): /v1/evals/{scores,datasets[/:name/items],
  // rubrics,evaluators,runs}. Single-segment sub-paths under the one `evals` head; the
  // facade resolves the console project key pair from the request tenant (the
  // Bearer owner), so routing it through /v1 gives correct per-org scoping —
  // the same reason it must NOT be a cookie-only same-origin call (that 403s).
  'evals',
  // Research evidence plane (cloud clients/research, HIP-0512): /v1/research/
  // {experiments,totals,projects}. The R&D corpus every product self-logs — falsifiable
  // experiments (kernel-perf/benchmark/training/ablation/policy-eval) with proofs +
  // refutations. The handler resolves the org from the Bearer owner (principal.Org) and
  // 403s a cookie-only call, so it routes through /v1 exactly like evals — one `research`
  // head admits every sub-path (the ledger list, the headline totals, the projects roll-up).
  'research',
  // Read-only starter-kit gallery (cloud clients/templates): /v1/templates[/:slug].
  // Public reference content (no org scoping) but routed through /v1 like the
  // rest of the surface so dev + prod share ONE path.
  'templates',
  // Buildable/deployable projects store (cloud clients/projectsvc): /v1/projects[/*],
  // incl. POST /v1/projects/fork (fork a gallery template into a real project). The
  // handler resolves the org from the Bearer owner (X-Org-Id) and 403s a cookie-only
  // call, so it routes through /v1 like the rest of the surface.
  'projects',
  // The platform control plane (cloud clients/platform): /v1/platform/{projects,
  // projects/:p/apps,.../deploy,.../deployments,.../deployments/:id/logs,fleet,health}.
  // Per-org container-app platform on Base/SQLite; SanitizeIdentity resolves the org
  // from the Bearer owner and 403s a cookie-only call, so it routes through /v1 like
  // the rest — the single `platform` head admits every sub-path, including the operator
  // fleet board at /v1/platform/fleet and the CI aggregates at
  // /v1/platform/{environments,pipelines,builds,releases}. One product, one name.
  'platform',
  // SBOM datastore (cloud clients/sbom): /v1/sbom/{ref} — the software bill of
  // materials CI recorded for an image ref/digest (components + licenses). The
  // handler resolves the org from the Bearer owner and 403s a cookie-only call, so
  // it routes through /v1 like platform — the single `sbom` head admits the by-ref
  // lookup (the deployments view's read-only SBOM panel).
  'sbom',
  // Treasury (hanzoai/finance, embedded in cloud): /v1/treasury + /v1/treasury/accounts
  // — the org's reserve position and the accounts behind it, on the per-org double-entry
  // ledger. The handler resolves the org from the Bearer owner and 403s a cookie-only
  // call, so it routes through /v1 like platform. Read-only; the money the customer owes
  // or is owed reads through the billing proxy, which is where writes live too.
  'treasury',
  // ── Native cloud infra surfaces (the unified cloud binary serves these per-org).
  // Each resolves the org from the Bearer owner (X-Org-Id) and 403s a cookie-only call,
  // so it routes through /v1 exactly like the rest.
  //
  // Compute (hanzoai/visor): machines inventory + launch/quote/terminate
  // (/v1/visor/machines[/agents|/:id]); GPU inventory + alerts (/v1/visor/gpus[/alerts]);
  // the BYO connect fleet with live heartbeat (/v1/visor/fleet/{workers,jobs,samples});
  // dedicated clusters + node-pool add/scale/delete (/v1/visor/clusters[/:cid/pools
  // [/:pid[/scale]]]); the k8s inventory (/v1/visor/k8s/{clusters,nodes}); and the
  // regions/sizes catalog (/v1/visor/compute/*). One capability, one head — these were
  // four top-level addresses for one service.
  'visor',
  // Sandboxes (cloud apps/sandbox): the org's leased gVisor pods — lease/list/get/
  // end, exec, fs, and the ticket that opens an interactive terminal
  // (/v1/sandboxes[/:id[/exec|/fs|/terminal]]). Same gate as the rest: the handler
  // resolves the org from the Bearer owner and answers 403 without one, and an id
  // belonging to another org is a 404.
  //
  // The terminal's SOCKET does not come through here and cannot: a Next route
  // handler proxies requests, not upgrades. The browser dials the API host
  // directly, carrying the single-use ticket this proxy fetched for it — which is
  // the whole reason the ticket exists.
  'sandboxes',
  // (`dns` — the managed-DNS head — is declared ONCE above, with the data resources.)
  // (The platform aggregates — deploy targets, CI pipelines, image/binary builds,
  // versioned releases — answer under the `platform` head above, at
  // /v1/platform/{environments,pipelines,builds,releases}. Edge nodes answer under
  // `projects`, at /v1/projects/edge.)
  // Agent runs (hanzoai/bot): /v1/bot/runs[/:runId/stop] — the org's live bot fleet, the
  // launch POST behind the Bots console, and the halt. Org from the Bearer owner, 403 on
  // a cookie-only call, like agents/prompts. The runtime's OWN ops relay under the same
  // head is refused below: it is a passthrough to another process's paths, not a
  // tenant-scoped resource, so a browser tab does not get to walk it.
  'bot',
  // Cloudflare (cloud clients/cloudflare): /v1/cloudflare/{zones,workers,d1,kv,r2,ai,…} —
  // the org's Cloudflare estate, driven through the token it sealed into KMS. cloud holds
  // the credential and scopes every call to the Bearer owner, so the browser never carries
  // one. Its OWN capability, not a connector: connecting the account is an integration,
  // operating the account is this.
  'cloudflare',
  // Networking (zt-backed, Hanzo Zero Trust / OpenZiti fabric): /v1/network — the org's
  // overlay networks (+ /:id), its routers, and the services published on them
  // (/network/services, which the Service Mesh page reads). Naming the fabric once and
  // hanging both views off it is what folded two heads into one: a mesh service IS a
  // service on a network. Org from the Bearer owner, 403 on a cookie-only call.
  'network',
  // Fine-grained authorization (hanzoai/authz): /v1/authz/{check,health,readyz} — ask
  // whether a subject may do a thing. The subsystem picks the per-org enforcer from the
  // Bearer-derived X-Org-Id — a cookie-only call has none — so it routes through /v1 like
  // the rest. One head admits the decision + the two liveness reads. Backs the console's
  // Authz page.
  'authz',
  // Observability (hanzoai/o11y): the cloud binary serves the embedded o11y surface at
  // the FLAT, VERSION-LESS canonical `/v1/o11y/<resource>` — one /v1/, no nested /api/vN.
  // The console reads e.g. /v1/o11y/rules (alerts), /v1/o11y/services (RED metrics),
  // /v1/o11y/query_range (the composite logs/traces list), /v1/o11y/availability (the
  // fleet's up-now-and-lately number), /v1/o11y/health. The upstream engine version is
  // resolved SERVER-SIDE inside cloud (clients/o11y) — never leaked into a route. cloud's
  // principal gate refuses any bearer-less call, so it routes through the /v1 bearer BFF
  // like the rest. The single `o11y` head admits every o11y sub-path.
  // — including Hanzo Sentinel (cloud clients/sentry), the error/log/trace product
  // surface at /v1/o11y/sentinel/<resource>: projects (+ DSN/key rotate), issues (list/
  // get/update/events), discover, events, logs, traces (+ detail), stats. The Sentry face
  // (sentry.<brand>) reads it over this same proxy; watching a system is one capability,
  // so it answers at one address.
  'o11y',
  // Web Search (cloud clients/websearch, order 141): /v1/websearch/{search,scrape}.
  // Self-hosted SearXNG meta-search + Crawl4AI scrape. The `search` proxy has no
  // principal gate (its optional X-API-Key admits a missing key), so a signed-in
  // user's minted bearer is accepted/ignored and the query proxies straight to
  // SearXNG — routing it through /v1 gives the console a keyless, prefix-free
  // `/v1/websearch/search`. (Scrape 503s without the shared crawl key — not a user
  // token — so the console never drives a live scrape; it documents it only.) One
  // head admits both the search + the scrape sub-path (the /v1-first law: a flat
  // `/v1/websearch/scrape`, no nested inner version).
  'websearch',
  // Chain data (graph-backed, luxfi/indexer + luxfi/graph): the deployment's chain
  // indexing status (/v1/explorer/indexers — chain/network/height/health) and on-chain
  // price/data oracle feeds (/v1/explorer/oracles — O-Chain PriceFeed registry). The
  // cloud `graph` subsystem principal-gates every read (a cookie-only call 403s) and
  // scopes per brand (each brand's cloud is wired to its own indexer/graph), so it routes
  // through /v1 like the rest. Reading a chain is one capability — the two console pages,
  // Indexer and Oracles, are two views of it.
  'explorer',
  // The subscription ladder (cloud clients/plan): /v1/plan/subscriptions — the personal
  // and team tiers with their rate cards, which the model catalogue reads to badge a model
  // with the tiers that include it. The ROUTE, not the `plan` head: the planner also sizes
  // and prices cloud, gpu, storage, dns and blockchain resources, and a badge on a model
  // card has no business reaching any of that.
  'plan/subscriptions',
  // Enablement registry USER surface (cloud clients/pricing): /v1/pricing/enablement
  // [/optin|optout]. Any authenticated user's effective feature/model view + self-service
  // beta opt-in; the handler scopes to the SANITIZED caller org (X-Org-Id from the Bearer
  // owner) and refuses a non-beta item, so it routes through /v1 like the rest (a
  // cookie-only call 403s). The ROUTE, not the `pricing` head — what an org may use is a
  // read a signed-in user makes; what anything COSTS is the catalog the admin proxy
  // carries. Distinct again from the global-admin /v1/admin/pricing/enablement.
  'pricing/enablement',
  // The ai service (hanzoai/ai): /v1/ai/{stores,files,vectors,chats,messages,providers,
  // routes,tasks,records,usages,account,memory,router,org/settings,rag,finetune,
  // training-contribution,connections,…}. ONE SERVICE head, which is what a head-based
  // allow-list is supposed to mean — this used to enumerate a dozen individual ROUTES
  // (get-stores, get-files, get-cloud-usages, docs/ingest, memory, router, org/settings,
  // …) because the surface had no namespace to enumerate. The console is the client for
  // all of it: the Embeddings ingest form, the Memory product, the Router page, the
  // OrgSettings board and the usage panels each read their own slice, org-scoped from the
  // Bearer owner. The session verbs it does NOT drive are refused below.
  'ai',
  // Per-org product entitlements (cloud clients/entitlements): /v1/entitlements/orgs/{org}
  // — the set of products the org has enabled (out-of-box each org assembles its own
  // backend from the catalog). GET reads the enabled ids; POST { add?, remove? } toggles
  // them. The handler resolves + PINS the org from the Bearer owner (a customer can only
  // read/mutate their OWN org's entitlements; a super admin any org, server-enforced),
  // so it routes through /v1 exactly like the rest — a cookie-only call 403s. The ROUTE,
  // not the `entitlements` head — the console calls no other entitlements surface, so
  // keep the tunnel to exactly what is used.
  'entitlements/orgs',
  // CD / deploy plane (cloud clients/deploy reads the operator hanzo.ai/v1 App CRs):
  // /v1/deploy/{applications[/:name[/resource-tree]], health} + POST
  // applications/:name/{rollback,sync}. cloud holds the k8s client + enforces authz
  // server-side (today SuperAdmin-only; the org-scoped projection keys it by the
  // Bearer owner). The single `deploy` head admits every sub-path; the console never
  // touches the cluster — a cookie-only/forbidden call 403s like the rest.
  'deploy',
  // Hanzo Git (cloud clients/git): /v1/git/repos[/:name[/{refs,tree,blob,commits,readme,mirrors}]].
  // The org's hosted code repositories — the native-Go git host welded into the cloud
  // binary (smart-HTTP + the /v1/git control plane + the JSON browse surface). The
  // handler resolves the org from the Bearer owner (X-Org-Id) and 403s a cookie-only
  // call, so it routes through /v1 exactly like the rest — the single `git` head admits
  // the repos list/detail + the read/browse sub-paths (refs, tree, blob, commits, readme).
  // The `/v1/git/:org/:repo/*` smart-HTTP protocol routes are NOT reached here (the git
  // CLI hits git.hanzo.ai directly); this is the console's repo-browser read surface.
  'git',
  // (Cloud no longer re-proxies the Base data plane; the console's Base product reads
  // the managed Base through its OWN `/v1/superbase` proxy, which is the one address
  // for it.)
  // Telemetry ingest (cloud clients/analytics event.go): POST /v1/event — the ONE
  // canonical front door for the @hanzo/event client (pageviews · product events ·
  // identify · errors) as one batched stream, lensed server-side into web analytics,
  // product insights, and error tracking. cloud stamps the tenant from the validated
  // session/bearer (the client NEVER sends an org), so on the standalone BFF the minted
  // user bearer forwards it as the signed-in user. The primary go:embed console hits
  // cloud's /v1/event natively (the BFF is pruned there).
  'event',
  // User preferences (cloud apps/prefs): GET + PATCH /v1/prefs — the caller's OWN
  // document (theme, pinned nav) following them across every Hanzo surface. The
  // subject is the `<owner>/<name>` identity built from the validated Bearer and is
  // the mandatory predicate on both verbs, so it routes through /v1 exactly like
  // agents/prompts. There is no path to another user's document, which is why the
  // head admits no sub-path beyond the one it serves.
  'prefs',
  // Conversion destinations (cloud clients/destinations): /v1/destinations[/:platform
  // [/test]]. The org's server-side Conversions API sinks — the same events the browser
  // pixel sends, forwarded server-to-server with a shared event_id so a platform can
  // dedupe the pair. The handler resolves the org from the Bearer owner and requires the
  // org-admin bit to MUTATE, so it routes through /v1 exactly like webhooks/automations.
  // The single `destinations` head admits the list, one platform's connect/disconnect,
  // and its test send. A destination's API credential is sealed into KMS server-side and
  // is never in a response — the head carries connection STATE, never a secret.
  'destinations',
  // (The browser tag door — GET /v1/projects/tags?key=<pk-> — answers under the
  // `projects` head above, beside the PATCH /v1/projects/:slug that sets the ids. A
  // site's tags belong to the site.)
]

/** The `<head>` of a `v1/<head>/...` path, or null when it isn't a `v1/` path. */
export function v1Head(path: string): string | null {
  const m = path.replace(/^\/+/, '').match(/^v1\/([^/?#]+)/)
  return m ? m[1] : null
}

/**
 * Sub-paths refused even though their prefix is admitted.
 *
 * An entry grants a whole subsystem, which is the right grain for a tenant-scoped
 * family — but the cross-tenant store listing is an admin read the console never
 * invokes, and it was explicitly refused before the surface was namespaced.
 * Granting `ai` would have admitted it silently, so the refusal follows the path.
 *
 * Deliberately scoped to that ONE path, not a blanket rule over every `global`
 * sub-path: the Providers board does read its cross-tenant catalog, and a blanket
 * rule would break a live surface while claiming to preserve a property that never
 * covered it. Defense in depth — the backend gates cross-tenant reads on its own.
 */
const REFUSED_SUBPATHS: readonly RegExp[] = [
  /^v1\/ai\/stores\/global(?:$|[/?#])/,
  // The ai capability's SIGN-IN verbs (/v1/ai/{signin,signin-sessions}). Who the caller
  // is arrives from IAM through the bearer this proxy mints; a second door onto a second
  // notion of identity, opened by a browser tab, is how the two disagree — and
  // `signin-sessions` lists them across tenants. Signing OUT is not on this list: ending
  // your own session is the one session verb the person in the browser owns.
  /^v1\/ai\/(?:signin|signin-sessions)(?:$|[/?#])/,
  // The bot RUNTIME relay (/v1/bot/runtime/*). It forwards whatever path follows to the
  // runtime's own ops surface with the prefix stripped, so admitting it would hand a
  // browser tab every address another process happens to serve. The liveness probe the
  // console reads goes straight to cloud, not through this proxy.
  /^v1\/bot\/runtime(?:$|[/?#])/,
  // The INBOUND halves of the integrations head: a provider posts to these, we do not.
  // `callback` completes an OAuth handshake against state the provider carries;
  // `webhook`, `events`, `commands`, `interactions` and `install` are the platform
  // calling us. All are authenticated by their own signature or state parameter, not by
  // the caller's bearer, so a browser-driven POST to one is a forged event, not a read.
  /^v1\/integrations\/[^/]+\/(?:webhook|callback|events|commands|interactions|install)(?:$|[/?#])/,
  // The tool plane's DISPATCH door. `tools` is allow-listed for discovery — the agent
  // builder needs to offer the org's real tool names — but a head admits every
  // sub-path, and `POST /v1/tools/call` RUNS a tool. Executing one belongs to whatever
  // runs an agent, never to a form in a browser tab, so the console's proxy is a
  // read-only window onto the plane.
  /^v1\/tools\/call(?:$|[/?#])/,
]

/**
 * True iff `path` (e.g. `v1/provisioning/vector/mydb`) is an allow-listed cloud-api
 * surface.
 *
 * An entry is the PREFIX of what it admits, matched on segment boundaries. Most are one
 * segment — a capability's head — and admit its whole subtree; a deeper entry admits one
 * route and nothing beside it, which is the only way to stay least-privilege against a
 * backend that answers several products under a single head.
 */
export function allowCloudSurface(path: string): boolean {
  const rel = path.replace(/^\/+/, '').split(/[?#]/)[0]
  if (REFUSED_SUBPATHS.some((re) => re.test(rel))) return false
  if (!rel.startsWith('v1/')) return false
  const tail = rel.slice('v1/'.length)
  return CLOUD_HEADS.some((entry) => tail === entry || tail.startsWith(`${entry}/`))
}

/**
 * True iff `path` targets the visor `/v1/*` surface (regions/gpus/machines/…). Visor
 * (vm.hanzo.ai) serves ONLY its own compute surface, so the whole `v1/` subtree is
 * the correct boundary — the task's `/v1/vm` → visor `/v1/*` contract — while still
 * refusing any non-`v1` path.
 */
export function allowVisorSurface(path: string): boolean {
  const rel = path.replace(/^\/+/, '')
  return rel === 'v1' || rel.startsWith('v1/')
}

/**
 * Commerce `/v1/<head>` store surfaces reachable through `/commerce` as the signed-in
 * user. Commerce (`commerce.hanzo.svc`) serves the whole store admin over its REST
 * models, and EdgeAuth scopes every one to the Bearer owner's org — but this list is
 * defense in depth: it keeps the `/commerce` proxy from being a general tunnel to the
 * money/tenant-admin surfaces that share the same binary (`billing`, `checkout`,
 * `_/commerce/tenants`, `namespace`), which the console reaches through their OWN
 * scoped proxies (`/billing`) or not at all. Only the merchant catalog/order/customer
 * heads the store dashboard reads + writes are admitted (singular REST model names,
 * matching commerce's `rest.New(<kind>{})` routes).
 */
export const COMMERCE_HEADS: readonly string[] = [
  'product', // products
  'variant', // inventory / SKUs
  'collection', // catalog collections
  'order', // orders
  'user', // customers
  'discount', // promotions & discounts
  'coupon', // discount codes
  'saleschannel', // sales channels
  'stocklocation', // stock locations
  'store', // storefront settings
]

/**
 * True iff `path` (e.g. `v1/product/abc`) is an allow-listed commerce surface: a store
 * model, the platform catalog, or the plan authority. Cloud serves all three under
 * `/v1/commerce/*`, so the console addresses them there and this ONE proxy carries them
 * — three doors onto one binary were three ways to say the same thing. Commerce's own
 * paths are unchanged (`v1/<model>`, `v1/catalog/*`, `v1/plans/*`); the proxy re-roots.
 */
export function allowCommerceSurface(path: string): boolean {
  const head = v1Head(path)
  if (head != null && COMMERCE_HEADS.includes(head)) return true
  return allowCatalogSurface(path) || allowPlansSurface(path)
}

/**
 * Commerce PLATFORM-CATALOG admin surface reachable through `/v1/commerce/catalog` as
 * the signed-in SuperAdmin. Commerce serves the catalog CMS under `/v1/catalog/*` on
 * its `/v1` bundle: `entries` (GET list incl. cost/margin, POST create),
 * `entries/:slug` (PUT update, DELETE remove), and `seed` (POST upsert). This list
 * is the least-privilege boundary — it admits ONLY those catalog paths, so the
 * commerce proxy can never tunnel commerce's money/tenant surfaces
 * (`billing`, `checkout`, `_/commerce/tenants`) that
 * share the binary. Commerce's own `requireSuperAdmin` (owner=="admin") is the
 * authoritative auth gate on top of this; this only bounds the reachable PATHS.
 */
export function allowCatalogSurface(path: string): boolean {
  const rel = path.replace(/^\/+/, '').replace(/\/+$/, '')
  if (rel === 'v1/catalog/entries') return true // list (GET) + create (POST)
  if (/^v1\/catalog\/entries\/[^/]+$/.test(rel)) return true // update (PUT) + delete (DELETE) by slug
  if (rel === 'v1/catalog/seed') return true // upsert the embedded seed (POST)
  return false
}

/**
 * Commerce PLATFORM-PLAN admin surface reachable through `/v1/commerce/plans` as the
 * signed-in SuperAdmin. Commerce serves the subscription/DNS plan authority CMS under
 * its plan bundle: `entries` (GET list, POST create), `entries/:slug`
 * (PUT update, DELETE remove), and `seed` (POST upsert). The sibling of
 * `allowCatalogSurface` — the same least-privilege boundary, admitting ONLY those plan
 * paths, so the commerce proxy can never tunnel commerce's money/tenant surfaces
 * (`billing`, `checkout`, `_/commerce/tenants`). Commerce's
 * own `requireSuperAdmin` (owner=="admin") is the authoritative auth gate on top of
 * this — money-adjacent, since a plan's price is the real renewal charge; this only
 * bounds the reachable PATHS.
 */
export function allowPlansSurface(path: string): boolean {
  const rel = path.replace(/^\/+/, '').replace(/\/+$/, '')
  if (rel === 'v1/plans/entries') return true // list (GET) + create (POST)
  if (/^v1\/plans\/entries\/[^/]+$/.test(rel)) return true // update (PUT) + delete (DELETE) by slug
  if (rel === 'v1/plans/seed') return true // upsert the embedded seed (POST)
  return false
}

/**
 * Payload CMS (`cms.<brand>`) READ surfaces reachable through `/cms` as the signed-in
 * user. The console forwards the caller's own IAM Bearer; Payload's `hanzoIAMStrategy`
 * verifies it (JWKS, issuer hanzo.id) and its multi-tenant plugin scopes `pages`/`media`
 * to the token's `owner` claim — so a merchant only ever reads their OWN org's content
 * (isolation is BACKEND-enforced, per-tenant). This list is the defense-in-depth
 * boundary: it admits ONLY the two tenant-scoped collections (list) + the per-file media
 * bytes route, and DELIBERATELY refuses `api/users` and `api/tenants` — the two Payload
 * collections that are auth-gated but NOT tenant-row-scoped (listing them would leak the
 * cross-org user/tenant registry). Read-only by construction; the module never mutates.
 */
const CMS_MEDIA_FILE = /^api\/media\/file\/[^/]+$/
export function allowCmsSurface(path: string): boolean {
  const rel = path.replace(/^\/+/, '')
  if (rel === 'api/pages') return true // Collections list (tenant-scoped)
  if (rel === 'api/media') return true // Media/DAM list (tenant-scoped)
  if (CMS_MEDIA_FILE.test(rel)) return true // media bytes (tenant-scoped by Payload)
  return false
}

/**
 * Frappe/ERPNext (`erp.<brand>`) READ surface reachable through `/erp`. ERP is a SINGLE
 * shared per-brand Frappe instance (NOT per-org row-scoped), so the `/erp` route also
 * entitlement-gates to the owning brand org / a global admin — this list is the path
 * least-privilege boundary on top of that.
 *
 * Pinned to EXACTLY the three DocTypes the native summary views read (Accounting/Items/
 * Sales), NOT "any DocType" (RED LOW-1): an entitled brand member must not be able to
 * `GET /api/resource/User` / `Salary Slip` / `OAuth Bearer Token` through the shared
 * `ERP_API_TOKEN` — a brand-internal over-read the moment ERP ships with a broad token.
 * Read-only: only `GET /api/resource/<one of these>` (list); never a single-doc read,
 * `/api/method/*`, the desk, or login. A DocType with a space ("Sales Order") arrives as
 * one decoded segment; `bearer-proxy`'s `pathIsClean` still rejects encoded traversal.
 */
export const ERP_DOCTYPES: ReadonlySet<string> = new Set(['Account', 'Item', 'Sales Order'])
export function allowErpSurface(path: string): boolean {
  const m = path.replace(/^\/+/, '').match(/^api\/resource\/(.+)$/)
  return m != null && ERP_DOCTYPES.has(m[1])
}

/** Matches exactly `v1/collections/<name>/records` and `.../records/<id>` (one clean
 *  segment each — `bearer-proxy` has already rejected empty/dot/encoded segments). */
const BASE_RECORDS = /^v1\/collections\/[^/]+\/records(?:\/[^/]+)?$/

/** Matches a single content-type (collection) admin path `v1/collections/<name>` —
 *  view / update / delete ONE collection. The content-type builder needs this. */
const BASE_COLLECTION = /^v1\/collections\/[^/]+$/

/**
 * True iff `path` targets the Hanzo Base COLLECTION surface reachable through
 * `/superbase` as the signed-in user:
 *  - `v1/collections` — list the schemas (read) AND create a content type (POST);
 *  - `v1/collections/meta/scaffolds` — the base/auth/view field-template palette;
 *  - `v1/collections/<name>` — view / update / delete ONE content type (the builder);
 *  - `v1/collections/<name>/records[/<id>]` — that collection's records CRUD.
 *
 * Base authorizes every one of these itself: records by each collection's
 * ListRule/ViewRule/CreateRule/…, and ALL collection mutation behind its own
 * superuser gate (an org admin's minted token qualifies; a plain member gets an
 * honest 403), scoped per-org by the `X-Org-Id` the proxy stamps from the JWT
 * owner. This allow-list is the defense-in-depth boundary that keeps `/superbase`
 * from tunneling Base's NON-collection admin (settings / backups / logs) — it
 * stays a collections proxy, never a general Base tunnel.
 */
export function allowBaseSurface(path: string): boolean {
  const rel = path.replace(/^\/+/, '')
  if (rel === 'v1/collections') return true
  if (rel === 'v1/collections/meta/scaffolds') return true
  if (BASE_RECORDS.test(rel)) return true
  if (BASE_COLLECTION.test(rel)) return true
  return false
}
