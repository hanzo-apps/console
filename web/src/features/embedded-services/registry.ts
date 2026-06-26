/**
 * Embedded-service registry — the ONE source of truth for every Hanzo service
 * dashboard that console embeds per-org via the same-origin SSO proxy.
 *
 * One entry here drives three things, so a new service is added in exactly one
 * place (DRY, no copy-paste of route + proxy + nav):
 *   1. the dynamic SSO proxy route  `/api/svc/[service]/[[...path]]`
 *      (→ `createServiceProxy`, see `@/src/server/service-proxy`)
 *   2. the dynamic embed page        `/project/[projectId]/svc/[service]`
 *      (→ `EmbeddedDashboard`, see `@/src/components/embed/EmbeddedDashboard`)
 *   3. the per-org nav entries        (see `serviceRoutes()` in
 *      `@/src/components/layouts/routes`)
 *
 * Each entry is env-driven (upstream URL is server-only and resolved at request
 * time) and an entry is only *active* when its upstream URL is configured — so
 * the catalog an org actually sees is exactly the set of services deployed for
 * that brand/cluster, not a hardcoded list. This keeps the registry the single
 * declaration while the live catalog is data-driven by the deployment.
 *
 * Server-only resolution (`upstreamBaseUrl`) must never run in a client bundle;
 * the client-safe view ({slug,title,icon,group,...}) is exposed via
 * `EMBEDDED_SERVICE_NAV`.
 */
import {
  Database,
  MessageSquare,
  Workflow,
  ShoppingCart,
  KeyRound,
  Boxes,
  type LucideIcon,
} from "lucide-react";
import { RouteGroup } from "@/src/components/layouts/route-groups";
import { type ProductModule } from "@/src/features/ui-customization/productModuleSchema";

/**
 * A single embeddable service. `upstreamBaseUrl` is server-only; everything else
 * is safe to ship to the client for nav rendering.
 */
export type EmbeddedServiceDef = {
  /** URL-safe stable id; the proxy mount is `/api/svc/<slug>` and the page is
   * `/project/[projectId]/svc/<slug>`. */
  slug: string;
  /** Human title shown in nav + embed toolbar. */
  title: string;
  /** Sidebar icon. */
  icon: LucideIcon;
  /** Sidebar group the entry is filed under. */
  group: RouteGroup;
  /** Product module used to show/hide the entry via UI customization. */
  productModule: ProductModule;
  /**
   * Resolve the upstream base URL (server-only). Return undefined when the
   * service is not configured for this deployment — such services are inactive
   * (hidden from nav, 503 from the proxy) rather than hardcoded-on.
   */
  upstreamBaseUrl: () => string | undefined;
  /**
   * Root-absolute upstream prefixes to rewrite into the proxy mount in text
   * responses so an embedded SPA loads through the same-origin proxy. See
   * `ServiceProxyOptions.rewritePrefixes`.
   */
  rewritePrefixes?: string[];
  /**
   * Bare single-segment upstream paths that must keep a trailing slash on the
   * upstream request (e.g. PocketBase `_`). See
   * `ServiceProxyOptions.forceTrailingSlashFor`.
   */
  forceTrailingSlashFor?: string[];
  /**
   * Optional bare path suffix the iframe should request under the mount (e.g.
   * Base serves its admin UI at `/_`). Defaults to the mount root.
   */
  rootPath?: string;
};

/** First defined env var value, trimmed; undefined when none are set. */
function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const v = process.env[name];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

/**
 * The registry. Order here is the order services appear within their nav group.
 *
 * Every Hanzo service that exposes a tenant-scoped dashboard belongs here. An
 * entry whose `upstreamBaseUrl()` is undefined is simply inactive for this
 * deployment — add the `*_URL` env var (operator CR) to light it up; no code
 * change. This is how "embed ALL the org's services" stays one declaration
 * while the live set is driven by what the cluster actually runs.
 */
export const EMBEDDED_SERVICES: readonly EmbeddedServiceDef[] = [
  {
    slug: "base",
    title: "Base",
    icon: Database,
    group: RouteGroup.Base,
    productModule: "base",
    upstreamBaseUrl: () =>
      firstEnv("BASE_DASHBOARD_URL", "BASE_API_URL") ?? "https://base.hanzo.ai",
    // Base (PocketBase) emits /_/assets/* + runtime /api/* — re-point at mount.
    rewritePrefixes: ["/_/", "/api/"],
    // Base 307-redirects `/_` → `/_/`; force the slash on the upstream request.
    forceTrailingSlashFor: ["_"],
    // Admin UI lives at /_ (slash-less so Next.js trailingSlash:false is happy).
    rootPath: "/_",
  },
  // NOTE: no embedded "playground" service here — the native Playground page
  // (/project/[projectId]/playground, productModule "playground") is the one
  // way to do Playground. A second embedded entry produced a duplicate
  // "Playground" in the Prompt Management group; removed to keep one product,
  // one nav entry.
  {
    slug: "chat",
    title: "Chat",
    icon: MessageSquare,
    group: RouteGroup.Agents,
    productModule: "agents",
    upstreamBaseUrl: () => firstEnv("CHAT_APP_URL"),
    rewritePrefixes: ["/assets/", "/static/", "/favicon", "/api/"],
  },
  {
    slug: "flow",
    title: "Flow",
    icon: Workflow,
    group: RouteGroup.Agents,
    productModule: "agents",
    upstreamBaseUrl: () => firstEnv("FLOW_APP_URL"),
    rewritePrefixes: ["/assets/", "/static/", "/favicon", "/api/"],
  },
  // NOTE: no embedded "bot" service here — the native Bots dashboard
  // (/project/[projectId]/bots, productModule "bots") is the one way to do
  // Bots. A second embedded entry produced a duplicate ("Bot Dashboard" +
  // "Bots") in the Bots group; removed to keep one product, one nav entry.
  //
  // NOTE: no embedded "search" service here either — the native Search panel
  // (/project/[projectId]/search and its Indexes/Keys/Playground/Vector
  // sub-pages, productModule "search") is canonical. A second embedded entry
  // produced a duplicate "Search" in the Search & AI group; removed.
  {
    slug: "commerce",
    title: "Commerce",
    icon: ShoppingCart,
    group: RouteGroup.Functions,
    productModule: "functions",
    upstreamBaseUrl: () => firstEnv("COMMERCE_ADMIN_URL"),
    rewritePrefixes: ["/assets/", "/_next/", "/static/", "/favicon", "/api/"],
  },
  {
    slug: "kms",
    title: "KMS",
    icon: KeyRound,
    group: RouteGroup.KMS,
    productModule: "kms",
    upstreamBaseUrl: () => firstEnv("KMS_DASHBOARD_URL", "KMS_API_URL"),
    rewritePrefixes: ["/assets/", "/_next/", "/static/", "/favicon", "/api/"],
  },
  {
    slug: "infrastructure",
    title: "Infrastructure",
    icon: Boxes,
    group: RouteGroup.Infrastructure,
    productModule: "infrastructure",
    upstreamBaseUrl: () => firstEnv("PLATFORM_APP_URL"),
    rewritePrefixes: ["/assets/", "/_next/", "/static/", "/favicon", "/api/"],
  },
] as const;

/** Look up a service definition by slug (server-side proxy + page resolution). */
export function getEmbeddedService(
  slug: string | undefined,
): EmbeddedServiceDef | undefined {
  if (!slug) return undefined;
  return EMBEDDED_SERVICES.find((s) => s.slug === slug);
}

/** The same-origin proxy mount for a service slug. */
export function serviceMountPath(slug: string): string {
  return `/api/svc/${slug}`;
}

/** Services that are configured (have an upstream) for THIS deployment. Server-only. */
export function activeEmbeddedServices(): EmbeddedServiceDef[] {
  return EMBEDDED_SERVICES.filter((s) => Boolean(s.upstreamBaseUrl()));
}

/**
 * Client-safe nav view of the registry (no server-only `upstreamBaseUrl`).
 * Used by the routes module to generate one nav entry per service. The page
 * itself 503s if a given service is not actually configured, so listing the
 * full registry in nav is safe and keeps the client bundle env-free.
 */
export type EmbeddedServiceNav = {
  slug: string;
  title: string;
  icon: LucideIcon;
  group: RouteGroup;
  productModule: ProductModule;
};

export const EMBEDDED_SERVICE_NAV: readonly EmbeddedServiceNav[] =
  EMBEDDED_SERVICES.map(({ slug, title, icon, group, productModule }) => ({
    slug,
    title,
    icon,
    group,
    productModule,
  }));
