@0xdd132de0c4d5bb3c;
# ZapRoot — the bootstrap capability the client obtains from a Conn.
#
# This is the single capability handle a freshly-connected client holds. Each
# method vends a sub-capability (a typed interface) for one former tRPC router.
# Because the methods return INTERFACE results, the client can promise-pipeline:
# call ZapRoot.uiCustomization() and immediately call .get() on the returned
# (not-yet-resolved) capability — zap-es queues the second call against the
# promised answer, so both travel without waiting for the first round trip.
#
# Per-router migration = add ONE method here that returns the router's interface,
# plus register the backing Server in web/src/server/zap/root.ts. Nothing else.

using UiC = import "/ui-customization.zap";

interface ZapRoot {
  # uiCustomization vends the UiCustomization capability (replaces the
  # uiCustomization tRPC router).
  uiCustomization @0 () -> (cap :UiC.UiCustomization);
}
