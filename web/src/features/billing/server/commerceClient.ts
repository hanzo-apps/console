import { TRPCError } from "@trpc/server";
import { env } from "@/src/env.mjs";
import {
  commerceUserAuthorization,
  type CommerceCaller,
} from "@/src/server/commerceUserAuth";

// Re-export so existing importers (cloudBillingRouter) keep their import path.
export type { CommerceCaller };

/**
 * HTTP client for the Hanzo Commerce service — multi-tenant by IAM identity.
 *
 * Every call authenticates AS the signed-in user: console forwards a short-lived
 * per-user IAM JWT (see commerceUserAuth) and commerce's EdgeAuth derives the
 * billed org SERVER-SIDE from the token's verified `owner` claim, locking each
 * `/billing/` subject to that org. There is NO shared service token and NO
 * client-asserted org header — a client can no longer name another tenant.
 *
 * FAIL-CLOSED: when the user's per-user token cannot be issued, the request
 * throws (commerceUserAuthorization) — it NEVER falls back to a shared token.
 */

function baseUrl(): string {
  return env.COMMERCE_API_URL;
}

// Orgs whose billing routes through Square SANDBOX (test mode). For these the
// console sends `X-Hanzo-Test: true`, which commerce reads to treat the call as
// test (org.Live=false → sandbox vault/charge and a sandbox payment-config).
// Comma-separated org slugs in BILLING_TEST_ORG_SLUGS; every other org stays on
// production Square. Server-only (process.env). EdgeAuth does not strip
// X-Hanzo-Test (only identity headers), so this still reaches commerce's IAM
// path (liveFromHeaders) under the per-user-JWT auth.
const TEST_ORG_SLUGS = new Set(
  (process.env.BILLING_TEST_ORG_SLUGS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

function isTestOrg(org?: string): boolean {
  return !!org && TEST_ORG_SLUGS.has(org);
}

function toTRPCError(status: number, body: string): TRPCError {
  const map: Record<number, TRPCError["code"]> = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    429: "TOO_MANY_REQUESTS",
  };
  return new TRPCError({
    code: map[status] ?? "INTERNAL_SERVER_ERROR",
    message: `Commerce API error (${status}): ${body}`,
  });
}

async function commerceRequest<T>(
  method: string,
  path: string,
  caller: CommerceCaller,
  opts?: {
    body?: unknown;
    params?: Record<string, string | undefined>;
    headers?: Record<string, string>;
  },
): Promise<T> {
  // Per-user IAM JWT — throws (fail-closed) if no identity / mint failure.
  const authorization = await commerceUserAuthorization(caller.iamSub);

  const url = new URL(path, baseUrl());
  if (opts?.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  // Forward the viewed org as the admin-gated `?org` view override. EdgeAuth
  // honors it only for a global admin and strips it unconditionally, so it can
  // never weaken isolation for a normal user (their org stays pinned to the
  // verified token owner).
  if (caller.org) url.searchParams.set("org", caller.org);

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      ...(isTestOrg(caller.org) ? { "X-Hanzo-Test": "true" } : {}),
      ...(opts?.headers ?? {}),
    },
    ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
  });

  const text = await res.text();
  if (!res.ok) throw toTRPCError(res.status, text);

  return text ? (JSON.parse(text) as T) : ({} as T);
}

export function commerceGet<T>(
  path: string,
  caller: CommerceCaller,
  params?: Record<string, string | undefined>,
  headers?: Record<string, string>,
): Promise<T> {
  return commerceRequest<T>("GET", path, caller, { params, headers });
}

export function commercePost<T>(
  path: string,
  caller: CommerceCaller,
  body: unknown,
  params?: Record<string, string | undefined>,
  headers?: Record<string, string>,
): Promise<T> {
  return commerceRequest<T>("POST", path, caller, { body, params, headers });
}

export function commercePatch<T>(
  path: string,
  caller: CommerceCaller,
  body: unknown,
  params?: Record<string, string | undefined>,
  headers?: Record<string, string>,
): Promise<T> {
  return commerceRequest<T>("PATCH", path, caller, { body, params, headers });
}

export function commercePut<T>(
  path: string,
  caller: CommerceCaller,
  body: unknown,
  params?: Record<string, string | undefined>,
  headers?: Record<string, string>,
): Promise<T> {
  return commerceRequest<T>("PUT", path, caller, { body, params, headers });
}

export function commerceDelete<T>(
  path: string,
  caller: CommerceCaller,
  params?: Record<string, string | undefined>,
  headers?: Record<string, string>,
): Promise<T> {
  return commerceRequest<T>("DELETE", path, caller, { params, headers });
}
