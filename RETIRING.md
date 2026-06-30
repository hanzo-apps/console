# RETIRING — this repo is superseded by hanzoai/console2

`hanzoai/console` is the legacy **Langfuse-fork** console (`hanzo` v3.x). It is
being retired. Live forward with **hanzoai/console2** (clean `@hanzo/gui` SPA over
the unified `/v1` backend). One frontend, one way.

## Parity — console2 is a complete SUPERSET (audited 2026-06-30)

Every old `project/[projectId]/*` surface is present in console2, plus the
cloud-native primitives console never had (gpus, vpc, hsm, s3, dns, cdn, kv,
docdb, service-mesh, settlement, …).

| Old console surface | console2 |
|---|---|
| traces, observations, sessions, scores, score-configs | ✓ (o11y/observations) |
| datasets, evals, experiments, prompts, playground | ✓ |
| agents, bots, models, cloud-models, pricing | ✓ (ModelCatalogModule + `/v1/pricing*`, live) |
| dashboards, widgets | ✓ (dashboards) |
| infrastructure, svc | ✓ (clusters/machines/applications/service-mesh) |
| kms, mpc, users, search, vector, referrals, zt, settings | ✓ |
| integrations (blob/Slack/Mixpanel/Insights) | ✓ |
| `explorer` | external link to explore.lux.network — NOT a console feature (drop) |
| `automations` | Langfuse-internal webhooks, no unified `/v1` equivalent — intentionally dropped |

## Deletion runbook (DO NOT delete until step 1 is done)

1. **GATE — o11y backend.** This repo is still the LIVE trace store. Trace data
   must move to the SigNoz-based o11y in **hanzoai/datastore**; console2 already
   renders `/v1/o11y` (honest 503 until then). Do not delete trace data before
   the migration.
2. **Flip the edge.** In `universe/infra/k8s/ingress/routes.yaml`: replace the
   `console-hanzo-ai` router (→ `console.hanzo.svc`) with a redirect
   `console.hanzo.ai → https://cloud.hanzo.ai` (same redirectRegex pattern as
   `llm-redirect-to-api`); drop the `console-hanzo-ai` service. The gateway
   `routes.yaml` already 301s console.hanzo.ai → cloud.hanzo.ai.
3. **Stop deploying** the `console` Service; remove its operator CR + `console.hanzo.svc`.
4. **Archive** this repo (GitHub → Archive), then delete after a deprecation window.

Until then: console.hanzo.ai stays on this app so existing trace links resolve.
