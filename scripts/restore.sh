#!/usr/bin/env bash
# Restore an Argus backup made by scripts/backup.sh, here or on a new
# server. Replaces the whole database.
#
#   scripts/restore.sh [--yes] [--project NAME] BACKUP.tar.gz
#
# - No .env here yet (a new server): the archive's .env is used, then the
#   stack is started with it.
# - An .env here already: it's kept (its database password belongs to
#   this server's database), except ARGUS_SECRET_KEY, which is taken from
#   the archive so stored data-source keys still decrypt. The old .env is
#   saved as .env.before-restore.
# The API brings the schema up to date when it starts.
set -euo pipefail
cd "$(dirname "$0")/.."

yes=0
project=${COMPOSE_PROJECT_NAME:-}
file=
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) yes=1 ;;
    --project|-p) project=$2; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) file=$1 ;;
  esac
  shift
done
[ -n "$file" ] && [ -f "$file" ] || { echo "Usage: scripts/restore.sh [--yes] BACKUP.tar.gz" >&2; exit 1; }
compose=(docker compose)
[ -n "$project" ] && compose+=(-p "$project")

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
tar -C "$work" -xzf "$file"
dir=$(find "$work" -mindepth 1 -maxdepth 1 -type d | head -1)
[ -f "$dir/argus.dump" ] && [ -f "$dir/manifest.json" ] || { echo "That isn't an Argus backup." >&2; exit 1; }
echo "Backup:"; sed 's/^/  /' "$dir/manifest.json"

if [ "$yes" != 1 ]; then
  read -r -p "This replaces ALL data in this Argus (${project:-$(basename "$PWD")}). Type 'restore' to go on: " answer
  [ "$answer" = restore ] || { echo "Stopped; nothing changed."; exit 1; }
fi

if [ ! -f .env ]; then
  if [ -f "$dir/env" ]; then
    install -m 600 "$dir/env" .env
    echo "Using the backup's .env (a new server)."
  else
    echo "No .env here and none in the backup: run 'make env' first." >&2
    exit 1
  fi
elif [ -f "$dir/env" ]; then
  old=$(sed -n 's/^ARGUS_SECRET_KEY=//p' .env)
  new=$(sed -n 's/^ARGUS_SECRET_KEY=//p' "$dir/env")
  if [ -n "$new" ] && [ "$old" != "$new" ]; then
    cp -p .env .env.before-restore
    tmp=$(mktemp)
    awk -v key="$new" 'BEGIN{done=0} /^ARGUS_SECRET_KEY=/{print "ARGUS_SECRET_KEY=" key; done=1; next} {print} END{if(!done) print "ARGUS_SECRET_KEY=" key}' .env >"$tmp"
    install -m 600 "$tmp" .env
    rm -f "$tmp"
    echo "Took ARGUS_SECRET_KEY from the backup (old .env saved as .env.before-restore)."
  fi
else
  echo "The backup has no .env: stored data-source keys only decrypt if this server's ARGUS_SECRET_KEY matches the old one."
fi

echo "Starting the database..."
"${compose[@]}" up -d db >/dev/null
for _ in $(seq 1 60); do
  "${compose[@]}" exec -T db pg_isready -U argus -d postgres >/dev/null 2>&1 && break
  sleep 2
done
"${compose[@]}" stop api worker >/dev/null 2>&1 || true

echo "Replacing the database..."
"${compose[@]}" exec -T db psql -U argus -d postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS argus WITH (FORCE)" -c "CREATE DATABASE argus OWNER argus"
"${compose[@]}" exec -T db pg_restore -U argus -d argus --no-owner --exit-on-error <"$dir/argus.dump"

echo "Starting Argus..."
"${compose[@]}" up -d --build >/dev/null
echo "Restored. Sign in with the accounts from the backup."
