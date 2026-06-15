/**
 * ZAP dispatch — turn a decoded capability + a method selector into a real RPC
 * round trip through a zap-es {@link Conn}, and JSON-encode the result struct.
 *
 * This is the shared seam used by both the HTTP route (dev JSON fallback) and the
 * test. It does NOT shortcut the RPC machinery: it bootstraps the typed
 * `ZapRoot$Client` over the in-process loopback and calls the generated client
 * methods, so capability gating, the Server.impl dispatch, and promise pipelining
 * all run exactly as they would over a socket.
 */
import { connectInProcess } from "@/src/server/zap/bridge";
import {
  createZapContext,
  CapabilityDeniedError,
  type Capability,
  type ZapContext,
} from "@/src/server/zap/context";
import { zapRootServer } from "@/src/server/zap/root";
import { ZapRoot, type ZapRoot$Client } from "@/src/server/zap/gen/root";
import {
  type UiCustomizationConfig,
  type VisibleModules,
} from "@/src/server/zap/gen/ui-customization";

/**
 * Open a typed ZapRoot client backed by a server bound to `cap`. The prisma
 * handle is injected (the route passes the real singleton); callers whose target
 * routers don't touch the DB — like ui-customization — may pass a bare handle.
 */
export function openRoot(
  cap: Capability,
  prisma: ZapContext["prisma"],
): { root: ZapRoot$Client; close(): void } {
  const ctx = createZapContext(cap, prisma);
  const target = zapRootServer(ctx).target;
  const { clientConn, serverConn, bootstrap } = connectInProcess(
    ZapRoot,
    target,
  );
  return {
    root: bootstrap(),
    close: () => {
      clientConn.shutdown();
      serverConn.shutdown();
    },
  };
}

/**
 * The RPC layer wraps a server-thrown error into a MethodError whose message
 * carries the original reason (zap-es toException copies err.message into
 * Exception.reason). Re-surface a capability denial as the typed
 * {@link CapabilityDeniedError} so callers (and the route) get a clean 403, not an
 * opaque "CAPNP-TS116 RPC method failed" string.
 */
async function translateCapErrors<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("capability denied")) {
      throw new CapabilityDeniedError(message);
    }
    throw err;
  }
}

/** Plain-object view of UiCustomizationConfig — the dev JSON the frontend reads. */
export interface UiCustomizationConfigJSON {
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

function configToJSON(c: UiCustomizationConfig): UiCustomizationConfigJSON {
  return {
    present: c.present,
    hostname: c.hostname,
    documentationHref: c.documentationHref,
    supportHref: c.supportHref,
    feedbackHref: c.feedbackHref,
    logoLightModeHref: c.logoLightModeHref,
    logoDarkModeHref: c.logoDarkModeHref,
    defaultModelAdapter: c.defaultModelAdapter,
    defaultBaseUrlOpenAI: c.defaultBaseUrlOpenAI,
    defaultBaseUrlAnthropic: c.defaultBaseUrlAnthropic,
    defaultBaseUrlAzure: c.defaultBaseUrlAzure,
    visibleModules: c.visibleModules.toArray(),
  };
}

function modulesToJSON(m: VisibleModules): string[] {
  return m.modules.toArray();
}

/**
 * uiCustomization.get over ZAP. Demonstrates promise pipelining: we vend the
 * capability and call `.get()` on the PROMISED handle without awaiting the vend.
 */
export async function uiCustomizationGet(
  cap: Capability,
  prisma: ZapContext["prisma"],
): Promise<UiCustomizationConfigJSON> {
  const { root, close } = openRoot(cap, prisma);
  try {
    // root.uiCustomization() returns a promise for the capability; .getCap()
    // gives the pipelined client; .get() rides on the unresolved answer.
    const config = await translateCapErrors(
      root.uiCustomization().getCap().get().promise(),
    );
    return configToJSON(config.config);
  } finally {
    close();
  }
}

/** uiCustomization.getModules over ZAP (pipelined the same way). */
export async function uiCustomizationGetModules(
  cap: Capability,
  prisma: ZapContext["prisma"],
): Promise<string[]> {
  const { root, close } = openRoot(cap, prisma);
  try {
    const res = await translateCapErrors(
      root.uiCustomization().getCap().getModules().promise(),
    );
    return modulesToJSON(res.result);
  } finally {
    close();
  }
}
