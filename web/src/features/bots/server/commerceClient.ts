import { TRPCError } from "@trpc/server";
import { env } from "@/src/env.mjs";
import {
  commerceUserAuthorization,
  type CommerceCaller,
} from "@/src/server/commerceUserAuth";

// ---------------------------------------------------------------------------
// Commerce API Client (bots surface) — multi-tenant by IAM identity.
//
// Every call authenticates AS the signed-in user via a short-lived per-user IAM
// JWT (see commerceUserAuth); commerce's EdgeAuth derives the org SERVER-SIDE
// from the verified `owner` claim. There is NO shared COMMERCE_SERVICE_TOKEN and
// NO default "hanzo" org — bot billing/credits now scope to the caller's own
// org instead of collapsing every tenant into one.
//
// Endpoints:
//   GET  /v1/users/:projectId/payment-methods
//   POST /v1/users/:projectId/payment-methods
//   GET  /v1/users/:projectId/subscriptions
//   GET  /v1/users/:projectId/orders
//   GET  /v1/users/:projectId/credits
//   GET  /v1/billing/balance
// ---------------------------------------------------------------------------

export type { CommerceCaller };

function commerceUrl(): string {
  return env.COMMERCE_API_URL ?? "http://commerce.hanzo.svc.cluster.local:8001";
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
  opts?: { body?: unknown; params?: Record<string, string | undefined> },
): Promise<T> {
  // Per-user IAM JWT — throws (fail-closed) if no identity / mint failure.
  const authorization = await commerceUserAuthorization(caller.iamSub);

  const base = commerceUrl();
  const url = new URL(path, base);
  if (opts?.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  // Forward the viewed org as the admin-gated `?org` view override (commerce
  // EdgeAuth honors it only for a global admin and strips it otherwise).
  if (caller.org) url.searchParams.set("org", caller.org);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) throw toTRPCError(res.status, text);
    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new TRPCError({
        code: "TIMEOUT",
        message: `Commerce API request timed out: ${method} ${path}`,
      });
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Commerce API connection error: ${(err as Error).message}`,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** GET helper */
export function commerceGet<T>(
  path: string,
  caller: CommerceCaller,
  params?: Record<string, string | undefined>,
): Promise<T> {
  return commerceRequest<T>("GET", path, caller, { params });
}

/** POST helper */
export function commercePost<T>(
  path: string,
  caller: CommerceCaller,
  body: unknown,
): Promise<T> {
  return commerceRequest<T>("POST", path, caller, { body });
}

// ---------------------------------------------------------------------------
// Typed Commerce API methods
// ---------------------------------------------------------------------------

export interface CommercePaymentMethod {
  id: string;
  type: "card" | "crypto" | "wire";
  label: string;
  last4?: string;
  brand?: string;
  walletAddress?: string;
  network?: string;
  bankName?: string;
  isDefault: boolean;
}

export interface CommerceInvoice {
  id: string;
  date: string;
  amount: number;
  status: "paid" | "pending" | "overdue";
  description: string;
  paymentMethod?: string;
}

export interface CommerceCredits {
  balance: number;
  currency: string;
}

export interface CommerceSubscription {
  id: string;
  plan: string;
  status: "active" | "cancelled" | "past_due";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  monthlyBase: number;
}

/**
 * List payment methods for a project (scoped by projectId within the caller's
 * own org, which commerce derives from the forwarded user token).
 */
export function listPaymentMethods(caller: CommerceCaller, projectId: string) {
  return commerceGet<CommercePaymentMethod[]>(
    `/v1/users/${projectId}/payment-methods`,
    caller,
  );
}

/**
 * Add a payment method for a project.
 */
export function addPaymentMethod(
  caller: CommerceCaller,
  projectId: string,
  data: {
    type: "card" | "crypto" | "wire";
    nonce?: string;
    walletAddress?: string;
    network?: string;
  },
) {
  return commercePost<{ id: string }>(
    `/v1/users/${projectId}/payment-methods`,
    caller,
    data,
  );
}

/**
 * Get credits balance for a project.
 */
export function getCredits(caller: CommerceCaller, projectId: string) {
  return commerceGet<CommerceCredits>(`/v1/users/${projectId}/credits`, caller);
}

/**
 * Get billing info (subscription + invoices) for a bot.
 */
export async function getBotBilling(
  caller: CommerceCaller,
  projectId: string,
  botId: string,
) {
  const [subscription, invoices] = await Promise.all([
    commerceGet<CommerceSubscription | null>(
      `/v1/users/${projectId}/subscriptions`,
      caller,
      { botId },
    ).catch(() => null),
    commerceGet<CommerceInvoice[]>(`/v1/users/${projectId}/orders`, caller, {
      botId,
      type: "invoice",
    }).catch(() => []),
  ]);

  return {
    currentPlan: subscription?.plan ?? "free",
    monthlyBase: subscription?.monthlyBase ?? 0,
    invoices: invoices ?? [],
  };
}

/**
 * Get the prepaid balance for the caller's org (via Commerce billing API).
 * Commerce's EdgeAuth locks the `/billing/` subject to the caller's verified
 * org, so this is the ORG's prepaid balance — the right gate for "can this org
 * afford to run a bot". Returns available balance in cents.
 */
export function getBillingBalance(caller: CommerceCaller, currency = "usd") {
  return commerceGet<{
    user: string;
    currency: string;
    balance: number;
    holds: number;
    available: number;
  }>("/v1/billing/balance", caller, { currency });
}

/**
 * Upgrade a bot's subscription tier.
 */
export function upgradeBotPlan(
  caller: CommerceCaller,
  projectId: string,
  botId: string,
  tier: string,
) {
  return commercePost<{ ok: boolean }>(
    `/v1/users/${projectId}/subscriptions`,
    caller,
    { botId, plan: tier },
  );
}
