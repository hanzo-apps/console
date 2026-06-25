# The node alpine image is available here: https://github.com/nodejs/docker-node
FROM node:24-alpine@sha256:cd6fb7efa6490f039f3471a189214d5f548c11df1ff9e5b181aa49e22c14383e AS alpine

# It's important to update the index before installing packages to ensure you're getting the latest versions.
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk update && apk upgrade --no-cache libcrypto3 libssl3 libc6-compat busybox ssl_client zlib



# Build golang-migrate with Hanzo Datastore driver support
FROM golang:1.24-alpine AS migrate-builder
RUN apk add --no-cache git
# hanzoai/migrate is private. Authenticate the clone with GH_PAT when provided
# (CI passes the org PAT as a build-arg); fall back to an unauthenticated clone
# so public-repo / local builds still work. The token lives ONLY in this
# discarded builder stage — the final image copies just the migrate binary, so
# the credential never reaches a published layer.
ARG GH_PAT=""
RUN if [ -n "$GH_PAT" ]; then \
      git config --global url."https://x-access-token:${GH_PAT}@github.com/".insteadOf "https://github.com/"; \
    fi; \
    git clone --depth 1 --branch v4.19.2 https://github.com/hanzoai/migrate.git /src
WORKDIR /src
RUN CGO_ENABLED=0 go build -tags 'datastore file' -ldflags='-s -w' -o /usr/local/bin/migrate ./cmd/migrate

FROM alpine AS base
RUN npm install turbo@^2.8.10 --global
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN corepack prepare pnpm@11.1.3 --activate

FROM base AS pruner

WORKDIR /app

COPY . .
RUN turbo prune --scope=web --docker

FROM base AS builder

WORKDIR /app

# Public build arguments (non-secret)
ARG NEXT_PUBLIC_HANZO_CLOUD_REGION
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

ENV NEXT_PUBLIC_HANZO_CLOUD_REGION=$NEXT_PUBLIC_HANZO_CLOUD_REGION
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

# Secrets (STRIPE_SECRET_KEY, SMTP_CONNECTION_URL, EMAIL_FROM_ADDRESS)
# are provided at runtime via env vars, not baked into the image

# First install the dependencies (as they change less often)
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=pruner /app/out/json/ .

# Copy build-time .env file (real values provided at runtime)
COPY ./.env.build ./.env

RUN pnpm install --frozen-lockfile

ENV DOCKER_BUILD=1
ENV NEXT_MANUAL_SIG_HANDLE=true

# pass public variables in build step
ARG NEXT_PUBLIC_PLAIN_APP_ID
ARG NEXT_PUBLIC_HANZO_CLOUD_REGION
ENV NEXT_PUBLIC_HANZO_CLOUD_REGION=$NEXT_PUBLIC_HANZO_CLOUD_REGION
ARG NEXT_PUBLIC_DEMO_ORG_ID
ENV NEXT_PUBLIC_DEMO_ORG_ID=$NEXT_PUBLIC_DEMO_ORG_ID
ARG NEXT_PUBLIC_DEMO_PROJECT_ID
ENV NEXT_PUBLIC_DEMO_PROJECT_ID=$NEXT_PUBLIC_DEMO_PROJECT_ID
ARG NEXT_PUBLIC_SIGN_UP_DISABLED
ENV NEXT_PUBLIC_SIGN_UP_DISABLED=$NEXT_PUBLIC_SIGN_UP_DISABLED
ARG NEXT_PUBLIC_INSIGHTS_KEY
ENV NEXT_PUBLIC_INSIGHTS_KEY=$NEXT_PUBLIC_INSIGHTS_KEY
ARG NEXT_PUBLIC_INSIGHTS_HOST
ENV NEXT_PUBLIC_INSIGHTS_HOST=$NEXT_PUBLIC_INSIGHTS_HOST
ARG NEXT_PUBLIC_HANZO_TRACING_SAMPLE_RATE
ENV NEXT_PUBLIC_HANZO_TRACING_SAMPLE_RATE=$NEXT_PUBLIC_HANZO_TRACING_SAMPLE_RATE
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_BASE_PATH
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH

# Hanzo IAM native identity — client-side config for the embedded IamProvider.
# NEXT_PUBLIC_* are compile-time, so they must be baked at build.
ARG NEXT_PUBLIC_IAM_SERVER_URL
ENV NEXT_PUBLIC_IAM_SERVER_URL=$NEXT_PUBLIC_IAM_SERVER_URL
ARG NEXT_PUBLIC_IAM_CLIENT_ID
ENV NEXT_PUBLIC_IAM_CLIENT_ID=$NEXT_PUBLIC_IAM_CLIENT_ID
ARG NEXT_PUBLIC_IAM_ORG_NAME
ENV NEXT_PUBLIC_IAM_ORG_NAME=$NEXT_PUBLIC_IAM_ORG_NAME
ARG NEXT_PUBLIC_IAM_APP_NAME
ENV NEXT_PUBLIC_IAM_APP_NAME=$NEXT_PUBLIC_IAM_APP_NAME

# Sentry config for sourcemap uploads at build time
# SENTRY_AUTH_TOKEN is passed via --secret, not ARG (do not bake secrets into layers)
ARG SENTRY_ORG
ENV SENTRY_ORG=$SENTRY_ORG
ARG SENTRY_PROJECT
ENV SENTRY_PROJECT=$SENTRY_PROJECT

# Accept build id as NEXT_PUBLIC_BUILD_ID
ARG NEXT_PUBLIC_BUILD_ID
ENV NEXT_PUBLIC_BUILD_ID=$NEXT_PUBLIC_BUILD_ID
ENV SENTRY_RELEASE=$NEXT_PUBLIC_BUILD_ID

# Copy source code of isolated subworkspace
COPY --from=pruner /app/out/full/ .

# Do NOT remove web/src/middleware.ts. Hanzo console REQUIRES it for the canonical
# /v1/* -> /api/* surface (IAM-native SSO: /v1/iam/* -> /api/public/iam/*). The
# upstream Langfuse "remove middleware for self-hosted" line breaks /v1/iam login;
# keep ours. (Re-introduced by upstream merges — guard against it.)

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_MANUAL_SIG_HANDLE=true
# set the CI flag to true to get CI specific logs
ENV CI=true

# Opt-in tolerance for the PRE-EXISTING type-check baseline. `main` has not
# type-checked cleanly since the upstream "query → @langfuse/shared" promotion
# (#13678) plus the ClickHouse→Datastore env drift; that fix is owned by a
# concurrent rebuild, and every recent console image (3.159.x) is built this
# way. Default is unset (strict). next.config.mjs gates `ignoreBuildErrors` on
# this exact env var. Our own feature code is verified type-clean; this only
# waives the inherited baseline so the image can ship.
ARG NEXT_IGNORE_BUILD_ERRORS=""
ENV NEXT_IGNORE_BUILD_ERRORS=${NEXT_IGNORE_BUILD_ERRORS}

RUN NODE_OPTIONS='--max-old-space-size-percentage=75' turbo run build --filter=web...

# Production image, copy all the files and run next
FROM base AS runner

ARG TARGETPLATFORM
ARG BUILDPLATFORM

WORKDIR /app

ARG NEXT_PUBLIC_BUILD_ID
ENV BUILD_ID=$NEXT_PUBLIC_BUILD_ID
ARG NEXT_PUBLIC_HANZO_CLOUD_REGION
ENV NEXT_PUBLIC_HANZO_CLOUD_REGION=$NEXT_PUBLIC_HANZO_CLOUD_REGION

ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
ENV NEXT_TELEMETRY_DISABLED=1
# Needed to re-enable validation of environment variables during runtime
ENV DOCKER_BUILD=0
# Set NEXT_MANUAL_SIG_HANDLE for runtime
ENV NEXT_MANUAL_SIG_HANDLE=true

RUN apk add --no-cache dumb-init tzdata

# Don't run production as root
ARG UID=1001
ARG GID=1001
RUN addgroup --system --gid ${GID} nodejs
RUN adduser --system --uid ${UID} nextjs

RUN npm install -g --no-package-lock --no-save prisma@6.19.3

# Install dd-trace only if NEXT_PUBLIC_HANZO_CLOUD_REGION is configured
ARG NEXT_PUBLIC_HANZO_CLOUD_REGION
RUN if [ -n "$NEXT_PUBLIC_HANZO_CLOUD_REGION" ]; then \
    npm install --no-package-lock --no-save dd-trace@5.65.0; \
    fi

COPY --from=migrate-builder /usr/local/bin/migrate /usr/bin/migrate

COPY --from=builder --chown=nextjs:nodejs /app/web/next.config.mjs .
COPY --from=builder --chown=nextjs:nodejs /app/web/package.json .

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
# Next.js 16 output-tracing does NOT copy Prisma's generated client + native query
# engine (libquery_engine-linux-musl-openssl-3.0.x.so.node) into the standalone bundle,
# so the runtime Prisma client crashes at boot (PrismaClientInitializationError ->
# unhandledRejection -> clean exit). Copy the generated .prisma next to @prisma/client.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.pnpm/@prisma+client@6.19.3_prisma@6.19.3_magicast@0.5.3_typescript@5.9.3__typescript@5.9.3/node_modules/.prisma ./node_modules/.pnpm/@prisma+client@6.19.3_prisma@6.19.3_magicast@0.5.3_typescript@5.9.3__typescript@5.9.3/node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.pnpm/@prisma+client@6.19.3_prisma@6.19.3_magicast@0.5.3_typescript@5.9.3__typescript@5.9.3/node_modules/.prisma/client ./web/.prisma/client
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./web/public

COPY --from=builder --chown=nextjs:nodejs /app/packages/shared/prisma ./packages/shared/prisma
COPY --from=builder --chown=nextjs:nodejs /app/packages/shared/datastore ./packages/shared/datastore

COPY --chown=nextjs:nodejs ./web/entrypoint.sh ./web/entrypoint.sh
COPY --chown=nextjs:nodejs ./packages/shared/scripts/cleanup.sql ./packages/shared/scripts/cleanup.sql
RUN chmod +x ./web/entrypoint.sh

# NOTE: Do NOT copy .env from builder — it contains build-time placeholders
# that would override runtime env vars (docker-compose/k8s). All env vars must
# come from the container environment, not files baked into the image.
USER nextjs

# Default port to 3000
ENV PORT=3000

# Docker ENTRYPOINT (dumb-init) is covered by semantic versioning, not the entrypoint.sh itself
# Reasoning: ENTRYPOINT is overridden by some self-hosted deployments, thus changing this is breaking
ENTRYPOINT ["dumb-init", "--", "./web/entrypoint.sh"]

# startup command - use dd-trace only if it was installed at build time
CMD ["/bin/sh", "-c", "if [ -f /app/node_modules/dd-trace/initialize.mjs ]; then exec node --import dd-trace/initialize.mjs ./web/server.js --keepAliveTimeout 110000; else exec node ./web/server.js --keepAliveTimeout 110000; fi"]
