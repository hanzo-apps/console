import { env } from "@/src/env.mjs";
import { createUserEmailPassword } from "@/src/features/auth-credentials/lib/credentialsServerUtils";
import { signupSchema } from "@/src/features/auth/lib/signupSchema";
import {
  iamProvisionTenant,
  isIamConfigured,
} from "@/src/features/auth/lib/iamServer";
import { tenantSlugForEmail } from "@/src/features/auth/lib/tenantSlug";
import { createProjectMembershipsOnSignup } from "@/src/features/auth/lib/createProjectMembershipsOnSignup";
import { prisma } from "@hanzo/console/src/db";
// Hanzo uses IAM — multi-tenant SSO not applicable
function getSsoAuthProviderIdForDomain(_domain: string): string | null {
  return null;
}
import { ENTERPRISE_SSO_REQUIRED_MESSAGE } from "@/src/features/auth/constants";
import type { NextApiRequest, NextApiResponse } from "next";
import { logger } from "@hanzo/console/src/server";

export function getSSOBlockedDomains() {
  return (
    env.AUTH_DOMAINS_WITH_SSO_ENFORCEMENT?.split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean) ?? []
  );
}

/**
 * Validates that a user is eligible to sign up with email/password.
 * Returns an error message string if ineligible, or null if eligible.
 */
export async function validateSignupEligibility({
  email,
}: {
  email: string;
}): Promise<string | null> {
  // Block if disabled by env
  if (
    env.NEXT_PUBLIC_SIGN_UP_DISABLED === "true" ||
    env.AUTH_DISABLE_SIGNUP === "true"
  ) {
    return "Sign up is disabled.";
  }
  if (env.AUTH_DISABLE_USERNAME_PASSWORD === "true") {
    return "Sign up with email and password is disabled for this instance. Please use SSO.";
  }

  // check if email domain is blocked from email/password sign up via env
  const blockedDomains = getSSOBlockedDomains();
  const domain = email.split("@")[1]?.toLowerCase();
  if (domain && blockedDomains.includes(domain)) {
    return "Sign up with email and password is disabled for this domain. Please use SSO.";
  }

  // EE: check if custom SSO configuration is enabled for this domain
  const multiTenantSsoProvider = await getSsoAuthProviderIdForDomain(domain);
  if (multiTenantSsoProvider) {
    return ENTERPRISE_SSO_REQUIRED_MESSAGE;
  }

  return null;
}

/*
 * Sign-up endpoint (email/password users), creates user in database.
 * SSO users are created by the NextAuth adapters.
 */
export async function signupApiHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return;
  // Block if disabled by env
  if (
    env.NEXT_PUBLIC_SIGN_UP_DISABLED === "true" ||
    env.AUTH_DISABLE_SIGNUP === "true"
  ) {
    res.status(422).json({ message: "Sign up is disabled." });
    return;
  }
  if (env.AUTH_DISABLE_USERNAME_PASSWORD === "true") {
    res.status(422).json({
      message:
        "Sign up with email and password is disabled for this instance. Please use SSO.",
    });
    return;
  }

  // parse and type check the request body with zod
  const validBody = signupSchema.safeParse(req.body);
  if (!validBody.success) {
    logger.warn("Signup: Invalid body", validBody.error);
    res.status(422).json({ message: validBody.error });
    return;
  }

  const body = validBody.data;

  // check if email domain is blocked from email/password sign up via env
  const blockedDomains = getSSOBlockedDomains();
  const domain = body.email.split("@")[1]?.toLowerCase();
  if (domain && blockedDomains.includes(domain)) {
    res.status(422).json({
      message:
        "Sign up with email and password is disabled for this domain. Please use SSO.",
    });
    return;
  }

  // EE: check if custom SSO configuration is enabled for this domain
  const multiTenantSsoProvider = await getSsoAuthProviderIdForDomain(domain);
  if (multiTenantSsoProvider) {
    res.status(422).json({
      message: ENTERPRISE_SSO_REQUIRED_MESSAGE,
    });
    return;
  }

  // create the user
  let userId: string;
  if (isIamConfigured()) {
    // IAM-native self-serve signup: provision the tenant in IAM — its OWN
    // organization (one tenant = one IAM org = one console org = one commerce
    // namespace = one slug) with the user created INSIDE it, plus the tenant's
    // hk- Cloud API key minted up front. IAM is the credential authority; the
    // local console user row is created passwordless. Cross-org login still
    // works because IAM resolves a login by email globally and returns the
    // tenant's own `<slug>/<email>` sub even though the console posts
    // organization=hanzo. The per-tenant org is what makes hk-key billing,
    // console org isolation, and commerce usage all key on the same slug.
    const iamResult = await iamProvisionTenant({
      email: body.email,
      password: body.password,
      name: body.name,
      slug: tenantSlugForEmail(body.email),
    });
    if (!iamResult.ok) {
      logger.warn(
        "Signup: IAM tenant provisioning failed: " + iamResult.error,
        body.email.toLowerCase(),
        body.name,
      );
      res.status(422).json({ message: iamResult.error });
      return;
    }

    try {
      const existing = await prisma.user.findUnique({
        where: { email: body.email.toLowerCase() },
      });
      if (existing) {
        userId = existing.id;
      } else {
        const newUser = await prisma.user.create({
          data: {
            email: body.email.toLowerCase(),
            name: body.name,
            password: null, // IAM owns credentials
          },
        });
        await createProjectMembershipsOnSignup(newUser, {
          userWasJustCreated: true,
        });
        userId = newUser.id;
      }
    } catch (error) {
      const message =
        "Signup: Error creating local user record: " +
        (error instanceof Error ? error.message : JSON.stringify(error));
      logger.warn(message, body.email.toLowerCase(), body.name);
      res.status(422).json({ message });
      return;
    }
  } else {
    // Transitional fallback (IAM not configured): local password user.
    try {
      userId = await createUserEmailPassword(
        body.email,
        body.password,
        body.name,
      );
    } catch (error) {
      const message =
        "Signup: Error creating user: " +
        (error instanceof Error ? error.message : JSON.stringify(error));
      logger.warn(message, body.email.toLowerCase(), body.name);
      res.status(422).json({ message: message });

      return;
    }
  }

  // Trigger new user signup event
  if (
    env.HANZO_NEW_USER_SIGNUP_WEBHOOK &&
    env.NEXT_PUBLIC_HANZO_CLOUD_REGION &&
    env.NEXT_PUBLIC_HANZO_CLOUD_REGION !== "STAGING" &&
    env.NEXT_PUBLIC_HANZO_CLOUD_REGION !== "DEV"
  ) {
    await fetch(env.HANZO_NEW_USER_SIGNUP_WEBHOOK, {
      method: "POST",
      body: JSON.stringify({
        name: body.name,
        email: body.email,
        referralSource: body.referralSource,
        cloudRegion: env.NEXT_PUBLIC_HANZO_CLOUD_REGION,
        userId: userId,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  res.status(200).json({ message: "User created" });
}
