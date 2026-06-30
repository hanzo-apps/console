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
 * `<orgId>/<email>`, because an IAM user's `name` is not necessarily their
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
 * Resolve THE CALLER's own IAM user — the authoritative `owner/name` sub plus
 * their current accessKey — so this request can mint/read/revoke their single
 * per-user hk- key.
 *
 * The hk- key is PER-USER (stored on the caller's own IAM user record), NOT
 * per-org: a user has exactly one regardless of how many orgs they belong to.
 * The org-scoped procedure has already proved the caller is a member of `orgId`
 * with the `organization:CRUD_apiKeys` scope, and we ONLY ever read the caller's
 * own server-set session identity — so the caller can never operate on anyone
 * else's key, in any org. `orgId` therefore does NOT gate identity; it is only
 * the UI/billing context the action is performed from.
 *
 *   1. Session sub (primary): the IAM-verified `owner/name` from login, resolved
 *      against IAM for the authoritative record + accessKey. This works in EVERY
 *      org the caller can see — including a global admin viewing an org that is
 *      not their IAM home org. (The former `owner === orgId` gate wrongly 404'd
 *      exactly that case — a cross-org / global-admin user — even though their
 *      identity and `mint-user-keys` were perfectly valid.)
 *   2. Email-in-org fallback: only when the session carries no IAM-resolvable
 *      sub (e.g. a legacy session whose sub is a console user id). Looks the user
 *      up by `owner=<orgId>&email=<email>` — correct for a self-serve tenant
 *      whose IAM org == the console org.
 *
 * Resolution is by IAM record, never by string reconstruction, because an IAM
 * user's `name` is NOT necessarily their email. Returns null only when neither
 * path finds a user — surfaced as a clear NOT_FOUND.
 */
async function resolveIamUser(
  orgId: string,
  ctx: { session: { user: { iamSub?: string; email?: string | null } } },
): Promise<ResolvedIamUser | null> {
  const iamSub = ctx.session.user.iamSub;
  if (iamSub) {
    const sessionUser = await iamGetUser(iamSub);
    if (sessionUser?.owner && sessionUser?.name) {
      return {
        sub: `${sessionUser.owner}/${sessionUser.name}`,
        accessKey: sessionUser.accessKey ?? "",
      };
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
