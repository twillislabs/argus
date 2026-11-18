---
title: Local development
---

# Local development

## API

```bash
cd backend
uv sync
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

Run against the Compose database:

```bash
docker compose up -d db
ARGUS_DATABASE_URL=postgresql+asyncpg://argus:<password>@localhost:5432/argus \
ARGUS_COOKIE_SECURE=false \
  uv run sh -c "alembic upgrade head && uvicorn argus.main:app --reload"
```

## Web app

```bash
cd frontend
npm install
npm run dev    # http://localhost:5173, proxies /api to :8000
```

## Docs

```bash
cd docs-site
npm install
npm start
```

## Conventions

- Python: PEP 8, 79 columns, ruff, and `str.format()` for string formatting.
- TypeScript: strict mode.
- Commits: Conventional Commits, 50/72 messages, one topic per PR.
