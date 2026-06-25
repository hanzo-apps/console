/**
 * IAM → console organization/membership sync — the ONE place console maps IAM
 * identity onto its own Organization/Membership model, reconciled on every
 * login (decomplected from session hydration, which only READS the result).
 *
 * Why this exists: IAM is the identity authority, but console renders orgs from
 * its own `Organization`/`OrganizationMembership` tables. Without a sync, an IAM
 * user (especially a global admin owned by the `admin` org) lands with zero
 * console orgs and can't reach any per-org surface. This module makes the IAM
 * truth the console truth, idempotently:
 *
 *   - A GLOBAL ADMIN (IAM-owned by an org in HANZO_ADMIN_IAM_ORGS — default
 *     `admin` — or flagged isGlobalAdmin/isAdmin in IAM, or whose email domain
 *     is in HANZO_ADMIN_EMAIL_DOMAINS) becomes OWNER of EVERY console org. We
 *     first ensure a console org exists for each IAM org under the `admin`
 *     owner, then grant OWNER on all of them.
 *   - A NORMAL USER becomes a MEMBER of their own IAM org (the `owner` field on
 *     their IAM user / the org segment of their `sub`).
 *
 * Console orgs are keyed to IAM orgs by `Organization.metadata.iamOrg` so the
 * mapping is stable and reconcilable across logins (mirrors the canonical
 * org-create pattern in `initialize.ts`). Membership rows are upserted, never
 * duplicated (unique `(orgId,userId)`). We never DOWNGRADE a manually-elevated
 * role: a normal-user sync only *adds* membership; the admin path sets OWNER.
 *
 * Server-only. Never import into a client bundle.
 */
import { prisma, Role } from "@hanzo/console/src/db";
import { logger } from "@hanzo/console/src/server";
import { env } from "@/src/env.mjs";
import {
  iamGetUser,
  iamGetOrganization,
} from "@/src/features/auth/lib/iamServer";
import {
  orgFromSub,
  isGlobalAdminIdentity,
  roleRank,
  parseLowerSet,
  parseEmailDomains,
} from "@/src/features/auth/lib/iamSyncPolicy";

/** The IAM identity we sync from (sub = "org/username"). */
type IamIdentityRef = { sub: string; email: string };

/** IAM org names whose members are global admins (default `admin`). */
function adminIamOrgs(): Set<string> {
  return parseLowerSet(env.HANZO_ADMIN_IAM_ORGS ?? "admin");
}

/** Configured admin email domains (mirrors `isInstanceAdminEmail` in iamSession). */
function adminEmailDomains(): string[] {
  return parseEmailDomains(env.HANZO_ADMIN_EMAIL_DOMAINS);
}

/**
 * The canonical tenant org ids — the real tenants a global admin should own,
 * NOT the per-user personal orgs in IAM. Sourced from INIT_ORG_IDS (the seed:
 * hanzo,lux,zoo,pars). `env.INIT_ORG_IDS` is already parsed to a string[].
 */
function tenantOrgIds(): string[] {
  return (env.INIT_ORG_IDS as string[] | undefined) ?? [];
}

/**
 * Ensure a console Organization exists for the given IAM org. Returns the
 * console org id. The console org id IS the IAM org name (the deployment's
 * convention — INIT_ORG_IDS=hanzo,lux,zoo,pars with IAM_ORG_NAME=hanzo — so the
 * sync unifies with the existing seed rather than forking a parallel org). This
 * keying is a single portable `upsert` (no JSON-path filter, works on SQLite +
 * Postgres) and is idempotent. A default project is created on first insert so
 * the org is immediately navigable (org switcher routes to `org.projects[0]`,
 * and embeds are project-scoped).
 */
async function ensureConsoleOrgForIamOrg(iamOrg: {
  name: string;
  displayName?: string;
}): Promise<string> {
  const orgId = iamOrg.name;
  const before = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true },
  });

  const org = await prisma.organization.upsert({
    where: { id: orgId },
    update: {}, // preserve existing name/metadata/config
    create: {
      id: orgId,
      name: iamOrg.displayName?.trim() || iamOrg.name,
      metadata: { iamOrg: iamOrg.name },
    },
    select: { id: true },
  });

  // Seed a default project on first creation so the org is navigable.
  if (!before) {
    await prisma.project.create({
      data: { name: "Default", orgId: org.id },
    });
    logger.info(
      `[iam-sync] provisioned console org ${org.id} for IAM org "${iamOrg.name}"`,
    );
  }
  return org.id;
}

/**
 * Upsert an org membership at AT LEAST the given role. Never downgrades an
 * existing higher role (so a manual elevation survives a normal-user re-sync);
 * the admin path passes OWNER which is the ceiling.
 */
async function upsertMembershipAtLeast(
  userId: string,
  orgId: string,
  role: Role,
): Promise<void> {
  const existing = await prisma.organizationMembership.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { role: true },
  });
  if (!existing) {
    await prisma.organizationMembership.create({
      data: { userId, orgId, role },
    });
    return;
  }
  if (roleRank(role) > roleRank(existing.role as Role)) {
    await prisma.organizationMembership.update({
      where: { orgId_userId: { orgId, userId } },
      data: { role },
    });
  }
}

/**
 * Reconcile the console org memberships of an IAM-verified user from IAM. Safe
 * to call on every login; idempotent and best-effort (logs + swallows errors so
 * a sync hiccup never blocks sign-in). The console user row must already exist
 * (the caller upserts it first).
 */
export async function syncIamMembershipsForUser(
  identity: IamIdentityRef,
  consoleUserId: string,
): Promise<void> {
  try {
    const email = identity.email.toLowerCase();
    const subOrg = orgFromSub(identity.sub)?.toLowerCase();

    // Authoritative IAM flags (best-effort): owner + global-admin bits.
    const iamUser = await iamGetUser(identity.sub);
    const ownerOrg = (iamUser?.owner ?? subOrg)?.toLowerCase();

    const isGlobalAdmin = isGlobalAdminIdentity({
      ownerOrg,
      email,
      iamIsAdmin: iamUser?.isAdmin,
      iamIsGlobalAdmin: iamUser?.isGlobalAdmin,
      adminOrgs: adminIamOrgs(),
      adminEmailDomains: adminEmailDomains(),
    });

    if (isGlobalAdmin) {
      // Grant OWNER on EVERY console org. The console org set is the source of
      // truth for "what tenants exist" (seeded from INIT_ORG_IDS=hanzo,lux,zoo,
      // pars and grown only by real console org creation). We do NOT materialize
      // from IAM's admin-owner org list — that's dominated by per-user *personal*
      // orgs (one per signup, named by email), which are not tenants. We just
      // ensure the configured tenant orgs exist (idempotent; they're seeded),
      // then OWNER all existing console orgs.
      for (const tenant of tenantOrgIds()) {
        await ensureConsoleOrgForIamOrg({ name: tenant });
      }
      const allOrgs = await prisma.organization.findMany({
        select: { id: true },
      });
      for (const org of allOrgs) {
        await upsertMembershipAtLeast(consoleUserId, org.id, Role.OWNER);
      }
      logger.info(
        `[iam-sync] global admin ${email}: OWNER on ${allOrgs.length} org(s)`,
      );
      return;
    }

    // Normal user: ensure + join their own IAM org.
    if (!ownerOrg) {
      logger.warn(
        `[iam-sync] no IAM org resolvable for ${email} (sub=${identity.sub}); skipping`,
      );
      return;
    }

    // A self-serve tenant lives in its OWN dedicated IAM org (org name = the
    // per-tenant slug, NOT one of the shared seeded tenants hanzo/lux/zoo/pars),
    // so they OWN that org — full self-service over billing, keys, members. A
    // user attached to a SHARED tenant org joins as MEMBER. This is what makes
    // a fresh signup land authenticated in their own workspace, isolated from
    // the shared `hanzo` org.
    const isOwnDedicatedOrg = !tenantOrgIds()
      .map((t) => t.toLowerCase())
      .includes(ownerOrg);
    const role = isOwnDedicatedOrg ? Role.OWNER : Role.MEMBER;

    // Use IAM's org displayName so the console org shows a friendly name
    // ("Alice's Organization") rather than the raw slug.
    const iamOrg = await iamGetOrganization(ownerOrg);
    const orgId = await ensureConsoleOrgForIamOrg({
      name: ownerOrg,
      displayName: iamOrg?.displayName,
    });
    await upsertMembershipAtLeast(consoleUserId, orgId, role);
    logger.info(
      `[iam-sync] ${email}: ${role} on own org ${orgId} (dedicated=${isOwnDedicatedOrg})`,
    );
  } catch (error) {
    logger.error(
      "[iam-sync] membership sync failed: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}
