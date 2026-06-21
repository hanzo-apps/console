/**
 * Generic ZAP client — the single browser entry point for the tRPC→ZAP
 * strangler. Calls a named tool `"<scope>.<method>"`; the scope prefix
 * selects the `/v1/zap/<scope>` route, which dispatches via the server-side
 * ZAP registry. Use directly inside React Query (`queryFn`/`mutationFn`),
 * exactly like the `zt` feature does today.
 *
 *   const data = await zapCall<PromptList>("prompts.all", { projectId });
 */

export class ZapError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ZapError";
    this.status = status;
  }
}

/** Call a ZAP tool: POST /v1/zap/<scope> { name, args } → content. */
export async function zapCall<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const scope = name.split(".")[0];
  const res = await fetch(`/v1/zap/${scope}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name, args }),
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new ZapError(res.status, message);
  }

  const data = (await res.json()) as { content: T };
  return data.content;
}
