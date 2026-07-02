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
  FileText,
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
   * When set, the service is NOT embedded via the same-origin proxy/iframe; the
   * embed page redirects the browser straight to this URL on the service's OWN
   * origin. Required for apps that run their own cross-origin OIDC flow (e.g.
   * Chat/LibreChat): embedding them behind console's origin breaks the OIDC
   * redirect + host-scoped session cookie, so the user is never signed in and
   * lands on the app's sign-in landing instead. For an OIDC app this is the
   * login-initiation deep-link, so a user already signed into hanzo.id lands in
   * the app already authenticated. Public + client-safe; takes precedence over
   * `upstreamBaseUrl`.
   */
  externalUrl?: string;
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
  /**
   * When true, the SSO proxy injects the server-side `x-hanzo-proxy-secret`
   * header (from `HANZO_PROXY_SECRET`) so the upstream can trust this
   * same-origin proxy for header-based auth (e.g. @hanzo/cms's proxy strategy).
   * The secret is server-only and any client copy is stripped. Fail-secure:
   * when the env is unset the header is omitted and the upstream rejects the
   * trusted-proxy path.
   */
  injectProxySecret?: boolean;
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
  {
    slug: "content",
    title: "Content",
    icon: FileText,
    group: RouteGroup.Content,
    productModule: "cms",
    // @hanzo/cms (Payload fork) — Base/SQLite + SeaweedFS media, per-org.
    // The CMS admin authenticates via the same-origin SSO proxy: console has
    // already verified the IAM session and the proxy injects x-org-id (==
    // IAM org == CMS tenant) + x-actor-id + the shared HANZO_PROXY_SECRET, so
    // the embedded admin is scoped to the current org with no second login.
    // Admin (collections / media / publishing) is served at /admin.
    upstreamBaseUrl: () =>
      firstEnv("CMS_DASHBOARD_URL", "CMS_APP_URL"),
    // Payload admin is a Next.js app: rewrite its root-absolute asset + API
    // prefixes into the proxy mount so it renders through the same origin.
    rewritePrefixes: ["/admin/", "/_next/", "/api/", "/static/", "/favicon"],
    rootPath: "/admin",
    // CMS admin auth is header-based (hanzoProxyStrategy): trust this proxy.
    injectProxySecret: true,
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
    // Chat (LibreChat) authenticates with its own @hanzo/iam OIDC and cannot be
    // embedded behind console's origin (the OIDC redirect + hanzo.chat-scoped
    // cookie break, dropping the session). Link out to its OIDC login-initiation
    // deep-link on its own origin: a user already signed into hanzo.id is
    // silently signed in and lands in the chat app. `upstreamBaseUrl` stays so
    // the operator's CHAT_APP_URL still documents the deployed host.
    externalUrl: "https://hanzo.chat/oauth/openid",
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
