import type { NextApiRequest, NextApiResponse } from "next";
import { getIamClient, getIamConfig } from "@/src/features/auth/lib/iamServer";
import { logger } from "@hanzo/console/src/server";

/**
 * Same-origin userinfo proxy for the embedded `@hanzo/iam` BrowserIamSdk.
 * Forwards the caller's IAM access token to IAM's OIDC userinfo endpoint and
 * returns the profile, avoiding cross-origin requests from the browser.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).end();
    return;
  }

  const client = getIamClient();
  const config = getIamConfig();
  if (!client || !config) {
    res.status(503).json({ error: "IAM is not configured." });
    return;
  }

  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  try {
    const user = await client.getUserInfo(token);
    res.status(200).json(user);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Userinfo fetch failed.";
    logger.warn("IAM userinfo proxy error: " + message);
    res.status(502).json({ error: message });
  }
}
