#!/usr/bin/env bash
# Back up an Argus server: a full database dump, its .env (the secret key
# that decrypts stored data-source keys, and the other settings) and a
# manifest, in one archive.
#
#   scripts/backup.sh [--no-env] [--project NAME] [OUT_DIR]
#
# OUT_DIR defaults to ./backups. The archive holds secrets (the database
# and, unless --no-env, .env): it is written with mode 600; keep it safe.
# Restore it with scripts/restore.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

with_env=1
project=${COMPOSE_PROJECT_NAME:-}
out=backups
while [ $# -gt 0 ]; do
  case "$1" in
    --no-env) with_env=0 ;;
    --project|-p) project=$2; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) out=$1 ;;
  esac
  shift
done
compose=(docker compose)
[ -n "$project" ] && compose+=(-p "$project")

if ! "${compose[@]}" exec -T db pg_isready -U argus -d argus >/dev/null 2>&1; then
  echo "The database isn't running. Start Argus first (make up)." >&2
  exit 1
fi

stamp=$(date -u +%Y%m%d-%H%M%S)
name="argus-${project:-$(basename "$PWD")}-$stamp"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/$name"

echo "Dumping the database..."
"${compose[@]}" exec -T db pg_dump -U argus -d argus -Fc >"$work/$name/argus.dump"

if [ "$with_env" = 1 ] && [ -f .env ]; then
  cp .env "$work/$name/env"
fi

revision=$("${compose[@]}" exec -T db psql -U argus -d argus -At \
  -c "select version_num from alembic_version" 2>/dev/null || echo unknown)
version=$(sed -n 's/^__version__ = "\(.*\)"/\1/p' backend/argus/__init__.py)
cat >"$work/$name/manifest.json" <<JSON
{
  "app": "argus",
  "version": "$version",
  "schema_revision": "$revision",
  "created_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "includes_env": $([ -f "$work/$name/env" ] && echo true || echo false),
  "database_bytes": $(stat -c %s "$work/$name/argus.dump")
}
JSON

mkdir -p "$out"
umask 077
tar -C "$work" -czf "$out/$name.tar.gz" "$name"
chmod 600 "$out/$name.tar.gz"
echo "Wrote $out/$name.tar.gz ($(du -h "$out/$name.tar.gz" | cut -f1))."
[ -f "$work/$name/env" ] && echo "It includes .env with its secrets: store it somewhere safe."
