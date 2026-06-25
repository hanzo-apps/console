/**
 * Cloud API Keys (hk-) — the self-serve surface for a tenant's Hanzo Cloud API
 * key (the `hk-…` Bearer credential accepted by api.hanzo.ai for chat /
 * completions / RAG, metered + billed against the tenant's org).
 *
 * This is DISTINCT from the project/org observability keys (`pk-hz-`/`sk-hz-`,
 * Langfuse ingestion). A tenant has exactly ONE per-user hk- key, stored on
 * their IAM user record (`User.AccessKey`). The full key is shown ONCE at mint
 * time; afterwards only its masked prefix is returned (the secret is never
 * re-read from IAM into the client).
 *
 * Identity: the IAM `sub` is reconstructed as `<orgId>/<email>` — the console
 * org id IS the user's IAM org slug (one tenant = one slug), and email is the
 * IAM username under email-as-username. The session user's own email + the
 * org-scoped procedure (membership-checked) are the only inputs; the caller can
 * never mint for someone else. The minted value is read back from IAM (which is
 * the authority) so the UI shows the real key.
 */
import * as z from "zod";
import {
  createTRPCRouter,
  protectedOrganizationProcedure,
} from "@/src/server/api/trpc";
import { throwIfNoOrganizationAccess } from "@/src/features/rbac/utils/checkOrganizationAccess";
import { auditLog } from "@/src/features/audit-logs/auditLog";
import {
  iamGetUser,
  iamMintUserKeys,
  iamRevokeUserKeys,
} from "@/src/features/auth/lib/iamServer";
import { TRPCError } from "@trpc/server";

/** Mask a hk- key to a display-safe prefix (e.g. "hk-3310a1a1…"). */
function maskKey(key: string): string {
  if (!key) return "";
  const head = key.slice(0, 11); // "hk-" + 8 chars
  return `${head}…`;
}

/**
 * Resolve the IAM `sub` whose hk- key this org-scoped request operates on.
 *
 * Authoritative path: the session carries the verified IAM `sub` from login
 * (`session.user.iamSub`), which is correct for EVERY user — self-serve tenants
 * (`<slug>/<email>`), shared-org users (`hanzo/z`, where username != email), and
 * global admins (their own home-org sub). We use it whenever it belongs to THIS
 * org (the org-scoped procedure already proved membership), so a member of
 * multiple orgs always resolves to their own identity in the active org.
 *
 * Fallback (no `iamSub` in the session — legacy cookie): positionally
 * reconstruct `<orgId>/<email>`. This only holds for the dedicated-org
 * self-serve case (console org id == IAM slug, email-as-username); for other
 * users it may not resolve, which the callers surface as a clear NOT_FOUND
 * rather than acting on the wrong identity.
 */
async function resolveIamSub(
  orgId: string,
  ctx: { session: { user: { iamSub?: string; email?: string | null } } },
): Promise<string | null> {
  const iamSub = ctx.session.user.iamSub;
  if (iamSub) {
    // The sub's org segment must match the active org so a multi-org user can't
    // mint a key in an org their session sub doesn't belong to. If it doesn't
    // match (e.g. an admin viewing another org), fall through to positional.
    const owner = iamSub.split("/")[0];
    if (owner && owner.toLowerCase() === orgId.toLowerCase()) return iamSub;
  }
  const email = (ctx.session.user.email ?? "").toLowerCase();
  if (!email) return null;
  return `${orgId}/${email}`;
}

export const cloudApiKeyRouter = createTRPCRouter({
  /** Whether the tenant has a Cloud API key, and its masked prefix. */
  get: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ input, ctx }) => {
      // Same scope gate as mint/revoke — reading even the masked key is a
      // key-management action, not a plain membership read.
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "organization:CRUD_apiKeys",
        session: ctx.session,
      });
      const sub = await resolveIamSub(input.orgId, ctx);
      const user = sub ? await iamGetUser(sub) : null;
      const accessKey = user?.accessKey ?? "";
      return {
        hasKey: Boolean(accessKey),
        maskedKey: accessKey ? maskKey(accessKey) : null,
      };
    }),

  /**
   * (Re)generate the tenant's Cloud API key. Returns the FULL hk- key — shown
   * once in the UI. Regenerating invalidates the previous key.
   */
  mint: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "organization:CRUD_apiKeys",
        session: ctx.session,
      });
      const sub = await resolveIamSub(input.orgId, ctx);

      // Confirm the IAM user exists for this sub before minting so we fail
      // clearly rather than minting onto a non-existent record.
      const user = sub ? await iamGetUser(sub) : null;
      if (!sub || !user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "No IAM identity for this account in this organization. Sign out and back in, then retry.",
        });
      }

      const result = await iamMintUserKeys(sub);
      if (!result.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error,
        });
      }

      await auditLog({
        session: ctx.session,
        orgId: input.orgId,
        resourceType: "organization",
        resourceId: input.orgId,
        action: "mintCloudApiKey",
      });

      return { accessKey: result.accessKey };
    }),

  /** Revoke the tenant's Cloud API key. */
  revoke: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      throwIfNoOrganizationAccess({
        organizationId: input.orgId,
        scope: "organization:CRUD_apiKeys",
        session: ctx.session,
      });
      const sub = await resolveIamSub(input.orgId, ctx);
      if (!sub) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No IAM identity for this account in this organization.",
        });
      }

      const result = await iamRevokeUserKeys(sub);
      if (!result.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error,
        });
      }

      await auditLog({
        session: ctx.session,
        orgId: input.orgId,
        resourceType: "organization",
        resourceId: input.orgId,
        action: "revokeCloudApiKey",
      });

      return { ok: true };
    }),
});
