#!/usr/bin/env bash
# Run the same checks as .github/workflows/ci.yml, locally.
#
#   scripts/ci.sh           everything (needs Docker for the migration job)
#   scripts/ci.sh --quick   skip migrations and reuse installed node_modules
#
# Exits non-zero on the first failure.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QUICK=0
[[ "${1:-}" == "--quick" ]] && QUICK=1

step() { printf '\n\033[1;34m== %s\033[0m\n' "$1"; }

step "backend: ruff, format, pytest"
cd "$ROOT/backend"
uv sync --frozen --python 3.12 -q
uv run ruff check .
uv run ruff format --check .
uv run pytest -q

if [[ $QUICK -eq 0 ]]; then
  step "migrations: upgrade, check, downgrade on a throwaway PostgreSQL"
  NAME="argus-ci-db-$$"
  docker run -d --rm --name "$NAME" -e POSTGRES_USER=argus \
    -e POSTGRES_PASSWORD=argus -e POSTGRES_DB=argus -p 127.0.0.1::5432 \
    timescale/timescaledb-ha:pg17 >/dev/null
  trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
  PORT="$(docker port "$NAME" 5432/tcp | head -1 | sed 's/.*://')"
  # The image runs a temporary server while it initialises, then
  # restarts: wait until it has answered five times in a row, through
  # the published port, a second apart.
  ok=0
  for _ in $(seq 1 120); do
    if docker exec "$NAME" psql -h 127.0.0.1 -U argus -d argus -c 'select 1' >/dev/null 2>&1; then
      ok=$((ok + 1))
      [[ $ok -ge 5 ]] && break
    else
      ok=0
    fi
    sleep 1
  done
  export ARGUS_DATABASE_URL="postgresql+asyncpg://argus:argus@127.0.0.1:${PORT}/argus"
  uv run alembic upgrade head
  uv run alembic check
  uv run alembic downgrade base
  unset ARGUS_DATABASE_URL
fi

install() {
  if [[ $QUICK -eq 1 && -d node_modules ]]; then return; fi
  npm ci --no-audit --no-fund --loglevel=error
}

step "frontend: format, typecheck and build"
cd "$ROOT/frontend"
install
npm run format:check --silent
npm run build --silent

step "docs: build"
cd "$ROOT/docs-site"
install
npm run build --silent >/dev/null

printf '\n\033[1;32mAll CI checks passed.\033[0m\n'
