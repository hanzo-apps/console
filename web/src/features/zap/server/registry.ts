/**
 * Central ZAP scope registry — the server-side backbone of the tRPC→ZAP
 * strangler. Each domain ("scope") registers a module that knows how to
 * resolve a tool's RBAC scope and dispatch it. The generic `/v1/zap/[scope]`
 * route does auth + RBAC + dispatch against this registry, so adding a domain
 * to ZAP never touches the route, auth, or RBAC plumbing again.
 *
 * A scope module is exactly the shape the proven `zt` feature already exposes
 * (`getToolScope` + `callTool`), so existing tool modules plug in unchanged.
 *
 * Server-only.
 */

export interface ZapToolRequest {
  name: string;
  args: Record<string, unknown>;
}

export interface ZapToolResponse<T = unknown> {
  content: T;
}

/** A domain's tool module: RBAC resolution + dispatch. */
export interface ZapScopeModule {
  /** RBAC scope string a tool requires (e.g. "prompts:read"), or null if unknown. */
  getToolScope: (name: string) => string | null;
  /** Dispatch a tool call. Throws on unknown tool. */
  callTool: (request: ZapToolRequest) => Promise<ZapToolResponse>;
}

const scopes = new Map<string, ZapScopeModule>();

/** Register a domain's ZAP tools under its scope prefix (e.g. "prompts"). */
export function registerZapScope(scope: string, mod: ZapScopeModule): void {
  scopes.set(scope, mod);
}

/** Resolve the scope module for a `<scope>.<method>` tool name. */
export function getZapScopeModule(scopePrefix: string): ZapScopeModule | null {
  return scopes.get(scopePrefix) ?? null;
}

/** The scope prefix of a tool name: "prompts.all" → "prompts". */
export function scopePrefixOf(toolName: string): string {
  return toolName.split(".")[0] ?? "";
}
