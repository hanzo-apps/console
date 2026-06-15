# ZAP schemas (`web/proto/`)

Canonical home for this app's ZAP capability-RPC schemas. `.capnp` files here are
compiled by zap-es into TS bindings at `web/src/server/zap/gen/` via
`pnpm --filter web zap:gen` (needs `capnp` on PATH + the zap-es checkout).

Generated code imports `capnp-es`, aliased to the `zap-es` package in
`web/package.json`. The capability wire contract (CapKind/Perm/Caveat) lives in
`zap-proto/zap-spec/` — these schemas reference it, they don't redefine it.

Per-router migration: add a method to `root.capnp` returning the router's
interface, run `zap:gen`, implement the `$Server$Target`, register in
`web/src/server/zap/root.ts`. See `ui-customization.capnp` as the reference.
