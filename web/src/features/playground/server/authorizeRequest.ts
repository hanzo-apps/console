import { cookies } from "next/headers";

import {
  getIamSessionFromCookie,
  SESSION_COOKIE,
} from "@/src/features/auth/lib/iamSession";
import { isProjectMemberOrAdmin } from "@/src/server/utils/checkProjectMembershipOrAdmin";
import { ForbiddenError, UnauthorizedError } from "@hanzo/console";

export type AuthorizeRequestResult = {
  userId: string;
  // The IAM identity carried by the session — used to resolve the signed-in
  // user's per-user `hk-` Cloud API key when routing through the Hanzo meter.
  // Additive: existing callers that only read `userId` are unaffected.
  iamSub?: string;
  email?: string | null;
};

export const authorizeRequestOrThrow = async (
  projectId: string,
): Promise<AuthorizeRequestResult> => {
  const session = await getIamSessionFromCookie(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  if (!session?.user) throw new UnauthorizedError("Unauthenticated");

  if (!isProjectMemberOrAdmin(session.user, projectId))
    throw new ForbiddenError("User is not a member of this project");

  return {
    userId: session.user.id,
    iamSub: session.user.iamSub,
    email: session.user.email,
  };
};
