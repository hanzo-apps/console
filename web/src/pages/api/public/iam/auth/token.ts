import type { NextApiRequest, NextApiResponse } from "next";
import { getIamClient, getIamConfig } from "@/src/features/auth/lib/iamServer";
import {
  establishIamSession,
  establishIamSessionFromToken,
  sessionSetCookie,
} from "@/src/features/auth/lib/iamSession";
import { logger } from "@hanzo/console/src/server";

/**
 * Same-origin token-exchange proxy for the embedded `@hanzo/iam` BrowserIamSdk
 * (its `proxyBaseUrl` is console's `/v1/iam`, so it POSTs here for
 * `${proxyBaseUrl}/auth/token`). We forward to IAM server-side — attaching the
 * confidential `client_secret` — so the exchange never leaves the origin and
 * works even when IAM emits no CORS headers. IAM remains the token issuer.
 *
 * On a successful exchange we ALSO establish the signed `hi_session` cookie so
 * the server session is live immediately after the SSO redirect (otherwise the
 * dashboard auth-guard bounces straight back to `/auth/sign-in`).
 */

type TokenLike = {
  access_token?: string;
  id_token?: string;
  [k: string]: unknown;
};

/**
 * Derive the signed `hi_session` cookie from a freshly-exchanged token set.
 *
 * IAM's *access* token is an API-authz artifact whose claims/format depend
 * on the app's token config — it can fail strict JWKS+email validation even
 * when the login itself is perfectly valid. So we try identity sources in order
 * of robustness:
 *   1. `id_token`     — the OIDC identity token (JWKS-validated, always carries
 *                       `email`; same `cert-hanzo` key as the access token).
 *   2. `access_token` — JWKS-validated (kept for configs where it is the only
 *                       token and does carry the identity claims).
 *   3. userinfo       — IAM-verified profile for the access token. The token was
 *                       just minted by us via the confidential client and IAM
 *                       re-validates it before returning the profile, so this is
 *                       an authoritative identity, not an unverified claim.
 *
 * Returns the `Set-Cookie` value, or null if none of the sources yield an email.
 * Each failed attempt is logged so the cause is visible in pod logs.
 */
async function sessionCookieFromTokens(
  client: NonNullable<ReturnType<typeof getIamClient>>,
  tokens: TokenLike,
): Promise<string | null> {
  // 1) id_token — the canonical OIDC identity artifact.
  if (tokens.id_token) {
    const s = await establishIamSessionFromToken(tokens.id_token);
    if (s.ok) return sessionSetCookie(s.cookie);
    logger.warn(
      "iam-session: id_token did not establish a session: " + s.error,
    );
  }

  // 2) access_token — works when it carries verifiable identity claims.
  if (tokens.access_token) {
    const s = await establishIamSessionFromToken(tokens.access_token);
    if (s.ok) return sessionSetCookie(s.cookie);
    logger.warn(
      "iam-session: access_token did not establish a session: " + s.error,
    );
  }

  // 3) IAM-verified userinfo — last-resort, but authoritative (IAM validated the
  // token before returning this profile).
  if (tokens.access_token) {
    try {
      const p = (await client.getUserInfo(tokens.access_token)) as Record<
        string,
        unknown
      >;
      const email =
        (typeof p.email === "string" && p.email) ||
        (typeof p.preferred_username === "string" && p.preferred_username) ||
        "";
      const sub =
        (typeof p.sub === "string" && p.sub) ||
        (typeof p.id === "string" && p.id) ||
        "";
      if (email) {
        const cookie = await establishIamSession({
          sub,
          email,
          name:
            typeof p.name === "string"
              ? p.name
              : typeof p.preferred_username === "string"
                ? p.preferred_username
                : null,
          image:
            typeof p.picture === "string"
              ? p.picture
              : typeof p.avatar === "string"
                ? p.avatar
                : null,
        });
        return sessionSetCookie(cookie);
      }
      logger.warn(
        "iam-session: userinfo carried no email claim; cannot establish session",
      );
    } catch (error) {
      logger.warn(
        "iam-session: userinfo fallback failed: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).end();
    return;
  }

  const client = getIamClient();
  const config = getIamConfig();
  if (!client || !config) {
    res.status(503).json({ error: "IAM is not configured." });
    return;
  }

  const params = new URLSearchParams(
    typeof req.body === "string"
      ? req.body
      : (req.body as Record<string, string>),
  );
  const grantType = params.get("grant_type");

  try {
    if (grantType === "refresh_token") {
      const refreshToken = params.get("refresh_token");
      if (!refreshToken) {
        res.status(400).json({ error: "Missing refresh_token" });
        return;
      }
      const tokens = await client.refreshToken(refreshToken);
      const cookie = await sessionCookieFromTokens(client, tokens);
      if (cookie) res.setHeader("Set-Cookie", cookie);
      res.status(200).json(tokens);
      return;
    }

    // Default: authorization_code grant.
    const code = params.get("code");
    const redirectUri = params.get("redirect_uri");
    const codeVerifier = params.get("code_verifier") ?? undefined;
    if (!code || !redirectUri) {
      res.status(400).json({ error: "Missing code or redirect_uri" });
      return;
    }
    const tokens = await client.exchangeCode({
      code,
      redirectUri,
      codeVerifier,
    });
    const cookie = await sessionCookieFromTokens(client, tokens);
    if (cookie) res.setHeader("Set-Cookie", cookie);
    res.status(200).json(tokens);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Token exchange failed.";
    logger.warn("IAM token proxy error: " + message);
    res.status(502).json({ error: message });
  }
}
