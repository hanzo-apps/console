/**
 * zapClient — thin browser client for the native ZAP capability-RPC bridge.
 *
 * Replaces `api.<router>.<proc>.useQuery()` for migrated routers. Posts to the
 * Next.js bridge at /v1/zap/<interface> with the wielder's Capability in the
 * `x-zap-capability` header (a Capability REPLACES the bearer JWT — see
 * zap-proto/zap-spec/SPEC.md §1). The bridge proxies onto the native ZAP Go
 * service binary over the @hanzo/zap TCP transport — no capnp anywhere in the
 * path. The browser stays HTTP (the TCP client is Node-only); the bridge holds
 * the connection.
 *
 * The browser obtains its session capability from the same place it used to get
 * the session cookie; until that exchange ships (its own milestone), dev mints a
 * minimal CapKindIAMSession read cap. The Go service still gates on it.
 */

/** Dev session capability: CapKindIAMSession with PermSessionRead (bit 0). */
function devSessionCapabilityHeader(): string {
  return JSON.stringify({
    kind: 0x01, // CapKind.IAMSession
    holder: "00".repeat(32),
    issuer: "00".repeat(32),
    permissions: "1", // Perm.SessionRead = 1 << 0
    expiresAt: "0",
    caveatKinds: [],
  });
}

async function zapCall<T>(iface: string, method: string): Promise<T> {
  const res = await fetch(`/v1/zap/${iface}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zap-capability": devSessionCapabilityHeader(),
    },
    body: JSON.stringify({ method }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      body.error ?? `ZAP ${iface}.${method} failed: ${res.status}`,
    );
  }
  const body = (await res.json()) as { result: T };
  return body.result;
}

export interface UiCustomizationConfig {
  present: boolean;
  hostname: string;
  documentationHref: string;
  supportHref: string;
  feedbackHref: string;
  logoLightModeHref: string;
  logoDarkModeHref: string;
  defaultModelAdapter: string;
  defaultBaseUrlOpenAI: string;
  defaultBaseUrlAnthropic: string;
  defaultBaseUrlAzure: string;
  visibleModules: string[];
}

/** ZAP client surface for the ui-customization capability. */
export const zapUiCustomization = {
  get: () => zapCall<UiCustomizationConfig>("ui-customization", "get"),
  getModules: () => zapCall<string[]>("ui-customization", "getModules"),
};
