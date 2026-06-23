import { createNextApiHandler } from "@trpc/server/adapters/next";
import { type NextApiRequest, type NextApiResponse } from "next";
import { createTRPCContext } from "@/src/server/api/trpc";
import { appRouter } from "@/src/server/api/root";
import { env } from "@/src/env.mjs";
import { logger, traceException } from "@hanzo/console/src/server";

export const config = {
  maxDuration: 240,
  api: {
    bodyParser: {
      sizeLimit: "4.5mb",
    },
  },
};

// export API handler
const trpcApiHandler = createNextApiHandler({
  router: appRouter,
  createContext: createTRPCContext,
  onError: ({ path, error }) => {
    // User errors that should not be reported to Sentry
    const userErrorCodes = [
      "NOT_FOUND",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "BAD_REQUEST",
      "PRECONDITION_FAILED",
    ];

    if (userErrorCodes.includes(error.code)) {
      logger.info(
        `tRPC route failed on ${path ?? "<no-path>"}: ${error.message}`,
        error,
      );
    } else {
      logger.error(
        `tRPC route failed on ${path ?? "<no-path>"}: ${error.message}`,
        error,
      );
      // Only report system errors to Sentry, not user errors
      traceException(error);
    }
    return error;
  },
  responseMeta() {
    return {
      headers: {
        "x-build-id": env.NEXT_PUBLIC_BUILD_ID,
      },
    };
  },
  // as `any` workaround for Next.js 15.5+ compatibility with tRPC, probably fixed in Next.js 15.6+
  // Related: https://discord-questions.trpc.io/m/1409997624492294276
}) as any;

// The published surface is `/v1/trpc/<proc>`, rewritten to this `[trpc]` route by
// web/src/middleware.ts. A Next middleware `rewrite()` to a dynamic Pages-API route
// does NOT populate the `[trpc]` dynamic param, so `createNextApiHandler` (which
// reads `req.query.trpc`) throws `Query "trpc" not found`. Recover the procedure
// from the URL — works whether `req.url` is the `/v1/trpc/...` or `/api/trpc/...`
// form, single or comma-batched — before delegating to the tRPC adapter.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.query.trpc === undefined) {
    const match = (req.url ?? "").match(/\/trpc\/([^?]+)/);
    if (match?.[1]) req.query.trpc = decodeURIComponent(match[1]);
  }
  return trpcApiHandler(req, res);
}
