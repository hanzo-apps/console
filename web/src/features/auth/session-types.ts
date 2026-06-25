/**
 * Console-native session types — the one definition of the session shape,
 * decomplected from any auth library. Previously these augmented `next-auth`'s
 * `Session`/`User` (web/types/next-auth.d.ts); they now stand alone so console
 * code imports the session contract from here, not from a login library.
 *
 * The shape is unchanged, so the ~495 protected procedures + 277 `session.user`
 * reads that consume it need no logic changes — only their import source.
 */
import {
  type User as PrismaUser,
  type Project as PrismaProject,
  type Organization as PrismaOrganization,
  type Role,
} from "@hanzo/console/src/db";
import { type Flags } from "@/src/features/feature-flags/types";
import { type CloudConfigSchema, type Plan } from "@hanzo/console";

export interface User {
  id: PrismaUser["id"];
  name?: PrismaUser["name"];
  email?: PrismaUser["email"];
  // The IAM `sub` ("<org>/<username>") carried from the verified login. This is
  // the authoritative IAM identity ref (NOT positionally reconstructed) used by
  // server-side IAM provisioning (e.g. hk- Cloud API key mint/revoke). Optional:
  // absent for sessions established without an IAM sub (legacy/local).
  iamSub?: string;
  emailSupportHash?: string | null;
  image?: PrismaUser["image"];
  admin?: PrismaUser["admin"];
  v4BetaEnabled?: boolean;
  canToggleV4?: boolean;
  // iso datetime string — JWT & client session do not support Date objects
  emailVerified?: string | null;
  // default true, allowlist via HANZO_ALLOWED_ORGANIZATION_CREATORS
  canCreateOrganizations: boolean;
  organizations: {
    id: PrismaOrganization["id"];
    name: PrismaOrganization["name"];
    role: Role;
    cloudConfig: CloudConfigSchema | undefined;
    plan: Plan;
    metadata: Record<string, unknown>;
    aiFeaturesEnabled: boolean;
    aiTelemetryEnabled?: boolean;
    projects: {
      id: PrismaProject["id"];
      name: PrismaProject["name"];
      deletedAt: PrismaProject["deletedAt"];
      retentionDays: PrismaProject["retentionDays"];
      hasTraces?: PrismaProject["hasTraces"];
      metadata: Record<string, unknown>;
      role: Role; // only projects where the user has a role
      createdAt?: string; // iso datetime string
    }[];
  }[];
  featureFlags: Flags;
  hasPassword?: boolean;
}

export interface Session {
  // null if the user no longer exists in the DB but still has a valid cookie
  user: User | null;
  environment: {
    // Run-time env exposed client-side
    enableExperimentalFeatures: boolean;
    // EE/commercial plan when self-hosting (gates /ee features)
    selfHostedInstancePlan: Plan | null;
  };
  // present for compatibility with consumers that read an expiry
  expires?: string;
}
