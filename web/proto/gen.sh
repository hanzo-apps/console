#!/usr/bin/env bash
# Regenerate ZAP TS bindings from the .capnp schemas in this dir.
#
# One command, idempotent: `pnpm --filter web zap:gen` (or run directly).
# Output lands in web/src/server/zap/gen/. Generated files import `capnp-es`,
# which resolves to the zap-es package (aliased in web/package.json).
#
# Requires: capnp (brew install capnp) + the zap-es source checkout. ZAP_ES may
# override the zap-es location (default: ../../../../zap-proto/zap-es from web/).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"        # web/proto
WEB="$(cd "$HERE/.." && pwd)"                                 # web
ZAP="${ZAP_ES:-$(cd "$WEB/../../../zap-proto/zap-es" && pwd)}"
OUT="$WEB/src/server/zap/gen"

if ! command -v capnp >/dev/null 2>&1; then
  echo "error: capnp not found on PATH (brew install capnp)" >&2
  exit 1
fi

# zap-es self-hosts its compiler via the 'capnp-es' specifier; ensure it resolves.
if [ ! -e "$ZAP/node_modules/capnp-es" ]; then
  ln -sfn "$ZAP" "$ZAP/node_modules/capnp-es"
fi

mkdir -p "$OUT"

# Compile all schemas together so cross-imports (root -> ui-customization) resolve.
# ts-only: the console's own tsgo type-checks the .ts in context (where capnp-es
# resolves); we do not emit .d.ts from here (that pass type-checks under zap-es's
# own tsconfig, where the alias is absent).
( cd "$HERE" && npx --prefix "$ZAP" jiti "$ZAP/src/compiler/capnpc-js.ts" \
    "-I$HERE" \
    "$HERE"/*.capnp \
    -ots:"$OUT" \
    --src-prefix="$HERE" )

# Normalize generated cross-imports to the repo's extensionless sibling convention
# and drop unused names capnp-es over-imports (".//x.js" -> "./x", prune unused).
node "$HERE/normalize-gen.mjs" "$OUT"

# Format to the repo's prettier style so regeneration is byte-idempotent.
( cd "$WEB" && node_modules/.bin/prettier --write --log-level warn "$OUT"/*.ts )

echo "ZAP bindings regenerated -> $OUT"
