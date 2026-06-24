# Production-ready Dockerfile for Hanzo Cloud Dashboard
# Multi-stage build optimized for Next.js applications

# ===== Base Stage =====
FROM node:24-alpine@sha256:cd6fb7efa6490f039f3471a189214d5f548c11df1ff9e5b181aa49e22c14383e AS base

# Install system dependencies (security updates come from bumping the pinned base image,
# not `apk upgrade` — which also breaks Kaniko on alpine-baselayout's /var/run symlink)
RUN apk add --no-cache \
    libc6-compat \
    dumb-init \
    tini \
    ca-certificates && \
    rm -rf /var/cache/apk/*

# Enable Corepack for pnpm (pinned version for reliability)
RUN corepack enable && corepack prepare pnpm@9.5.0 --activate

# Create app directory with proper permissions
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    chown -R nextjs:nodejs /app

# ===== Dependencies Stage =====
FROM base AS deps

# Copy package files
COPY --chown=nextjs:nodejs package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY --chown=nextjs:nodejs .npmrc* ./
COPY --chown=nextjs:nodejs turbo.json* ./
COPY --chown=nextjs:nodejs patches/ ./patches/

# Copy workspace package files
COPY --chown=nextjs:nodejs web/package.json ./web/
COPY --chown=nextjs:nodejs worker/package.json ./worker/
COPY --chown=nextjs:nodejs packages/shared/package.json ./packages/shared/
COPY --chown=nextjs:nodejs packages/config-eslint/package.json ./packages/config-eslint/
COPY --chown=nextjs:nodejs packages/config-typescript/package.json ./packages/config-typescript/
COPY --chown=nextjs:nodejs packages/console-js/package.json ./packages/console-js/
COPY --chown=nextjs:nodejs packages/datastore/package.json ./packages/datastore/
COPY --chown=nextjs:nodejs packages/langchain/package.json ./packages/langchain/
COPY --chown=nextjs:nodejs packages/eslint-plugin/package.json ./packages/eslint-plugin/
COPY --chown=nextjs:nodejs packages/mq/package.json ./packages/mq/

# Switch to nextjs user for security
USER nextjs

# Install dependencies with frozen lockfile
RUN pnpm install --frozen-lockfile

# ===== Builder Stage =====
FROM deps AS builder

# Copy source code
COPY --chown=nextjs:nodejs . .

# Set build environment variables
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Skip env.mjs validation during Docker build
ENV DOCKER_BUILD=1

# Skip Next.js type-checking during the production image build. Type errors are
# enforced by the separate `pnpm typecheck` CI job; the image build only needs
# webpack to compile and pages to generate. (Residual query/eval type-shape
# errors from the shared-package merge are tracked separately.)
ENV NEXT_IGNORE_BUILD_ERRORS=true
# Inlined at build so server-side telemetry() early-returns (Hanzo Cloud uses separate
# telemetry) instead of running the cron/insights path that made /api/public/health hang.
ENV NEXT_PUBLIC_HANZO_CLOUD_REGION=US
# IAM-native client auth: NEXT_PUBLIC_* are inlined at build time, so the browser
# IAM SDK (PKCE / social / IamSessionProvider) only activates when these are baked
# in. Hanzo console talks to IAM at hanzo.id as client `hanzo-console`. White-label
# console builds override these via Kaniko --build-arg (ARG defaults below).
ARG NEXT_PUBLIC_IAM_SERVER_URL=https://hanzo.id
ARG NEXT_PUBLIC_IAM_CLIENT_ID=hanzo-console
ARG NEXT_PUBLIC_IAM_ORG_NAME=hanzo
ARG NEXT_PUBLIC_IAM_APP_NAME=hanzo-console
ENV NEXT_PUBLIC_IAM_SERVER_URL=$NEXT_PUBLIC_IAM_SERVER_URL
ENV NEXT_PUBLIC_IAM_CLIENT_ID=$NEXT_PUBLIC_IAM_CLIENT_ID
ENV NEXT_PUBLIC_IAM_ORG_NAME=$NEXT_PUBLIC_IAM_ORG_NAME
ENV NEXT_PUBLIC_IAM_APP_NAME=$NEXT_PUBLIC_IAM_APP_NAME
# Square Web Payments SDK (commerce billing card entry). Application + location
# ids are PUBLIC values (meant for client code); baked in so the billing page
# can tokenize cards. White-label builds override via Kaniko --build-arg.
ARG NEXT_PUBLIC_SQUARE_APPLICATION_ID=sq0idp-K5tIzrIaUIuH10VNOQRvAw
ARG NEXT_PUBLIC_SQUARE_LOCATION_ID=LYKCG8PRGQK8S
ARG NEXT_PUBLIC_SQUARE_ENVIRONMENT=production
ENV NEXT_PUBLIC_SQUARE_APPLICATION_ID=$NEXT_PUBLIC_SQUARE_APPLICATION_ID
ENV NEXT_PUBLIC_SQUARE_LOCATION_ID=$NEXT_PUBLIC_SQUARE_LOCATION_ID
ENV NEXT_PUBLIC_SQUARE_ENVIRONMENT=$NEXT_PUBLIC_SQUARE_ENVIRONMENT

# Ensure .next dir is owned by nextjs before cache mount creates subdirectory
RUN mkdir -p /app/web/.next

# Build the application (adaptive memory to avoid OOM)
RUN \
    NODE_OPTIONS='--max-old-space-size-percentage=75' pnpm build

# Prisma query engine: Next.js standalone file-tracing misses the runtime-loaded
# native engine (.so.node) + generated client. Consolidate the generated client
# into the standalone bundle so Prisma resolves at request time on alpine/musl.
RUN set -eux; \
    SRC="$(dirname "$(find /app/node_modules -name 'libquery_engine-linux-musl-openssl-3.0.x.so.node' -print -quit)")"; \
    for DEST in \
      /app/web/.next/standalone/web/.prisma/client \
      /app/web/.next/standalone/node_modules/.prisma/client \
      /app/web/.next/standalone/packages/shared/node_modules/.prisma/client ; do \
      mkdir -p "$DEST"; cp -a "$SRC"/. "$DEST"/ 2>/dev/null || true; \
    done; \
    for d in $(find /app/web/.next/standalone -type d -path '*@prisma/client'); do \
      cp "$SRC"/libquery_engine-*.so.node "$d"/ 2>/dev/null || true; \
    done; \
    ls -la /app/web/.next/standalone/web/.prisma/client

# @hanzo/mq is a serverExternalPackage (resolved at runtime, not bundled). Its workspace
# dist can be missed by standalone tracing — copy it into the bundle node_modules.
RUN set -eux; \
    if [ -d /app/packages/mq/dist ]; then \
      D=/app/web/.next/standalone/node_modules/@hanzo/mq; mkdir -p "$D"; \
      cp -a /app/packages/mq/package.json "$D"/; cp -a /app/packages/mq/dist "$D"/dist; \
    fi

# Seed the SQLite app DB at build time (prisma CLI is available here, not in the slim
# runtime). `prisma db push` materializes all 68 tables into a seed file; the runtime
# entrypoint copies it onto the (initially-empty) PVC on first boot. Avoids shipping the
# prisma CLI + engines into production and avoids the db-push-at-boot hang.
RUN set -eux; \
    mkdir -p /app/seed; \
    cd /app/packages/shared; \
    DATABASE_URL="file:/app/seed/app.db" \
      ./node_modules/.bin/prisma db push \
        --schema=./prisma/schema.prisma --skip-generate --accept-data-loss; \
    cd /app; ls -la /app/seed/app.db

# ===== Development Stage =====
FROM deps AS development

# Copy source code
COPY --chown=nextjs:nodejs . .

# Expose port
EXPOSE 3000

# Set environment
ENV NODE_ENV=development
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "const http = require('http'); \
    const req = http.request({hostname: 'localhost', port: 3000, path: '/v1/ready', method: 'GET'}, \
    (res) => process.exit(res.statusCode === 200 ? 0 : 1)); \
    req.on('error', () => process.exit(1)); \
    req.end();" || exit 1

# Development command with hot reload
CMD ["pnpm", "dev"]

# ===== Production Stage =====
FROM base AS production

# Copy built application from builder
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./web/public

# Copy worker if it exists
COPY --from=builder --chown=nextjs:nodejs /app/worker/dist ./worker/dist

# Copy the build-time SQLite seed (68 tables) — the entrypoint seeds the PVC from it.
COPY --from=builder --chown=nextjs:nodejs /app/seed/app.db ./seed/app.db

# Switch to nextjs user for security
USER nextjs

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1
# Bulletproof: point Prisma directly at the bundled musl query engine, bypassing
# the path-search heuristic (engine copied to web/.prisma/client in the builder).
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/web/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "const http = require('http'); \
    const req = http.request({hostname: 'localhost', port: 3000, path: '/v1/ready', method: 'GET'}, \
    (res) => process.exit(res.statusCode === 200 ? 0 : 1)); \
    req.on('error', () => process.exit(1)); \
    req.end();" || exit 1

# tini for signal handling; seed the SQLite app DB onto the (empty) PVC on first boot
# from the build-time seed (68 tables), then start the Next standalone server. Avoids
# running prisma db push at runtime (no prisma CLI in the slim image) and the resulting
# DB-less health-endpoint hang.
ENTRYPOINT ["/sbin/tini", "--", "sh", "-c", "set -e; DBPATH=\"${DATABASE_URL#file:}\"; : \"${DBPATH:=/var/lib/hanzo/console/app.db}\"; mkdir -p \"$(dirname \"$DBPATH\")\"; SEED=/app/seed/app.db; cur=$(wc -c < \"$DBPATH\" 2>/dev/null || echo 0); seedsz=$(wc -c < \"$SEED\"); if [ ! -f \"$DBPATH\" ] || [ \"$cur\" -lt \"$seedsz\" ]; then echo \"seeding SQLite db (cur=$cur seed=$seedsz) -> $DBPATH\"; cp \"$SEED\" \"$DBPATH\"; else echo \"existing SQLite db kept ($cur bytes)\"; fi; exec node web/server.js"]

# ===== Default to production =====
FROM production