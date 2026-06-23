/**
 * Route section + group enums — pure data, decomplected from `routes.tsx`.
 *
 * These were defined inline in `routes.tsx`, which pulls in React, lucide
 * icons, and a large web of feature modules. Server-only code (the embedded-
 * service registry/proxy) needs only these enums, so they live here on their
 * own to avoid dragging the whole `routes.tsx` graph (and its client-only
 * imports) into a server bundle. `routes.tsx` re-exports them, so existing
 * `import { RouteGroup } from ".../routes"` call sites are unchanged.
 */

export enum RouteSection {
  Main = "main",
  Secondary = "secondary",
}

export enum RouteGroup {
  Observability = "Observability",
  PromptManagement = "Prompt Management",
  Evaluation = "Evaluation",
  SearchAI = "Search & AI",
  Agents = "Agents",
  Bots = "Bots",
  Base = "Base",
  Tasks = "Tasks",
  Functions = "Functions",
  KMS = "KMS",
  ZT = "Zero Trust",
  Infrastructure = "Infrastructure",
  Referrals = "Referrals",
}
