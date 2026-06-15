#!/usr/bin/env bash
# Regenerate native ZAP TS bindings from the zap-spec .zap schemas in this dir.
#
# One command, idempotent: `pnpm --filter web zap:gen` (or run directly).
# Output lands in web/src/server/zap/gen/ as <schema>_zap.ts, importing the
# native @hanzo/zap runtime (NO capnp, NO capnp-es).
#
# The schema is the SAME zap-spec dialect the Go service binary compiles
# (github.com/hanzoai/ui-customization/proto/ui-customization.zap). One schema,
# two code targets (Go views server-side, TS views here) — zapgen --target.
#
# Requires: the zapgen compiler from github.com/zap-proto/go. Build it once with
#   ( cd ../../../zap-proto/go/cmd/zapgen && go build -o zapgen . )
# ZAPGEN may override the binary path; ZAP_GO overrides the go source checkout.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"        # web/proto
WEB="$(cd "$HERE/.." && pwd)"                                 # web
ZAP_GO="${ZAP_GO:-$(cd "$WEB/../../../zap-proto/go" && pwd)}"
OUT="$WEB/src/server/zap/gen"

# Resolve (or build) the zapgen binary.
ZAPGEN="${ZAPGEN:-$ZAP_GO/cmd/zapgen/zapgen}"
if [ ! -x "$ZAPGEN" ]; then
  echo "building zapgen -> $ZAPGEN" >&2
  ( cd "$ZAP_GO/cmd/zapgen" && go build -o zapgen . )
fi

mkdir -p "$OUT"

# Emit TS views/builders for every schema in this dir.
for schema in "$HERE"/*.zap; do
  "$ZAPGEN" --target=ts -out "$OUT" "$schema"
done

# Format to the repo's prettier style so regeneration is byte-idempotent.
( cd "$WEB" && node_modules/.bin/prettier --write --log-level warn "$OUT"/*.ts )

echo "ZAP TS bindings regenerated -> $OUT"
