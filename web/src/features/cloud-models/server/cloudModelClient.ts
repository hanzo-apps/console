import { TRPCError } from "@trpc/server";
import { env } from "@/src/env.mjs";

// The unified Hanzo Cloud API (model config / routing). In-cluster service DNS
// by default; override with CLOUD_API_URL. Uses the canonical `/v1` surface
// (never `/api/*`).
const CLOUD_API_BASE = env.CLOUD_API_URL ?? "http://cloud-api.hanzo.svc:8000";

function toTRPCError(status: number, body: string): TRPCError {
  const map: Record<number, TRPCError["code"]> = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    429: "TOO_MANY_REQUESTS",
  };
  return new TRPCError({
    code: map[status] ?? "INTERNAL_SERVER_ERROR",
    message: `Cloud API error (${status}): ${body}`,
  });
}

async function cloudRequest<T>(params: {
  method: string;
  path: string;
  sessionToken?: string;
  body?: unknown;
  queryParams?: Record<string, string | undefined>;
}): Promise<T> {
  const url = new URL(params.path, CLOUD_API_BASE);
  if (params.queryParams) {
    for (const [k, v] of Object.entries(params.queryParams)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (params.sessionToken) {
    headers["Authorization"] = `Bearer ${params.sessionToken}`;
  }

  // Bound the wait so an unreachable backend degrades fast instead of hanging.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url.toString(), {
      method: params.method,
      headers,
      signal: controller.signal,
      ...(params.body ? { body: JSON.stringify(params.body) } : {}),
    });

    const text = await res.text();
    if (!res.ok) throw toTRPCError(res.status, text);

    return text ? (JSON.parse(text) as T) : ({} as T);
  } finally {
    clearTimeout(timeout);
  }
}

export function cloudGet<T>(params: {
  path: string;
  sessionToken?: string;
  queryParams?: Record<string, string | undefined>;
}): Promise<T> {
  return cloudRequest<T>({
    method: "GET",
    path: params.path,
    sessionToken: params.sessionToken,
    queryParams: params.queryParams,
  });
}

export function cloudPost<T>(params: {
  path: string;
  sessionToken?: string;
  body: unknown;
  queryParams?: Record<string, string | undefined>;
}): Promise<T> {
  return cloudRequest<T>({
    method: "POST",
    path: params.path,
    sessionToken: params.sessionToken,
    body: params.body,
    queryParams: params.queryParams,
  });
}
