import type { NextApiRequest, NextApiResponse } from "next";
import {
  establishIamSessionFromToken,
  sessionSetCookie,
} from "@/src/features/auth/lib/iamSession";

/**
 * POST /v1/iam/token-session — bridge an IAM access token (obtained client-side
 * by the BrowserIamSdk via the embedded form or a social OIDC redirect) into the
 * signed console session cookie. The token is validated against IAM's JWKS.
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

  const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as {
    accessToken?: string;
  };
  if (!body?.accessToken) {
    res.status(400).json({ error: "Missing accessToken." });
    return;
  }

  const result = await establishIamSessionFromToken(body.accessToken);
  if (!result.ok) {
    res.status(401).json({ error: result.error });
    return;
  }

  res.setHeader("Set-Cookie", sessionSetCookie(result.cookie));
  res.status(200).json({ ok: true });
}
