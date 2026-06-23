/**
 * Pure IAM→console sync policy — decomplected from the DB-writing reconciler in
 * `syncIamMemberships.ts` so the decision logic (who is a global admin, what org
 * a sub belongs to, role precedence) is unit-testable with no prisma import.
 */
import { Role } from "@hanzo/console/src/db";

/** Parse the IAM org name from a `sub` of the form "org/username". */
export function orgFromSub(sub: string): string | undefined {
  const slash = sub.indexOf("/");
  if (slash <= 0) return undefined;
  return sub.slice(0, slash).trim() || undefined;
}

/**
 * Decide whether an IAM identity is a global admin (OWNER of every console org).
 * `adminOrgs` is the configured set of super-org names (e.g. {"admin"});
 * `adminEmailDomains` the configured admin domains.
 */
export function isGlobalAdminIdentity(input: {
  ownerOrg?: string;
  email: string;
  iamIsAdmin?: boolean;
  iamIsGlobalAdmin?: boolean;
  adminOrgs: Set<string>;
  adminEmailDomains: string[];
}): boolean {
  if (input.iamIsGlobalAdmin || input.iamIsAdmin) return true;
  if (input.ownerOrg && input.adminOrgs.has(input.ownerOrg.toLowerCase()))
    return true;
  const at = input.email.lastIndexOf("@");
  if (at >= 0) {
    const domain = input.email.slice(at + 1).toLowerCase();
    if (input.adminEmailDomains.map((d) => d.toLowerCase()).includes(domain))
      return true;
  }
  return false;
}

/** Role precedence (mirrors features/rbac orderedRoles); higher = more access. */
export function roleRank(role: Role): number {
  switch (role) {
    case Role.OWNER:
      return 5;
    case Role.ADMIN:
      return 4;
    case Role.ADMIN_BILLING:
      return 3;
    case Role.MEMBER:
      return 2;
    case Role.VIEWER:
      return 1;
    default:
      return 0;
  }
}

/** Parse a comma-separated env list to a lowercased set (trimmed, non-empty). */
export function parseLowerSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .toLowerCase()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Parse comma-separated email domains (strip leading @). */
export function parseEmailDomains(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .split(",")
    .map((d) => d.trim().replace(/^@/, ""))
    .filter(Boolean);
}
