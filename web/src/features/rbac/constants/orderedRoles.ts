import { Role } from "@hanzo/console";

export const orderedRoles: Record<Role, number> = {
  [Role.OWNER]: 5,
  [Role.ADMIN]: 4,
  [Role.ADMIN_BILLING]: 3,
  [Role.MEMBER]: 2,
  [Role.VIEWER]: 1,
  [Role.NONE]: 0,
};

/**
 * Human-readable role label, e.g. "ADMIN_BILLING" -> "Admin Billing".
 * Shared by the role <select> items and the Identity & Access roles matrix.
 */
export const formatRole = (role: Role): string =>
  role
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
