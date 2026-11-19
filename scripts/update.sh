#!/usr/bin/env bash
# Update this Argus to the latest code and rebuild it, keeping its data.
#
#   scripts/update.sh [--no-backup] [--project NAME]
#
# 1. Refuses if this checkout has uncommitted changes to tracked files
#    (they'd block or be mixed into the update).
# 2. Makes a backup first (scripts/backup.sh), unless --no-backup.
# 3. git pull --ff-only, then docker compose up -d --build. The API
#    applies any new database migrations as it starts.
# 4. Waits for the API to report healthy.
set -euo pipefail
cd "$(dirname "$0")/.."

backup=1
project=${COMPOSE_PROJECT_NAME:-}
while [ $# -gt 0 ]; do
  case "$1" in
    --no-backup) backup=0 ;;
    --project|-p) project=$2; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done
compose=(docker compose)
[ -n "$project" ] && compose+=(-p "$project")

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "This checkout has local changes to Argus's files; commit or discard them first:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

branch=$(git rev-parse --abbrev-ref HEAD)
git fetch --quiet origin "$branch"
behind=$(git rev-list --count "HEAD..origin/$branch")
if [ "$behind" = 0 ]; then
  echo "Already up to date ($(git log -1 --format='%h %s'))."
  exit 0
fi
echo "$behind new commit(s) on $branch:"
git log --oneline "HEAD..origin/$branch" | head -20

if [ "$backup" = 1 ]; then
  if "${compose[@]}" exec -T db pg_isready -U argus -d argus >/dev/null 2>&1; then
    args=()
    [ -n "$project" ] && args+=(--project "$project")
    scripts/backup.sh "${args[@]}"
  else
    echo "The database isn't running, so no backup first."
  fi
fi

git pull --ff-only --quiet origin "$branch"
echo "Rebuilding..."
"${compose[@]}" up -d --build

port=$(sed -n 's/^ARGUS_HTTP_PORT=//p' .env 2>/dev/null | tail -1)
port=${port:-8080}
for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$port/api/health"; then
    echo "Updated to $(git log -1 --format='%h %s') and running."
    exit 0
  fi
  sleep 2
done
echo "Updated, but the API isn't answering yet: check 'make logs'." >&2
exit 1
