# Dev container Dockerfile
FROM --platform=${BUILDPLATFORM} golang:1.24 AS migrate-builder
ARG TARGETOS
ARG TARGETARCH
ENV CGO_ENABLED=0 \
    GOBIN=/out \
    GOOS=${TARGETOS} \
    GOARCH=${TARGETARCH}
# Build the Hanzo Datastore migrate CLI from the hanzoai/migrate fork, which
# provides the `datastore` build tag + `datastore://` URL scheme.
RUN git clone --depth 1 --branch v4.19.2 https://github.com/hanzoai/migrate.git /src && \
    cd /src && \
    /usr/local/go/bin/go build -trimpath -tags 'datastore file' -ldflags='-s -w' -o /out/migrate ./cmd/migrate

FROM mcr.microsoft.com/devcontainers/universal:2

# Hanzo Datastore migrate binary (built above with `datastore` driver only).
COPY --from=migrate-builder /out/migrate /usr/local/bin/migrate

# Activate the repo's pinned pnpm via Corepack
RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

# NOTE: the Datastore server itself is NOT installed in the dev container.
# Use docker-compose.dev.yml to bring up `ghcr.io/hanzoai/datastore` on port 8123.
# The `migrate` binary above is all the dev container needs to apply schema.

# Install agent CLIs used in this repo
RUN npm install -g @anthropic-ai/claude-code @openai/codex
