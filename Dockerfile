# console2 — Hanzo Cloud Console (Next.js 15 + @hanzo/gui). BSD-3-Clause.
# NEXT_PUBLIC_* are inlined at build time (browser config), so they are build args.
FROM public.ecr.aws/docker/library/node:24-alpine AS build
WORKDIR /app
# Exact commit for a deterministic Next build id (next.config.mjs generateBuildId).
# The alpine image has no git binary, so CI passes the SHA as a build arg -> ENV,
# baked into .next/BUILD_ID so every replica of this image shares ONE build id.
ARG SOURCE_COMMIT=""
ENV SOURCE_COMMIT=$SOURCE_COMMIT
# Copy ALL source FIRST, then install — order matters under Kaniko --single-snapshot:
# a `COPY` that FOLLOWS `RUN npm install` in the same stage drops the RUN's freshly
# created node_modules (the 'next not found' cause — the install's own `test -f next`
# passed, then `COPY . .` wiped node_modules before the build RUN). Putting COPY
# before install means node_modules is created by the LAST RUNs and nothing clobbers
# it. (Layer-cache for deps is moot here — the on-cluster build runs --cache=false.)
COPY . .
# public/ may be empty (git doesn't track empty dirs) — ensure it exists for the runner COPY.
RUN mkdir -p public
# npm install (not ci): @hanzo/gui pulls a react-native dep tree whose platform/
# optional packages resolve differently across npm versions, so a lockfile generated
# by one npm fails `npm ci` under another. install reconciles the tree for the
# build platform; retry-hardened against registry throttling.
RUN npm install --no-audit --no-fund --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-timeout=120000
# ONE brand-agnostic image: brand (IAM org/issuer/app + wordmark) is resolved at
# RUNTIME from the request hostname (src/config/index.ts), and /v1 is same-origin
# per host. Baking NEXT_PUBLIC_* here would inline a single brand and break that.
# Next 15 + @hanzo/gui (large RN dep tree) overflows Node's default heap → OOMKill
# (exit 137); cap the heap generously (chat uses 4096).
ENV NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=6144
RUN npm run build

FROM public.ecr.aws/docker/library/node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=4000
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
USER app
EXPOSE 4000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "4000"]
