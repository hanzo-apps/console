@0xdd887f33bec97a37;
# UiCustomization capability interface — ZAP-native replacement for the
# uiCustomization tRPC router. Compiled by zap-es into TS bindings via
# `pnpm zap:gen` (see web/proto/README.md). Imports resolve to `capnp-es`.
#
# Permission model: the caller's verified Capability carries a u64 Permissions
# bitmask (see zap-proto/zap-spec/capabilities.zap + capabilities_kinds.md).
# These are read-only methods on a CapKindIAMSession (0x01) cap, so the server
# gates both on the canonical PermSessionRead bit (1 << 0). Enforcement is the
# single chokepoint requirePermission(ctx, bit) in web/src/server/zap/context.ts.
#
#   PermSessionRead = 1 << 0   (CapKindIAMSession low bit, per capabilities_kinds.md)

struct UiCustomizationConfig {
  # Mirrors the object the tRPC `get` procedure returned. `present` is false when
  # the holder lacks the self-host-ui-customization entitlement (was tRPC `null`).
  present                @0  :Bool;
  hostname               @1  :Text;
  documentationHref      @2  :Text;
  supportHref            @3  :Text;
  feedbackHref           @4  :Text;
  logoLightModeHref      @5  :Text;
  logoDarkModeHref       @6  :Text;
  defaultModelAdapter    @7  :Text;
  defaultBaseUrlOpenAI   @8  :Text;
  defaultBaseUrlAnthropic @9 :Text;
  defaultBaseUrlAzure    @10 :Text;
  visibleModules         @11 :List(Text);
}

struct VisibleModules {
  modules @0 :List(Text);
}

struct Empty {}

interface UiCustomization {
  # get returns the full customization config (or present=false when the holder
  # is not entitled). Requires PERM_UI_CUSTOMIZATION_READ.
  get @0 () -> (config :UiCustomizationConfig);

  # getModules returns just the visible product module list. Requires
  # PERM_UI_CUSTOMIZATION_READ. Exists as a distinct, pipeline-able method so a
  # caller can fan out config + modules without two round trips.
  getModules @1 () -> (result :VisibleModules);
}
