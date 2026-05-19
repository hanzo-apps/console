// ---------------------------------------------------------------------------
// ZT ZAP Frontend Client
//
// Calls the ZAP tool endpoint at /v1/zap/zt from the browser.
// Used by React Query hooks in hooks.ts.
// ---------------------------------------------------------------------------

export class ZapError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ZapError";
    this.status = status;
  }
}

/**
 * Call a ZT ZAP tool.
 *
 * POST /v1/zap/zt { name, args } → { content: T }
 */
export async function zapCallZt<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch("/v1/zap/zt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args }),
  });

  if (!res.ok) {
    const body = await res.text();
    let message: string;
    try {
      message = (JSON.parse(body) as { error?: string }).error ?? body;
    } catch {
      message = body;
    }
    throw new ZapError(res.status, message);
  }

  const data = (await res.json()) as { content: T };
  return data.content;
}
