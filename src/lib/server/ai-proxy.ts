/**
 * AI-proxy header policy (server-only, pure).
 *
 * The keyless `/ai` proxy (`app/ai/[...path]/route.ts`) rebuilds the upstream
 * request headers from scratch so the browser's session cookie never leaks to the
 * gateway. That rebuild must still carry the RAG retrieval switch the backend
 * reads on `chat/completions` (`X-Retrieval` / `X-Retrieval-Store`,
 * controllers/chat_retrieval.go) — otherwise `AiApi.ragChat` silently degrades to
 * a plain answer. This is the ONE allow-list of client headers the proxy forwards;
 * keeping it here makes the policy a tested value, not an inline detail.
 */

/** Client headers the proxy is allowed to pass through to the gateway. */
export const FORWARDED_HEADERS = ['X-Retrieval', 'X-Retrieval-Store'] as const

/**
 * Pick the allow-listed retrieval headers present on the incoming request.
 * `get` is a case-insensitive lookup (e.g. `Headers.get`). Returns only the
 * headers that are actually set, so a plain chat sends none.
 */
export function retrievalHeaders(get: (name: string) => string | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of FORWARDED_HEADERS) {
    const v = get(h)
    if (v) out[h] = v
  }
  return out
}
