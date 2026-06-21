import type { NextApiRequest, NextApiResponse } from "next";
import { getIamClient, getIamConfig } from "@/src/features/auth/lib/iamServer";
import {
  establishIamSessionFromToken,
  sessionSetCookie,
} from "@/src/features/auth/lib/iamSession";
import { logger } from "@hanzo/console/src/server";

/**
 * Same-origin token-exchange proxy for the embedded `@hanzo/iam` BrowserIamSdk
 * (its `proxyBaseUrl` is console's `/v1/iam`, so it POSTs here for
 * `${proxyBaseUrl}/oauth/token`). We forward to IAM server-side — attaching the
 * confidential `client_secret` — so the exchange never leaves the origin and
 * works even when IAM emits no CORS headers. IAM remains the token issuer.
 *
 * On a successful authorization_code exchange we ALSO set the signed
 * `hi_session` cookie (validating the freshly-minted access token against IAM's
 * JWKS) so the server session is live immediately after the redirect.
 */
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
      if (tokens.access_token) {
        const session = await establishIamSessionFromToken(tokens.access_token);
        if (session.ok) res.setHeader("Set-Cookie", sessionSetCookie(session.cookie));
      }
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
    const tokens = await client.exchangeCode({ code, redirectUri, codeVerifier });
    if (tokens.access_token) {
      const session = await establishIamSessionFromToken(tokens.access_token);
      if (session.ok) res.setHeader("Set-Cookie", sessionSetCookie(session.cookie));
    }
    res.status(200).json(tokens);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Token exchange failed.";
    logger.warn("IAM token proxy error: " + message);
    res.status(502).json({ error: message });
  }
}
