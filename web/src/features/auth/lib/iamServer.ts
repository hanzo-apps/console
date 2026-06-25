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
    // type:"login" ⇒ Casdoor verifies the password and returns the identity
    // (`data: "<org>/<user>"`) directly — no OAuth code dance, and (verified
    // against live IAM) no dependency on the app's redirectUris/grantTypes/
    // enableSigninSession. Without a `type`, Casdoor errors "unknown response
    // type". console mints its own session cookie from the returned identity.
    const res = await client.apiRequest<IamResponse<string>>("/v1/iam/login", {
      method: "POST",
      body: {
        application: env.IAM_APP_NAME,
        organization: env.IAM_ORG_NAME,
        username: params.email,
        password: params.password,
        signinMethod: "Password",
        type: "login",
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

/**
 * List ALL organizations under an IAM owner (default Casdoor super-org `admin`).
 * Uses the confidential-client Basic auth (IamClient.apiRequest), so no user
 * token is needed. Returns `[]` on any error so login degrades gracefully.
 *
 * NOTE: Hanzo IAM serves the Casdoor data API under the `/v1/iam/*` prefix (the
 * bare `/api/*` paths return the IAM SPA HTML), so we call `/v1/iam/...`
 * explicitly — the SDK's built-in `getOrganizations()` targets `/api/...` and
 * would silently parse HTML. This mirrors `iamPasswordLogin` (`/v1/iam/login`).
 */
export async function iamListAllOrganizations(
  owner = "admin",
): Promise<Array<{ name: string; displayName?: string }>> {
  const client = getIamClient();
  if (!client) return [];
  try {
    const res = await client.apiRequest<
      IamResponse<Array<{ name: string; displayName?: string }>>
    >("/v1/iam/get-organizations", { params: { owner } });
    if (res.status !== "ok" || !Array.isArray(res.data)) return [];
    return res.data;
  } catch {
    return [];
  }
}

/**
 * Fetch the IAM user record for a `sub` ("org/username") to read authoritative
 * flags (`owner`, `isAdmin`, `isGlobalAdmin`). Uses the `/v1/iam/*` API prefix
 * (see {@link iamListAllOrganizations}). Returns null on error.
 */
export async function iamGetUser(sub: string): Promise<{
  owner?: string;
  name?: string;
  isAdmin?: boolean;
  isGlobalAdmin?: boolean;
  accessKey?: string;
} | null> {
  const client = getIamClient();
  if (!client) return null;
  try {
    const res = await client.apiRequest<
      IamResponse<{
        owner?: string;
        name?: string;
        isAdmin?: boolean;
        isGlobalAdmin?: boolean;
        accessKey?: string;
      }>
    >("/v1/iam/get-user", { params: { id: sub } });
    if (res.status !== "ok" || !res.data) return null;
    return res.data;
  } catch {
    return null;
  }
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
 *
 * Unlike login/signup (which IAM parses as JSON), `/v1/iam/send-verification-code`
 * is parsed via Casdoor `ParseForm` and therefore requires form-encoded data —
 * so this posts `application/x-www-form-urlencoded` directly rather than going
 * through the JSON `IamClient.apiRequest`.
 */
export async function iamSendVerificationCode(params: {
  email: string;
}): Promise<IamSendCodeResult> {
  const config = getIamConfig();
  if (!config) return { ok: false, error: "IAM is not configured." };

  try {
    const body = new URLSearchParams({
      dest: params.email,
      type: "email",
      // Casdoor requires applicationId in "<owner>/<app>" form.
      applicationId: `admin/${config.appName ?? "app"}`,
      method: "signup",
      checkUser: "",
      captchaType: "none",
    });

    const resp = await fetch(
      `${config.serverUrl.replace(/\/+$/, "")}/v1/iam/send-verification-code`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
    );
    const res = (await resp.json()) as IamResponse;

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

// ---------------------------------------------------------------------------
// Self-serve tenant provisioning + per-user hk- Cloud API keys
//
// One tenant = one IAM org = one console org = one commerce namespace = one
// slug. These confidential-client (Basic-auth) calls are the server-side
// primitives the console uses to give each self-serve signup its OWN isolated
// IAM org (so hk-key billing, console org, and commerce usage all key on the
// same per-tenant slug), and to mint/clear that tenant's hk- Cloud API key.
//
// Cross-org login is unaffected: IAM resolves a login by email globally and
// returns the user's own `<slug>/<email>` sub even though the console posts
// `organization=hanzo` (verified live), so the existing login flow needs no
// change for a tenant that lives in its own org.
// ---------------------------------------------------------------------------

export type IamProvisionTenantResult =
  | { ok: true; sub: string; org: string; orgDisplayName: string }
  | { ok: false; error: string };

/** Read a single IAM org (admin-owned) record, or null. */
export async function iamGetOrganization(name: string): Promise<{
  name: string;
  displayName?: string;
  useEmailAsUsername?: boolean;
} | null> {
  const client = getIamClient();
  if (!client) return null;
  try {
    const res = await client.apiRequest<
      IamResponse<{
        name: string;
        displayName?: string;
        useEmailAsUsername?: boolean;
      }>
    >("/v1/iam/get-organization", { params: { id: `admin/${name}` } });
    if (res.status !== "ok" || !res.data) return null;
    return res.data;
  } catch {
    return null;
  }
}

/**
 * Provision a self-serve tenant in IAM: ensure a per-tenant organization
 * (`useEmailAsUsername=true`) exists and the user lives IN it, then mint the
 * tenant's hk- Cloud API key. Idempotent — safe to re-run for an existing
 * tenant (reuses the org/user; only mints a key if the user has none).
 *
 * Returns the tenant's own `sub` (`<slug>/<email>`) so the caller can carry it
 * in the session and so downstream org/billing keying uses the per-tenant slug.
 */
export async function iamProvisionTenant(params: {
  email: string;
  password: string;
  name: string;
  slug: string;
  emailCode?: string;
}): Promise<IamProvisionTenantResult> {
  const client = getIamClient();
  if (!client) return { ok: false, error: "IAM is not configured." };

  const email = params.email.trim().toLowerCase();
  const slug = params.slug;
  const displayName = params.name?.trim() || email;
  const orgDisplayName = `${displayName}'s Organization`;
  const sub = `${slug}/${email}`;

  try {
    // 1. Ensure the per-tenant org exists with email-as-username (so the
    //    email-named user passes IAM's ReUserName regex). add-organization may
    //    not persist the flag on creation in every IAM build, so we verify and
    //    patch it explicitly — the flag is load-bearing for add-user below.
    const existingOrg = await iamGetOrganization(slug);
    if (!existingOrg) {
      const addOrg = await client.apiRequest<IamResponse>(
        "/v1/iam/add-organization",
        {
          method: "POST",
          body: {
            owner: "admin",
            name: slug,
            displayName: orgDisplayName,
            useEmailAsUsername: true,
            passwordType: "bcrypt",
            // A self-serve tenant org should not be a public signup target of
            // its own; users join via the console (hanzo-console) app.
          },
        },
      );
      if (addOrg.status !== "ok") {
        return {
          ok: false,
          error: addOrg.msg || "Failed to create tenant organization.",
        };
      }
    }
    // Confirm the flag is on (patch if a stale/created org lacks it).
    const org = await iamGetOrganization(slug);
    if (org && org.useEmailAsUsername !== true) {
      await client.apiRequest<IamResponse>("/v1/iam/update-organization", {
        method: "POST",
        params: { id: `admin/${slug}` },
        body: { ...org, owner: "admin", name: slug, useEmailAsUsername: true },
      });
    }

    // 2. Ensure the user exists IN the tenant org (owner = slug). If a user
    //    with this sub already exists, reuse it (idempotent re-signup).
    const existingUser = await iamGetUser(sub);
    if (!existingUser) {
      const addUser = await client.apiRequest<IamResponse>("/v1/iam/add-user", {
        method: "POST",
        body: {
          owner: slug,
          name: email,
          email,
          password: params.password,
          displayName,
          type: "normal-user",
          signupApplication: env.IAM_APP_NAME,
          ...(params.emailCode ? { emailCode: params.emailCode } : {}),
        },
      });
      if (addUser.status !== "ok") {
        // Idempotency under concurrent / retried signups of the same email: two
        // requests can both observe `existingUser == null` and both POST
        // add-user; the loser hits a duplicate-insert. Treat "already exists" as
        // success (the row we wanted is there) instead of failing a legitimate
        // re-signup. Re-confirm the user resolves before continuing.
        const msg = (addUser.msg || "").toLowerCase();
        const isDuplicate =
          msg.includes("already exist") ||
          msg.includes("duplicate") ||
          msg.includes("exists");
        const confirmed = isDuplicate ? await iamGetUser(sub) : null;
        if (!confirmed) {
          return {
            ok: false,
            error: addUser.msg || "Failed to create tenant user.",
          };
        }
      }
    }

    // 3. Mint the tenant's hk- Cloud API key so every tenant has a working key
    //    from the moment they sign up. Only mint when absent (idempotent).
    const userAfter = await iamGetUser(sub);
    if (!userAfter?.accessKey) {
      await iamMintUserKeys(sub);
    }

    return { ok: true, sub, org: slug, orgDisplayName };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "IAM tenant provisioning failed.",
    };
  }
}

export type IamMintKeyResult =
  | { ok: true; accessKey: string }
  | { ok: false; error: string };

/**
 * (Re)generate the per-user hk- Cloud API key for an IAM sub and return the
 * new `hk-` accessKey. Server-side confidential-client call to the dedicated
 * IAM minting endpoint (NOT under the add-/update- prefixes, so it is not blocked by the
 * name-character filter for email-named users). The caller MUST pass the
 * authenticated session user's own sub — never client-supplied input.
 */
export async function iamMintUserKeys(sub: string): Promise<IamMintKeyResult> {
  const client = getIamClient();
  if (!client) return { ok: false, error: "IAM is not configured." };
  try {
    const res = await client.apiRequest<IamResponse<{ accessKey?: string }>>(
      "/v1/iam/mint-user-keys",
      { method: "POST", params: { id: sub }, body: {} },
    );
    if (res.status !== "ok" || !res.data?.accessKey) {
      return { ok: false, error: res.msg || "Failed to mint Cloud API key." };
    }
    return { ok: true, accessKey: res.data.accessKey };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to mint Cloud API key.",
    };
  }
}

/** Clear (revoke) the per-user hk- Cloud API key for an IAM sub. */
export async function iamRevokeUserKeys(
  sub: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = getIamClient();
  if (!client) return { ok: false, error: "IAM is not configured." };
  try {
    const res = await client.apiRequest<IamResponse>(
      "/v1/iam/revoke-user-keys",
      { method: "POST", params: { id: sub }, body: {} },
    );
    if (res.status !== "ok") {
      return { ok: false, error: res.msg || "Failed to revoke Cloud API key." };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to revoke Cloud API key.",
    };
  }
}
