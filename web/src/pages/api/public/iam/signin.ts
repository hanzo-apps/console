import type { NextApiRequest, NextApiResponse } from "next";
import {
  iamPasswordLogin,
  isIamConfigured,
} from "@/src/features/auth/lib/iamServer";
import {
  establishIamSession,
  sessionSetCookie,
} from "@/src/features/auth/lib/iamSession";

/**
 * POST /v1/iam/signin — email + password. IAM verifies the credential; on
 * success console upserts the identity and sets the signed `hi_session` cookie.
 * IAM is the credential authority — console never checks a local hash.
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
  if (!isIamConfigured()) {
    res.status(503).json({ error: "IAM is not configured." });
    return;
  }

  const body = (
    typeof req.body === "string" ? JSON.parse(req.body) : req.body
  ) as {
    email?: string;
    password?: string;
  };
  if (!body?.email || !body?.password) {
    res.status(400).json({ error: "Missing email or password." });
    return;
  }

  const result = await iamPasswordLogin({
    email: body.email,
    password: body.password,
  });
  if (!result.ok) {
    res.status(401).json({ error: result.error });
    return;
  }

  const cookie = await establishIamSession(result.identity);
  res.setHeader("Set-Cookie", sessionSetCookie(cookie));
  res.status(200).json({ ok: true });
}
