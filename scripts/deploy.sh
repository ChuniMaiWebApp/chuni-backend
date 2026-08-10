#!/usr/bin/env bash
# =============================================================================
# Deploys the API on the VPS.
#
#   ./scripts/deploy.sh
#
# GitHub Actions calls this over SSH. Keeping the steps in the repository
# rather than inline in the workflow means a deploy can be run by hand in
# exactly the same way when CI is unavailable — and that the two cannot drift.
#
# On a failed health check it puts the previous image back. Migrations are not
# reverted: they are additive by construction, so the previous build runs fine
# against the newer schema.
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HEALTH="http://127.0.0.1:3333/api/v1/health"
ROLLBACK_TAG="chunimai/api:rollback"

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; }

preflight() {
  [ -f .env ] || { fail ".env is missing. Copy .env.production.example."; exit 1; }

  if ! docker network inspect chunimai >/dev/null 2>&1; then
    fail "The 'chunimai' network does not exist. Create it once:"
    fail "  docker network create chunimai"
    exit 1
  fi

  # The data services belong to chunimai-database. Without them the migration
  # step would fail halfway through a deploy rather than before it starts.
  if ! docker ps --format '{{.Names}}' | grep -q '^chunimai-postgres$'; then
    fail "chunimai-postgres is not running. Start it from the database repo:"
    fail "  cd ../chunimai-database && ./scripts/deploy.sh"
    exit 1
  fi
}

log "===== API DEPLOY $(date -u +%Y-%m-%dT%H:%M:%SZ) ====="

preflight

log "Fetching latest code"
# Whatever branch the checkout is on. Hardcoding `main` breaks silently on a
# repo whose default is still `master`.
BRANCH="${DEPLOY_BRANCH:-$(git symbolic-ref --short HEAD)}"
git fetch --prune origin
git reset --hard "origin/$BRANCH"
log "Deploying commit: $(git rev-parse --short HEAD) on $BRANCH"

# Keep the image that is currently serving, so a failed health check has
# something to go back to that does not require rebuilding from source.
if docker image inspect chunimai/api:latest >/dev/null 2>&1; then
  docker tag chunimai/api:latest "$ROLLBACK_TAG"
  HAVE_ROLLBACK=true
else
  HAVE_ROLLBACK=false
fi

log "Building image"
docker compose build

log "Applying database migrations"
# Runs against the *new* code before the new container takes over, so the
# schema is never behind the process reading it.
docker compose run --rm migrate

log "Starting container"
docker compose up -d

# Polls until the API answers. Without this the deploy reports success as soon
# as compose accepts the container — which it does even for a process that
# crashes a second later on a bad env var.
health_check() {
  log "Health check"

  for attempt in $(seq 1 20); do
    sleep 3

    body=$(curl -fsS --max-time 5 "$HEALTH" 2>/dev/null || true)

    if [ -n "$body" ]; then
      status=$(printf '%s' "$body" | jq -r '.status' 2>/dev/null || echo unknown)
      deps=$(printf '%s' "$body" | jq -c '.dependencies' 2>/dev/null || echo '{}')

      # "degraded" means the API answers but Postgres or Redis does not.
      # Serving that to players is worse than rolling back.
      if [ "$status" = "ok" ]; then
        echo "  api: ok $deps"
        return 0
      fi

      fail "API is up but degraded: $deps"
      return 1
    fi

    echo "  attempt $attempt/20 — no answer yet"
  done

  fail "API did not become healthy within 60s."
  return 1
}

if health_check; then
  log "===== API DEPLOY OK — $(git rev-parse --short HEAD) ====="
  docker image prune -f >/dev/null 2>&1 || true
  exit 0
fi

fail "Deploy failed. Container logs:"
docker compose logs --tail 40 api || true

if [ "$HAVE_ROLLBACK" = true ]; then
  fail "Rolling back to the previous image"
  docker tag "$ROLLBACK_TAG" chunimai/api:latest
  docker compose up -d --no-build

  if health_check; then
    fail "Rolled back. The new commit is broken — do not redeploy it unchanged."
    exit 1
  fi

  fail "ROLLBACK ALSO FAILED. Check: docker compose logs api"
  exit 2
fi

fail "No previous image to roll back to (first deploy)."
exit 1
