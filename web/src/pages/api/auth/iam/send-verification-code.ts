import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod/v4";
import {
  iamSendVerificationCode,
  isIamConfigured,
} from "@/src/features/auth/lib/iamServer";
import { validateSignupEligibility } from "@/src/features/auth-credentials/server/signupApiHandler";

const schema = z.object({ email: z.email() });

/**
 * IAM-native: request an email verification code for the embedded signup flow.
 * Delegates to IAM's `/v1/iam/send-verification-code` (IAM is the identity
 * authority that owns code issuance and delivery).
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
    res.status(404).json({ message: "IAM is not configured." });
    return;
  }

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(422)
      .json({ message: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const email = parsed.data.email.toLowerCase();

  const eligibilityError = await validateSignupEligibility({ email });
  if (eligibilityError) {
    res.status(422).json({ message: eligibilityError });
    return;
  }

  const result = await iamSendVerificationCode({ email });
  if (!result.ok) {
    res.status(502).json({ message: result.error });
    return;
  }
  res.status(200).json({ status: "ok" });
}
