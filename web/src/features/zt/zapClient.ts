// ---------------------------------------------------------------------------
// ZT ZAP Frontend Client — thin alias over the generic ZAP client.
//
// The generic `zapCall` (features/zap/zapClient) routes "<scope>.<method>" to
// /v1/zap/<scope>; "zt.*" lands on the dedicated /v1/zap/zt route. Kept as a
// named export so the zt hooks/call sites stay unchanged while all ZAP traffic
// flows through one client. New domains import `zapCall` directly.
// ---------------------------------------------------------------------------

export { ZapError } from "@/src/features/zap/zapClient";
import { zapCall } from "@/src/features/zap/zapClient";

/** Call a ZT ZAP tool. POST /v1/zap/zt { name, args } → content. */
export function zapCallZt<T = unknown>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  return zapCall<T>(name, args);
}
