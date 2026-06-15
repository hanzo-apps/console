# ZAP schemas (`web/proto/`)

Canonical home for this app's native ZAP capability-RPC schemas. The `.zap`
files here use the **zap-spec dialect** (`package … / Field Type @off`) — the
SAME dialect the Go service binaries compile. Each service's schema IS the
schema; the console copies it verbatim (e.g. `ui-customization.zap` is a copy of
`hanzoai/ui-customization/proto/ui-customization.zap`). No capnp, no
`interface @0xID`, no `*.capnp`.

`zapgen --target=ts` (from `github.com/zap-proto/go`) compiles each `.zap` into
TS View/Builder classes at `web/src/server/zap/gen/<schema>_zap.ts`, importing
the native **`@hanzo/zap`** runtime. Run via `pnpm --filter web zap:gen` (builds
the zapgen binary on demand). The capability wire contract (CapKind/Perm/Caveat)
lives in `zap-proto/zap-spec/` — these schemas reference it, they don't redefine
it; `capabilities_zap.ts` is generated alongside so the bridge can build cap
buffers.

The browser never speaks ZAP directly: it POSTs to the bridge
(`web/src/pages/api/zap/[[...path]].ts`), which proxies onto the Go service over
the `@hanzo/zap` TCP transport.

Per-service migration:
1. Clone the Go service binary; write/copy its `proto/<svc>.zap` here.
2. `pnpm --filter web zap:gen` → generated views/builder.
3. Point the bridge at the service (`<SVC>_ZAP_URL`); call via the `@hanzo/zap`
   `ZapClient`. See `ui-customization.zap` + the bridge as the reference.
