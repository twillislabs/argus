---
title: Git workflow
sidebar_position: 3
---

# Git workflow

Every change to Argus follows these rules, whoever (or whatever) makes it.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
and the 50/72 rule:

```text
feat(map): add aircraft camera views

Selected aircraft get Follow, Chase, Orbit and Cockpit views. Between
reports the aircraft is dead-reckoned from its speed and track, so the
camera glides instead of jumping.
```

- **Subject:** `type(scope): summary`, 50 characters or fewer. The scope is
  optional. Write the summary in the imperative and lower case ("add",
  not "Added" or "adds"), with no full stop.
- **Blank line**, then a **body** wrapped at 72 columns that says what
  changed and why. Lists are fine. Skip the body only for trivial changes.
- **Types:**

| Type | For |
|---|---|
| `feat` | A new feature or capability |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `refactor` | Code changes that neither fix a bug nor add a feature |
| `perf` | Performance |
| `test` | Tests only |
| `build` | Dependencies, Dockerfiles, packaging |
| `ci` | GitHub Actions and `scripts/ci.sh` |
| `style` | Formatting with no code change |
| `chore` | Anything else (repo housekeeping) |

- A breaking change adds `!` after the type (`feat(api)!: ...`) and a
  `BREAKING CHANGE:` footer explaining the migration.
- **Authorship:** commits are authored by the person responsible for the
  change. No `Co-Authored-By` trailers for AI tools.

Check a message before committing:

```bash
git log -1 --format=%B | awk 'NR==1 && length > 50 {print "subject too long"} NR>2 && length > 72 {print "line " NR " too long"}'
```

## One change per commit

Keep each commit to one logical change that builds and passes CI on its
own: don't mix a refactor, a fix and a feature. Split unrelated changes
with `git add -p`.

## Branches and pull requests

- Work on a branch named `type/short-description`, for example
  `feat/aircraft-camera-views` or `fix/docs-redirect-port`.
- Open a pull request into `main`. Its title follows the commit format and
  its description says what changed, why, and how it was tested (including
  screenshots for UI changes).
- CI must be green, and the change reviewed, before it merges. Rebase on
  `main` rather than merging `main` into your branch.

During initial development the maintainer commits straight to `main`. That
ends with the first tagged release; from then on everything goes through a
pull request.

## Before every commit

```bash
make ci
```

This runs exactly what GitHub Actions runs: ruff and the format check,
pytest, the migration check against PostgreSQL, the TypeScript build and
the docs build. After pushing, watch the run until it's green.

Also:

- **Update the docs in the same commit.** User-facing changes update
  `docs-site/docs/`; new modules, conventions or pitfalls update
  `CLAUDE.md`.
- **Never commit secrets or local material:** `.env`, `data/` (the street
  map download), `docs/PLAN.md` and `docs/mockup/` are ignored and stay
  that way.
- **Python** follows PEP 8 at 79 columns and uses `str.format()` for
  strings. **TypeScript** is strict.
