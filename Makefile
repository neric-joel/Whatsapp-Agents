# AgentRoom — cross-platform developer tasks (POSIX / macOS / Linux / WSL).
# Thin wrappers over pnpm. AgentRoom is a local, single-user app: no Docker, no
# Supabase, no login. To just RUN it, use `make start` (or `pnpm start`); Windows users
# can double-click start-agentroom.bat. The dev-* targets are for contributors.

SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help bootstrap doctor install env start \
        dev dev-web dev-bridge typecheck lint format test e2e build clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

bootstrap: ## One-command setup: check prereqs -> install
	@bash scripts/bootstrap.sh

doctor: ## Check required tooling (node>=22.13, pnpm) only
	@bash scripts/bootstrap.sh --check-only

install: ## Install workspace dependencies (frozen lockfile)
	pnpm install --frozen-lockfile

env: ## Create env files from the examples if missing (never overwrites)
	@[ -f apps/web/.env.local ] || cp apps/web/.env.example apps/web/.env.local
	@[ -f bridge/.env ] || cp bridge/.env.example bridge/.env
	@echo "env files ready — all values are optional for local use"

start: ## Run it (end users): build + start web + bridge, open the browser
	pnpm start

dev: ## Develop it (contributors): run web + bridge together in watch mode
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

clean: ## Remove build output + dependencies (keeps env files)
	rm -rf node_modules apps/web/.next apps/web/node_modules bridge/node_modules \
		packages/shared/node_modules packages/db/node_modules coverage playwright-report test-results
