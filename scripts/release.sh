#!/usr/bin/env bash
# Cut a release: bump the version everywhere, commit and tag it.
#
#   scripts/release.sh 1.2.0        (or: make release VERSION=1.2.0)
#
# Needs a clean checkout of main and a "## [1.2.0]" section at the top of
# CHANGELOG.md. Sets the version in the backend (argus/__init__.py,
# pyproject.toml, uv.lock), the frontend and the docs (package.json and
# package-lock.json), commits "chore(release): v1.2.0" and makes an
# annotated tag v1.2.0. Pushing is up to you:
#
#   git push origin main v1.2.0
set -euo pipefail
cd "$(dirname "$0")/.."

version=${1:-}
if ! [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: scripts/release.sh X.Y.Z" >&2
  exit 1
fi
if [ "$(git rev-parse --abbrev-ref HEAD)" != main ]; then
  echo "Releases are cut from main." >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Commit or discard your changes first." >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
  echo "v$version is already tagged." >&2
  exit 1
fi
if ! grep -q "^## \[$version\]" CHANGELOG.md; then
  echo "Add a \"## [$version]\" section to CHANGELOG.md first." >&2
  exit 1
fi

python3 - "$version" <<'PY'
import json
import re
import sys

v = sys.argv[1]


def sub(path, pattern, repl):
    text = open(path, encoding="utf-8").read()
    new, n = re.subn(pattern, repl, text, count=1, flags=re.M)
    if n != 1:
        sys.exit("version not found in {0}".format(path))
    open(path, "w", encoding="utf-8").write(new)


sub("backend/argus/__init__.py", r'^__version__ = "[^"]*"',
    '__version__ = "{0}"'.format(v))
sub("backend/pyproject.toml", r'^version = "[^"]*"',
    'version = "{0}"'.format(v))
sub("backend/uv.lock", r'(^name = "argus"\nversion = )"[^"]*"',
    '\\g<1>"{0}"'.format(v))
for d in ("frontend", "docs-site"):
    path = "{0}/package.json".format(d)
    sub(path, r'^  "version": "[^"]*"', '  "version": "{0}"'.format(v))
    lock_path = "{0}/package-lock.json".format(d)
    lock = json.load(open(lock_path, encoding="utf-8"))
    lock["version"] = v
    lock["packages"][""]["version"] = v
    with open(lock_path, "w", encoding="utf-8") as f:
        json.dump(lock, f, indent=2, ensure_ascii=False)
        f.write("\n")
PY

git add backend/argus/__init__.py backend/pyproject.toml backend/uv.lock \
  frontend/package.json frontend/package-lock.json \
  docs-site/package.json docs-site/package-lock.json
git commit -q -m "chore(release): v$version"
git tag -a "v$version" -m "Argus $version"
echo "Tagged v$version. Push it with: git push origin main v$version"
