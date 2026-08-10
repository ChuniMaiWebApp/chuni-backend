#!/usr/bin/env bash
# =============================================================================
# Deploys the API on the VPS.
#
#   ./scripts/deploy.sh              # normal deploy
#   ./scripts/deploy.sh --first-run  # `pm2 start` instead of reload
#
# GitHub Actions calls this over SSH. Keeping the steps in the repository
# rather than inline in the workflow means a deploy can be run by hand in
# exactly the same way when CI is unavailable — and that the two cannot drift.
#
# On a failed health check it puts the previous commit back and rebuilds.
# Migrations are not reverted: they are additive by construction, so the
# previous build runs fine against the newer schema.
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FIRST_RUN=false
[ "${1:-}" = "--first-run" ] && FIRST_RUN=true

HEALTH="http://127.0.0.1:3333/api/v1/health"

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; }

preflight() {
  [ -f .env ] || { fail ".env is missing. Copy .env.production.example."; exit 1; }

  # The data services belong to chunimai-database. If Postgres is not up, the
  # migration step would fail halfway through a deploy instead of before it.
  if ! timeout 3 bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/5432' 2>/dev/null; then
    fail "Nothing is listening on 127.0.0.1:5432."
    fail "Start it from the database repo:"
    fail "  cd ../chunimai-database && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d"
    exit 1
  fi

  if ! timeout 3 bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/6379' 2>/dev/null; then
    fail "Nothing is listening on 127.0.0.1:6379 — Redis holds the sign-in throttle."
    exit 1
  fi
}

build_and_reload() {
  log "Installing dependencies"
  # `npm ci` rather than `npm install`: it installs exactly the committed
  # lockfile, so a deploy cannot pick up a different transitive version than
  # the one CI just tested.
  npm ci

  log "Building"
  npm run build

  log "Applying database migrations"
  npm run migrate

  if [ "$FIRST_RUN" = true ]; then
    log "Starting PM2 process"
    pm2 start ecosystem.config.js
    pm2 save
  else
    log "Reloading PM2 process"
    pm2 startOrReload ecosystem.config.js --update-env
  fi
}

# Polls until the API answers, or gives up. Without this the deploy reports
# success as soon as PM2 accepts the reload — which it does even for a process
# that crashes a second later on a bad env var.
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

rollback() {
  local previous="$1"

  fail "Rolling back to $previous"
  git reset --hard "$previous"
  npm ci
  npm run build
  pm2 startOrReload ecosystem.config.js --update-env

  if health_check; then
    fail "Rolled back to $previous. The new commit is broken — do not redeploy it unchanged."
    exit 1
  fi

  fail "ROLLBACK ALSO FAILED. The API is down. Check: pm2 logs chuni-backend --lines 100"
  exit 2
}

log "===== API DEPLOY $(date -u +%Y-%m-%dT%H:%M:%SZ) ====="

preflight

PREVIOUS_SHA=$(git rev-parse HEAD)
log "Current commit: $PREVIOUS_SHA"

log "Fetching latest code"
# Whatever branch the checkout is on. Hardcoding `main` breaks silently on a
# repo whose default is still `master`: the fetch succeeds, the reset fails,
# and `set -e` aborts the deploy with a message about an unknown revision.
BRANCH="${DEPLOY_BRANCH:-$(git symbolic-ref --short HEAD)}"
git fetch --prune origin
git reset --hard "origin/$BRANCH"
log "Deploying commit: $(git rev-parse HEAD) on $BRANCH"

build_and_reload

if health_check; then
  log "===== API DEPLOY OK — $(git rev-parse HEAD) ====="
  pm2 save
  exit 0
fi

rollback "$PREVIOUS_SHA"
