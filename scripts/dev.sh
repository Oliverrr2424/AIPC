#!/usr/bin/env bash
# One-command dev startup: bring up the local Postgres (pgvector) container,
# apply migrations, seed when empty, then launch the Next.js dev server.
#
# Everything DB-related is best-effort: if Docker is missing or the database
# never becomes ready, we still start Next.js. The app degrades gracefully to
# the in-memory seed JSON (benchmarks, market signals) and keyword retrieval.
set -uo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgresql://aipc:aipc@localhost:5432/aipc?schema=public}"

log()  { printf "\033[36m[dev]\033[0m %s\n" "$1"; }
warn() { printf "\033[33m[dev]\033[0m %s\n" "$1"; }

# Only manage Docker when the database lives on localhost.
is_local_pg() {
  [[ "$DATABASE_URL" == *"@localhost:"* || "$DATABASE_URL" == *"@127.0.0.1:"* ]]
}

start_db() {
  if ! is_local_pg; then
    log "DATABASE_URL points to a remote host; skipping local Docker startup."
    return 1
  fi
  if ! command -v docker >/dev/null 2>&1; then
    warn "Docker not found — starting in degraded mode (seed-data fallbacks)."
    warn "Install Docker, or run 'npm run db:up' later for live data."
    return 1
  fi
  if ! docker info >/dev/null 2>&1; then
    warn "Docker daemon not running — starting in degraded mode."
    warn "Start Docker Desktop, then 'npm run db:up' for live data."
    return 1
  fi

  log "Starting Postgres (pgvector) container..."
  if ! docker compose up -d db >/dev/null 2>&1; then
    warn "Failed to start the db container — continuing in degraded mode."
    return 1
  fi

  log "Waiting for the database to accept connections..."
  for _ in $(seq 1 30); do
    if docker compose exec -T db pg_isready -U aipc -d aipc >/dev/null 2>&1; then
      log "Database is ready."
      return 0
    fi
    sleep 1
  done
  warn "Database did not become ready in time — continuing in degraded mode."
  return 1
}

prepare_db() {
  npx prisma generate >/dev/null 2>&1 || warn "prisma generate failed."

  log "Applying Prisma migrations..."
  if ! npx prisma migrate deploy >/dev/null 2>&1; then
    warn "Prisma migrate failed — continuing with seed-data fallbacks."
    return
  fi

  # Seed canonical parts + baseline prices when the catalog is empty.
  local count
  count="$(docker compose exec -T db psql -U aipc -d aipc -tAc 'SELECT count(*) FROM "Part";' 2>/dev/null | tr -d '[:space:]')"
  if [[ "$count" == "0" ]]; then
    log "Empty database detected — seeding catalog (one-time)..."
    npm run db:seed || warn "Seed incomplete."
    if [[ "${SKIP_RAG_INDEX:-}" == "1" ]]; then
      warn "SKIP_RAG_INDEX=1 set — skipping knowledge embedding index (RAG uses keyword retrieval)."
    else
      log "Indexing knowledge base for vector retrieval (network embedding; can take a minute)..."
      npm run rag:index || warn "Knowledge index incomplete — RAG falls back to keyword retrieval."
    fi
  else
    log "Catalog already populated (${count} parts)."
  fi
}

if start_db; then
  prepare_db
fi

log "Starting Next.js dev server..."
exec npx next dev --turbo
