/**
 * ZapRoot server — the bootstrap capability every client obtains from a Conn.
 *
 * This is the registry of migrated routers. Each method vends one router's
 * capability (a typed interface) bound to the request's {@link ZapContext}. Adding
 * a router to ZAP = add ONE method here returning that router's `$Client`, built
 * from its server's `.client()`. Nothing else in the foundation changes.
 *
 * Returning interface-typed capabilities is what enables promise pipelining: a
 * client can call `root.uiCustomization()` and immediately `.get()` on the
 * promised capability; zap-es queues the second call against the unresolved
 * answer (see web/src/server/zap/gen/root.ts getCap()).
 */
import { uiCustomizationServer } from "@/src/features/ui-customization/uiCustomizationServer";
import { type ZapContext } from "@/src/server/zap/context";
import {
  ZapRoot$Server,
  type ZapRoot$Server$Target,
  type ZapRoot_UiCustomization$Params,
  type ZapRoot_UiCustomization$Results,
} from "@/src/server/zap/gen/root";

class ZapRootTarget implements ZapRoot$Server$Target {
  constructor(private readonly ctx: ZapContext) {}

  /** Vends the UiCustomization capability (replaces the uiCustomization router). */
  async uiCustomization(
    _params: ZapRoot_UiCustomization$Params,
    results: ZapRoot_UiCustomization$Results,
  ): Promise<void> {
    results.cap = uiCustomizationServer(this.ctx).client();
  }
}

/** Build the root ZAP server for a request, bound to its capability context. */
export function zapRootServer(ctx: ZapContext): ZapRoot$Server {
  return new ZapRoot$Server(new ZapRootTarget(ctx));
}
