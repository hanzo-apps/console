/**
 * Per-user authentication for Hanzo Commerce calls — the ONE way console
 * authenticates a billing/bots commerce request to the signed-in user's org.
 *
 * Decomplected from the HTTP clients (separation of concerns): the commerce
 * clients own transport; this module owns the decision "as whom, and to which
 * org does commerce bill this call". The answer is ALWAYS the authenticated
 * user — never a shared, all-org service token.
 *
 * console forwards a short-lived IAM JWT minted for the session user (audience
 * = COMMERCE_API_AUDIENCE). Commerce's EdgeAuth verifies it against the IAM
 * JWKS and mints `X-Org-Id` from the token's `owner` claim, so the org is
 * derived SERVER-SIDE from a cryptographically-verified identity — a client
 * cannot assert another org, and commerce locks every `/billing/` subject to
 * that org. This replaces the spoofable `COMMERCE_SERVICE_TOKEN` + client-set
 * `X-Hanzo-Org` pair.
 *
 * FAIL-CLOSED: if there is no IAM identity on the session, or a per-user token
 * cannot be minted, we throw. We NEVER fall back to a shared service token —
 * that would silently re-open the cross-tenant hole this module exists to close.
 *
 * Server-only. Never import into a client bundle.
 */
import { TRPCError } from "@trpc/server";
import { env } from "@/src/env.mjs";
import { iamIssueUserToken } from "@/src/features/auth/lib/iamServer";

/**
 * Identifies the caller of a commerce request — the one shared shape both the
 * billing and bots commerce clients pass.
 *
 * - `iamSub` is the authenticated session user's own IAM sub
 *   (`ctx.session.user.iamSub`) — NEVER client-supplied. Commerce bills the org
 *   in this identity's verified `owner` claim.
 * - `org` is the org slug the UI is viewing. It is forwarded as `?org` so
 *   commerce's EdgeAuth re-points the billing view to it FOR A GLOBAL ADMIN ONLY;
 *   for everyone else EdgeAuth ignores it and the call stays scoped to the
 *   user's own org (fail-closed cross-tenant isolation). It also selects
 *   test-mode (sandbox) for BILLING_TEST_ORG_SLUGS.
 */
export type CommerceCaller = {
  iamSub: string | undefined;
  org: string;
};

/**
 * Resolve the `Authorization` header for a per-user commerce call: `Bearer
 * <iam-jwt>` minted for `iamSub` with the commerce audience. Throws (fail-closed)
 * when no IAM identity is present or the token cannot be issued.
 *
 * `iamSub` MUST be the authenticated session user's own IAM sub
 * (`ctx.session.user.iamSub`) — never client-supplied input.
 */
export async function commerceUserAuthorization(
  iamSub: string | undefined,
): Promise<string> {
  if (!iamSub) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        "No IAM identity on the session; cannot authenticate to commerce as this user. Sign in again.",
    });
  }

  const token = await iamIssueUserToken(iamSub, env.COMMERCE_API_AUDIENCE);
  if (!token) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        "Could not issue a per-user commerce token for the signed-in user; refusing to bill via a shared service token.",
    });
  }

  return `Bearer ${token}`;
}
