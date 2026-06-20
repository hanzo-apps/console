#!/bin/sh

# Remove build-time placeholder .env to prevent it from overriding runtime env vars.
# The Dockerfile copies .env.build as .env for the Next.js build step, but at runtime
# all env vars come from docker-compose/k8s environment variables.
rm -f .env 2>/dev/null || true

# Application database is SQLite (Hanzo Base). DATABASE_URL is a Prisma SQLite
# connection string ("file:<path>"). Default to a writable container path so a
# single-node deployment boots with no external database. Mount this path on a
# volume (or point it at a Base-managed shard) to persist data.
if [ -z "$DATABASE_URL" ]; then
    export DATABASE_URL="file:/var/lib/hanzo/console/app.db"
fi

# Ensure the parent directory for a local "file:" SQLite database exists.
case "$DATABASE_URL" in
    file:*)
        db_path="${DATABASE_URL#file:}"
        db_dir=$(dirname "$db_path")
        mkdir -p "$db_dir" 2>/dev/null || true
        ;;
esac

# Check if DATASTORE_URL is not set
if [ -z "$DATASTORE_URL" ]; then
    echo "Error: DATASTORE_URL is not configured. Set DATASTORE_URL in your environment variables."
    exit 1
fi

# Sync the SQLite schema on first boot (no migration history, no Postgres).
# `prisma db push` creates/updates tables to match schema.prisma and is the
# mandated startup path: no `prisma migrate deploy`, no shadow/direct database.
if [ "$HANZO_AUTO_DB_PUSH_DISABLED" != "true" ]; then
    prisma db push --schema=./packages/shared/prisma/schema.prisma --skip-generate --accept-data-loss
fi
status=$?

# If the schema sync fails (returns non-zero exit status), exit with that status.
if [ $status -ne 0 ]; then
    echo "Syncing the SQLite application schema failed. Common causes:"
    echo "  1. DATABASE_URL does not point at a writable SQLite path (\"file:<path>\")."
    echo "  2. The target directory is not writable by the container user."
    echo "Exiting..."
    exit $status
fi

# Execute the datastore migration, except when disabled.
if [ "$DATASTORE_AUTO_MIGRATION_DISABLED" != "true" ]; then
    # Retry datastore migrations with backoff.
    # The native protocol (port 9000) can lag behind the HTTP health check (8123),
    # causing "Authentication failed" on first attempt. Retry handles this race.
    ds_attempt=0
    ds_max_attempts=10
    status=1
    while [ "$ds_attempt" -lt "$ds_max_attempts" ] && [ "$status" -ne 0 ]; do
        ds_attempt=$((ds_attempt + 1))
        if [ "$ds_attempt" -gt 1 ]; then
            echo "Datastore migration attempt ${ds_attempt}/${ds_max_attempts} (retrying in 3s)..."
            sleep 3
        fi
        cd ./packages/shared
        sh ./datastore/scripts/up.sh
        status=$?
        cd ../../
    done
fi

# If migration fails (returns non-zero exit status), exit script with that status
if [ $status -ne 0 ]; then
    echo "Applying datastore migrations failed. This is mostly caused by the database being unavailable."
    echo "Exiting..."
    exit $status
fi

# Run the command passed to the docker image on start
exec "$@"
