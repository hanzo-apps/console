/**
 * IAM-native session — the one way console resolves a server-side session.
 *
 * Decomplected from any login library: IAM is the sole identity authority
 * (verifies credentials via `iamPasswordLogin`, validates tokens via
 * `iamValidateToken`/JWKS). Console holds only a thin, HMAC-signed `hi_session`
 * cookie carrying the IAM-verified identity ref ({ sub, email }); the rich
 * session shape (orgs/projects/roles/entitlements) is hydrated from the console
 * DB on read. No NextAuth, no adapter, no provider translation layer.
 *
 * Server-only. Never import into a client bundle.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { type GetServerSidePropsContext } from "next";
import { env } from "@/src/env.mjs";
import { prisma } from "@hanzo/console/src/db";
import { CloudConfigSchema } from "@hanzo/console";
import {
  instrumentAsync,
  logger,
  resolveProjectRole,
} from "@hanzo/console/src/server";
import {
  getOrganizationPlanServerSide,
  getSelfHostedInstancePlanServerSide,
} from "@/src/features/entitlements/server/getPlan";
import { hasEntitlementBasedOnPlan } from "@/src/features/entitlements/server/hasEntitlement";
import { projectRoleAccessRights } from "@/src/features/rbac/constants/projectAccessRights";
import { createSupportEmailHash } from "@/src/features/support-chat/createSupportEmailHash";
import { parseFlags } from "@/src/features/feature-flags/utils";
import { iamValidateToken } from "@/src/features/auth/lib/iamServer";
import { syncIamMembershipsForUser } from "@/src/features/auth/lib/syncIamMemberships";
import { type Session } from "@/src/features/auth/session-types";

export const SESSION_COOKIE = "hi_session";
const SESSION_TTL_SECONDS = env.AUTH_SESSION_MAX_AGE * 60;

/** A console-verified identity ref carried in the signed session cookie. */
type SessionRef = { sub: string; email: string; exp: number };

const b64url = (b: Buffer) => b.toString("base64url");
const sessionSecret = () => env.SALT;

/**
 * Mint the signed `hi_session` cookie value for an IAM-verified identity.
 * Format: `<base64url(payload)>.<base64url(hmac-sha256)>` — a thin signed ref,
 * NOT a token issuer (IAM issues the real OIDC tokens; this only references the
 * verified identity for console's own SSR/tRPC session).
 */
export function signSession(identity: { sub: string; email: string }): string {
  const payload: SessionRef = {
    sub: identity.sub,
    email: identity.email.toLowerCase(),
    exp: Math.floor(nowSeconds()) + SESSION_TTL_SECONDS,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(
    createHmac("sha256", sessionSecret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

function verifySession(value: string | undefined): SessionRef | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = b64url(
    createHmac("sha256", sessionSecret()).update(body).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const ref = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionRef;
    if (!ref.email || !ref.exp || ref.exp < Math.floor(nowSeconds()))
      return null;
    return ref;
  } catch {
    return null;
  }
}

// Wall-clock read isolated so the rest stays pure/testable.
function nowSeconds(): number {
  return Date.now() / 1000;
}

/** Serialize the Set-Cookie header for the signed session (HTTP-only). */
export function sessionSetCookie(value: string): string {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

/** Serialize the Set-Cookie header that clears the session. */
export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function readCookie(
  req: GetServerSidePropsContext["req"],
  name: string,
): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function canCreateOrganizations(userEmail: string | null): boolean {
  const instancePlan = getSelfHostedInstancePlanServerSide();
  if (
    !env.HANZO_ALLOWED_ORGANIZATION_CREATORS ||
    !hasEntitlementBasedOnPlan({
      plan: instancePlan,
      entitlement: "self-host-allowed-organization-creators",
    })
  )
    return true;
  if (!userEmail) return false;
  const allowed =
    env.HANZO_ALLOWED_ORGANIZATION_CREATORS.toLowerCase().split(",");
  return allowed.includes(userEmail.toLowerCase());
}

/**
 * Instance-admin by email domain. Any user whose email domain is listed in
 * HANZO_ADMIN_EMAIL_DOMAINS (comma-separated, e.g. "hanzo.ai") is granted the
 * admin flag — full access to the admin dashboard — in addition to the per-user
 * `User.admin` DB flag. White-label: each brand console sets its own domains.
 */
function isInstanceAdminEmail(email: string | null): boolean {
  if (!email || !env.HANZO_ADMIN_EMAIL_DOMAINS) return false;
  const domains = env.HANZO_ADMIN_EMAIL_DOMAINS.toLowerCase()
    .split(",")
    .map((d) => d.trim().replace(/^@/, ""))
    .filter(Boolean);
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return domains.includes(email.slice(at + 1).toLowerCase());
}

/**
 * Hydrate the full console session for an IAM-verified email — the single
 * source of the session shape (replaces NextAuth's `session()` callback). The
 * shape is byte-for-byte what consumers already read (`session.user.organizations[].projects[].role`,
 * entitlements, admin flag) so the ~495 protected procedures + 277 `session.user`
 * reads are unchanged.
 */
export async function hydrateSession(email: string): Promise<Session> {
  return instrumentAsync({ name: "iam-session-hydrate" }, async (span) => {
    const dbUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        emailVerified: true,
        password: true,
        createdAt: true,
        featureFlags: true,
        admin: true,
        organizationMemberships: {
          include: {
            organization: {
              include: {
                projects: { where: { deletedAt: { equals: null } } },
              },
            },
            ProjectMemberships: true,
          },
        },
      },
    });

    span.setAttribute("hanzo.user.email", dbUser?.email ?? "");
    span.setAttribute("hanzo.user.id", dbUser?.id ?? "");

    return {
      environment: {
        enableExperimentalFeatures:
          env.HANZO_ENABLE_EXPERIMENTAL_FEATURES === "true",
        selfHostedInstancePlan: getSelfHostedInstancePlanServerSide(),
      },
      user:
        dbUser !== null
          ? {
              id: dbUser.id,
              name: dbUser.name,
              email: dbUser.email,
              emailSupportHash: dbUser.email
                ? createSupportEmailHash(dbUser.email)
                : undefined,
              image: dbUser.image,
              admin: dbUser.admin || isInstanceAdminEmail(dbUser.email),
              canCreateOrganizations: canCreateOrganizations(dbUser.email),
              organizations: dbUser.organizationMemberships.map(
                (membership) => {
                  const parsedCloudConfig = CloudConfigSchema.safeParse(
                    membership.organization.cloudConfig,
                  );
                  return {
                    id: membership.organization.id,
                    name: membership.organization.name,
                    role: membership.role,
                    metadata:
                      (membership.organization.metadata as Record<
                        string,
                        unknown
                      >) ?? {},
                    aiFeaturesEnabled:
                      membership.organization.aiFeaturesEnabled,
                    cloudConfig: parsedCloudConfig.data,
                    projects: membership.organization.projects
                      .map((project) => {
                        const projectRole = resolveProjectRole({
                          projectId: project.id,
                          projectMemberships: membership.ProjectMemberships,
                          orgMembershipRole: membership.role,
                        });
                        return {
                          id: project.id,
                          name: project.name,
                          role: projectRole,
                          retentionDays: project.retentionDays,
                          deletedAt: project.deletedAt,
                          metadata:
                            (project.metadata as Record<string, unknown>) ?? {},
                        };
                      })
                      .filter((project) =>
                        projectRoleAccessRights[project.role].includes(
                          "project:read",
                        ),
                      ),
                    plan: getOrganizationPlanServerSide(parsedCloudConfig.data),
                  };
                },
              ),
              emailVerified: dbUser.emailVerified?.toISOString(),
              featureFlags: parseFlags(dbUser.featureFlags),
              hasPassword: Boolean(dbUser.password),
            }
          : null,
    } as Session;
  });
}

/**
 * Resolve the server-side session from the signed `hi_session` cookie. Drop-in
 * for the old `getServerAuthSession` (same `Session | null` contract, same
 * no-store headers). Returns null when there is no valid cookie.
 */
/** App-Router variant: resolve the session from a `Request`'s Cookie header. */
export async function getIamSessionFromRequest(
  req: Request,
): Promise<Session | null> {
  const header = req.headers.get("cookie") ?? "";
  let value: string | undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      value = part.slice(eq + 1).trim();
      break;
    }
  }
  return getIamSessionFromCookie(value);
}

export async function getIamSessionFromCookie(
  value: string | undefined,
): Promise<Session | null> {
  const ref = verifySession(value);
  if (!ref) return null;
  try {
    return await hydrateSession(ref.email);
  } catch (error) {
    logger.warn(
      "iam-session hydrate failed: " +
        (error instanceof Error ? error.message : String(error)),
    );
    return null;
  }
}

export async function getIamServerSession(ctx: {
  req: GetServerSidePropsContext["req"];
  res: GetServerSidePropsContext["res"];
}): Promise<Session | null> {
  // Disable caching for any response that depends on the session.
  ctx.res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  ctx.res.setHeader("Pragma", "no-cache");
  ctx.res.setHeader("Expires", "0");

  return getIamSessionFromCookie(readCookie(ctx.req, SESSION_COOKIE));
}

/**
 * Upsert the IAM-verified identity into the console user table (first-login
 * provisioning) and return the signed session cookie value. Mirrors the upsert
 * the old `iam-token`/credentials providers did, decomplected into one place.
 */
export async function establishIamSession(identity: {
  sub: string;
  email: string;
  name?: string | null;
  image?: string | null;
}): Promise<string> {
  const email = identity.email.toLowerCase();
  const dbUser = await prisma.user.upsert({
    where: { email },
    create: { email, name: identity.name, image: identity.image },
    update: {
      name: identity.name ?? undefined,
      image: identity.image ?? undefined,
    },
  });
  // Reconcile IAM org memberships into console's org model on every login, so a
  // global admin sees ALL orgs and a normal user sees their IAM org(s). This is
  // the single provisioning point; hydrateSession() then just reads the result.
  await syncIamMembershipsForUser(
    { sub: identity.sub || dbUser.id, email },
    dbUser.id,
  );
  return signSession({ sub: identity.sub || dbUser.id, email });
}

/** Validate an IAM access token and establish the console session for it. */
export async function establishIamSessionFromToken(
  accessToken: string,
): Promise<{ ok: true; cookie: string } | { ok: false; error: string }> {
  const result = await iamValidateToken(accessToken);
  if (!result.ok) return { ok: false, error: result.error };
  if (!result.identity.email)
    return { ok: false, error: "IAM token has no email claim." };
  const cookie = await establishIamSession(result.identity);
  return { ok: true, cookie };
}
