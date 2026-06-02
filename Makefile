# AgentRoom — cross-platform developer tasks (POSIX / macOS / Linux / WSL).
# Thin wrappers over pnpm + the Supabase CLI. Windows users have the same flows via
# start-agentroom.bat / the desktop shortcut; see the README Quickstart and docs/SELF_HOSTING.md.

SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help bootstrap doctor install env supabase-start supabase-stop db-reset \
        dev dev-web dev-bridge typecheck lint format test e2e build \
        docker-build docker-up docker-down clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

bootstrap: ## One-command setup: prereqs -> env -> install -> supabase -> db reset
	@bash scripts/bootstrap.sh

doctor: ## Check required tooling (node>=22.13, pnpm, docker, supabase) only
	@bash scripts/bootstrap.sh --check-only

install: ## Install workspace dependencies (frozen lockfile)
	pnpm install --frozen-lockfile

env: ## Create env files from the examples if missing (never overwrites)
	@[ -f apps/web/.env.local ] || cp apps/web/.env.example apps/web/.env.local
	@[ -f bridge/.env ] || cp bridge/.env.example bridge/.env
	@echo "env files ready (apps/web/.env.local, bridge/.env) — fill in keys"

supabase-start: ## Start the local Supabase stack (Docker)
	supabase start

supabase-stop: ## Stop the local Supabase stack
	supabase stop

db-reset: ## Apply migrations + seed (DESTRUCTIVE: resets local DB)
	supabase db reset

dev: ## Run web + bridge together (host dev)
	pnpm dev

dev-web: ## Run only the Next.js web app
	pnpm dev:web

dev-bridge: ## Run only the bridge daemon
	pnpm dev:bridge

typecheck: ## Type-check all workspaces
	pnpm typecheck

lint: ## Lint all workspaces
	pnpm lint

format: ## Format the repo with Prettier
	pnpm format

test: ## Run unit/integration tests
	pnpm test

e2e: ## Run Playwright end-to-end tests
	pnpm e2e

build: ## Production build of the web app
	pnpm --filter web build

docker-build: ## Build the web + bridge production images
	docker compose build

docker-up: ## Build + run web + bridge via docker compose (needs .env)
	docker compose up --build

docker-down: ## Stop and remove the compose services
	docker compose down

clean: ## Remove build output + dependencies (keeps env files)
	rm -rf node_modules apps/web/.next apps/web/node_modules bridge/node_modules \
		packages/shared/node_modules coverage playwright-report test-results
