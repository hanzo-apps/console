import type { NextApiRequest, NextApiResponse } from "next";
import { sessionClearCookie } from "@/src/features/auth/lib/iamSession";

/**
 * POST /v1/iam/signout — clear the signed `hi_session` cookie. The client also
 * clears the IAM SDK tokens (sessionStorage) and may redirect to IAM logout.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).end();
    return;
  }
  res.setHeader("Set-Cookie", sessionClearCookie());
  res.status(200).json({ ok: true });
}
