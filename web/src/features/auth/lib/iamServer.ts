/**
 * Server-side Hanzo IAM client — the single source of truth for talking to the
 * IAM backend (`github.com/hanzoai/iam`, Casdoor fork) from console.
 *
 * IAM is the NATIVE identity for console. This module wraps the canonical
 * `@hanzo/iam` SDK (`IamClient` for HTTP + `validateToken` for JWKS-backed JWT
 * validation) and exposes the three embedded auth flows console drives directly:
 *
 *   - {@link iamPasswordLogin}        → POST /v1/iam/login   (credential authority)
 *   - {@link iamSignup}               → POST /v1/iam/signup
 *   - {@link iamSendVerificationCode} → POST /v1/iam/send-verification-code
 *   - {@link iamValidateToken}        → JWKS validation of an IAM access token
 *
 * Identity verification (does this password match?) lives HERE, in IAM — it is
 * decomplected from session transport (the NextAuth JWT cookie, which only
 * carries the IAM-derived identity). console never checks a local bcrypt hash
 * for an IAM-backed user.
 *
 * Server-only. Never import into a client bundle.
 */
import { env } from "@/src/env.mjs";
import { IamClient, validateToken, type IamConfig } from "@hanzo/iam";

/** Whether IAM-native auth is configured for this instance. */
export function isIamConfigured(): boolean {
  return Boolean(env.IAM_SERVER_URL && env.IAM_CLIENT_ID);
}

/**
 * Resolve the server-side IAM config from env. Returns `null` when IAM is not
 * configured so callers can degrade gracefully (e.g. fall back to local
 * credentials during the transition).
 */
export function getIamConfig(): IamConfig | null {
  if (!env.IAM_SERVER_URL || !env.IAM_CLIENT_ID) return null;
  return {
    serverUrl: env.IAM_SERVER_URL,
    clientId: env.IAM_CLIENT_ID,
    clientSecret: env.IAM_CLIENT_SECRET,
    orgName: env.IAM_ORG_NAME,
    appName: env.IAM_APP_NAME,
  };
}

let cachedClient: IamClient | null = null;

/** Lazily-constructed shared IamClient (config is process-stable). */
export function getIamClient(): IamClient | null {
  if (cachedClient) return cachedClient;
  const config = getIamConfig();
  if (!config) return null;
  cachedClient = new IamClient(config);
  return cachedClient;
}

// Pure identity types + parsing live in the env-free `iamIdentity` module so
// they can be unit-tested in isolation. Re-export for a single import surface.
export {
  identityFromLoginResponse,
  type IamIdentity,
  type IamLoginResult,
  type IamResponse,
} from "@/src/features/auth/lib/iamIdentity";
import {
  identityFromLoginResponse,
  type IamLoginResult,
  type IamResponse,
} from "@/src/features/auth/lib/iamIdentity";

/**
 * Authenticate an email + password against IAM. IAM is the credential
 * authority: we POST the IAM `AuthForm` with no OAuth `type`, which makes the
 * backend verify the password and return `{status:"ok", data: "<org>/<user>"}`.
 *
 * On success the returned `data` is the IAM `sub` (org/username) — combined with
 * the submitted email this is a complete, IAM-verified identity that console
 * upserts into its user table and carries in the session.
 */
export async function iamPasswordLogin(params: {
  email: string;
  password: string;
}): Promise<IamLoginResult> {
  const client = getIamClient();
  if (!client) return { ok: false, error: "IAM is not configured." };

  try {
    // No `type` field ⇒ pure credential verification (no OAuth code dance).
    const res = await client.apiRequest<IamResponse<string>>("/v1/iam/login", {
      method: "POST",
      body: {
        application: env.IAM_APP_NAME,
        organization: env.IAM_ORG_NAME,
        username: params.email,
        password: params.password,
        signinMethod: "Password",
        autoSignin: true,
      },
    });

    return identityFromLoginResponse(res, params.email);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "IAM login failed.",
    };
  }
}

/**
 * Validate an IAM-issued access token against IAM's JWKS (OIDC discovery +
 * `jose`). Returns the verified identity or an error. Used when an IAM token is
 * presented (e.g. the embedded BrowserIamSdk handed console a token to bridge
 * into a session).
 */
export async function iamValidateToken(token: string): Promise<IamLoginResult> {
  const config = getIamConfig();
  if (!config) return { ok: false, error: "IAM is not configured." };

  const result = await validateToken(token, config);
  if (!result.ok) return { ok: false, error: result.reason };

  return {
    ok: true,
    identity: {
      sub: result.userId,
      email: (result.email ?? "").toLowerCase(),
      name: result.name ?? null,
      image: result.avatar ?? null,
    },
  };
}

export type IamSignupResult =
  | { ok: true; sub?: string }
  | { ok: false; error: string };

/**
 * Register a new user in IAM via the native signup endpoint. When email
 * verification is enabled, callers must first obtain a code via
 * {@link iamSendVerificationCode} and pass it as `emailCode`.
 */
export async function iamSignup(params: {
  email: string;
  password: string;
  name: string;
  emailCode?: string;
}): Promise<IamSignupResult> {
  const client = getIamClient();
  if (!client) return { ok: false, error: "IAM is not configured." };

  try {
    const res = await client.apiRequest<IamResponse<string>>("/v1/iam/signup", {
      method: "POST",
      body: {
        application: env.IAM_APP_NAME,
        organization: env.IAM_ORG_NAME,
        username: params.email,
        password: params.password,
        name: params.name,
        email: params.email,
        ...(params.emailCode ? { emailCode: params.emailCode } : {}),
      },
    });

    if (res.status !== "ok") {
      return { ok: false, error: res.msg || "Signup failed." };
    }
    return {
      ok: true,
      sub: res.sub || (typeof res.data === "string" ? res.data : undefined),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "IAM signup failed.",
    };
  }
}

export type IamSendCodeResult = { ok: true } | { ok: false; error: string };

/**
 * Request an email verification code from IAM for the embedded signup flow.
 */
export async function iamSendVerificationCode(params: {
  email: string;
}): Promise<IamSendCodeResult> {
  const client = getIamClient();
  if (!client) return { ok: false, error: "IAM is not configured." };

  try {
    const res = await client.apiRequest<IamResponse>(
      "/v1/iam/send-verification-code",
      {
        method: "POST",
        body: {
          dest: params.email,
          type: "email",
          applicationId: env.IAM_ORG_NAME
            ? `admin/${env.IAM_APP_NAME}`
            : env.IAM_APP_NAME,
          method: "signup",
          checkUser: "",
        },
      },
    );

    if (res.status !== "ok") {
      return { ok: false, error: res.msg || "Failed to send code." };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to send code via IAM.",
    };
  }
}
