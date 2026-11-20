# Argus. Run `make` for the list of targets.

.DEFAULT_GOAL := help
COMPOSE := docker compose

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

env: ## Create .env with random secrets (if it doesn't exist)
	@test -f .env && echo ".env already exists" || { \
		cp .env.example .env; \
		sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')|" .env; \
		sed -i "s|^ARGUS_SECRET_KEY=.*|ARGUS_SECRET_KEY=$$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')|" .env; \
		chmod 600 .env; echo "Wrote .env"; }

up: env ## Build and start the stack
	$(COMPOSE) up -d --build

down: ## Stop the stack (data stays)
	$(COMPOSE) down

logs: ## Follow the API and worker logs
	$(COMPOSE) logs -f api worker

token: ## Show the first-run setup token
	@$(COMPOSE) logs api | grep "setup token" | tail -1

status: ## Show containers and their health
	$(COMPOSE) ps

install: ## Install backend, frontend and docs dependencies
	cd backend && uv sync
	cd frontend && npm install
	cd docs-site && npm install

dev-api: ## API with reload on :8000 (needs the db and nats containers)
	cd backend && ARGUS_COOKIE_SECURE=false uv run uvicorn argus.main:app --reload

dev-web: ## Vite dev server on :5173 (proxies /api and /ws to :8000)
	cd frontend && npm run dev

docs-dev: ## Docs with live reload
	cd docs-site && npm start

test: ## Backend tests
	cd backend && uv run pytest -q

lint: ## ruff, format check and the TypeScript check
	cd backend && uv run ruff check . && uv run ruff format --check .
	cd frontend && npm run typecheck

streetmap: ## Download the street map: REGION=southeast|conus|planet, or BBOX=W,S,E,N
	scripts/streetmap.sh $(if $(BBOX),custom $(BBOX),$(REGION))
	$(COMPOSE) up -d tiles
	$(COMPOSE) restart tiles

update: ## Pull the latest code, back up, rebuild (scripts/update.sh)
	scripts/update.sh

backup: ## Back up the database and .env to backups/ (scripts/backup.sh)
	scripts/backup.sh

restore: ## Restore a backup: make restore FILE=backups/argus-....tar.gz
	@test -n "$(FILE)" || { echo "Usage: make restore FILE=backups/argus-....tar.gz"; exit 1; }
	scripts/restore.sh $(FILE)

release: ## Bump the version, commit and tag: make release VERSION=1.2.0
	@test -n "$(VERSION)" || { echo "Usage: make release VERSION=X.Y.Z"; exit 1; }
	scripts/release.sh $(VERSION)

ci: ## Everything CI runs, locally (scripts/ci.sh)
	scripts/ci.sh

ci-quick: ## CI without the migration job, reusing node_modules
	scripts/ci.sh --quick

.PHONY: help env up down logs token status install dev-api dev-web docs-dev test lint streetmap update backup restore release ci ci-quick
