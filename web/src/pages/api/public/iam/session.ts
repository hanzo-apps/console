import type { NextApiRequest, NextApiResponse } from "next";
import { getIamServerSession } from "@/src/features/auth/lib/iamSession";

/**
 * GET /v1/iam/session — the hydrated console session for the signed `hi_session`
 * cookie, or `{}` when unauthenticated. The client `SessionProvider` polls this
 * (replaces next-auth's `/api/auth/session`).
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
  const session = await getIamServerSession({ req, res });
  res.status(200).json(session ?? {});
}
