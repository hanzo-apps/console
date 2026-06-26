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
 * Identity: the caller's IAM user is resolved against IAM itself (the authority)
 * by org + email, yielding the canonical `owner/name` sub — NOT reconstructed as
 * `<orgId>/<email>`, because a Casdoor user's `name` is not necessarily their
 * email even in an email-as-username org. The session user's own email + the
 * org-scoped procedure (membership-checked) are the only inputs; the caller can
 * never operate on anyone else's key. The minted value is read back from IAM so
 * the UI shows the real key. See {@link resolveIamUser}.
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
  iamGetUserByOrgEmail,
  iamMintUserKeys,
  iamRevokeUserKeys,
} from "@/src/features/auth/lib/iamServer";
import { TRPCError } from "@trpc/server";

/** A resolved IAM identity: the canonical `owner/name` sub + its user record. */
type ResolvedIamUser = {
  sub: string;
  accessKey: string;
};

/** Mask a hk- key to a display-safe prefix (e.g. "hk-3310a1a1…"). */
function maskKey(key: string): string {
  if (!key) return "";
  const head = key.slice(0, 11); // "hk-" + 8 chars
  return `${head}…`;
}

/**
 * Resolve the IAM user whose hk- key this org-scoped request operates on, as the
 * authoritative `owner/name` sub plus the user's current accessKey. The
 * org-scoped procedure already proved the caller is a member of `orgId`, so we
 * always resolve THE CALLER's own identity in the active org — never anyone
 * else's.
 *
 * Resolution is by IAM record, not by string reconstruction, because a Casdoor
 * user's `name` is NOT necessarily their email — even in an `useEmailAsUsername`
 * org a user can pre-exist with a non-email username (e.g. `maxpower/davelorenzini`
 * for `davelorenzini@gmail.com`). The old positional `${orgId}/${email}` (and the
 * email-form session sub) therefore hit `get-user?id=…@gmail.com` → null → the
 * "No IAM identity for this account in this organization" error, even though the
 * record exists and `mint-user-keys` works against the real sub.
 *
 *   1. Session sub fast-path: if `session.user.iamSub` belongs to THIS org AND
 *      resolves to a real IAM user, use it (covers shared-org users where
 *      username != email, and avoids an extra lookup).
 *   2. Authoritative fallback: look the user up by `owner=<orgId>&email=<email>`
 *      (exact email lookup within the org) and use the record's real
 *      `owner/name` sub.
 *
 * Returns null only when neither path finds a user — surfaced as a clear
 * NOT_FOUND rather than acting on a non-existent / wrong identity.
 */
async function resolveIamUser(
  orgId: string,
  ctx: { session: { user: { iamSub?: string; email?: string | null } } },
): Promise<ResolvedIamUser | null> {
  const iamSub = ctx.session.user.iamSub;
  if (iamSub) {
    const owner = iamSub.split("/")[0];
    // The sub's org segment must match the active org so a multi-org user can't
    // operate on a key in an org their session sub doesn't belong to.
    if (owner && owner.toLowerCase() === orgId.toLowerCase()) {
      const sessionUser = await iamGetUser(iamSub);
      if (sessionUser) {
        return { sub: iamSub, accessKey: sessionUser.accessKey ?? "" };
      }
    }
  }
  const email = (ctx.session.user.email ?? "").toLowerCase();
  if (!email) return null;
  const user = await iamGetUserByOrgEmail(orgId, email);
  if (!user?.owner || !user?.name) return null;
  return { sub: `${user.owner}/${user.name}`, accessKey: user.accessKey ?? "" };
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
      const resolved = await resolveIamUser(input.orgId, ctx);
      const accessKey = resolved?.accessKey ?? "";
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
      // Resolve the caller's real IAM identity (by `owner/name`, not email) —
      // this both confirms the user exists and gives the canonical sub to mint
      // against, so we fail clearly rather than minting onto a non-existent id.
      const resolved = await resolveIamUser(input.orgId, ctx);
      if (!resolved) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "No IAM identity for this account in this organization. Sign out and back in, then retry.",
        });
      }

      const result = await iamMintUserKeys(resolved.sub);
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
      const resolved = await resolveIamUser(input.orgId, ctx);
      if (!resolved) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No IAM identity for this account in this organization.",
        });
      }

      const result = await iamRevokeUserKeys(resolved.sub);
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
