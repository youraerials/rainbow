# Rainbow — Self-hosted digital life platform
# Usage: make <target>

SHELL := /bin/bash
.DEFAULT_GOAL := help

RAINBOW_ROOT := $(shell pwd)
CLI := $(RAINBOW_ROOT)/cli/rainbow

# ─── Core ────────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: install
install: ## Install dependencies (Apple Container, cloudflared, restic, yq, jq)
	@echo "Installing Rainbow dependencies..."
	@command -v brew >/dev/null || (echo "Installing Homebrew..." && /bin/bash -c "$$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)")
	brew install container yq jq restic cloudflared
	container system start --enable-kernel-install || true
	@echo "Dependencies installed. Run 'make setup-test-tunnel' next."

.PHONY: setup
setup: ## Run initial setup (generate configs)
	@$(CLI) config apply

.PHONY: start
start: ## Start all services
	@$(CLI) start

.PHONY: stop
stop: ## Stop all services
	@$(CLI) stop

.PHONY: status
status: ## Show service status
	@$(CLI) status

.PHONY: logs
logs: ## Follow all service logs
	@$(CLI) logs

.PHONY: restart
restart: stop start ## Restart all services

# ─── Testing ─────────────────────────────────────────────────────

.PHONY: test
test: ## Run full integration test suite
	@bash scripts/test-all.sh

.PHONY: test-quick
test-quick: ## Run quick tests (skip email delivery, backups)
	@bash scripts/test-all.sh --quick

# ─── Configuration ───────────────────────────────────────────────

.PHONY: setup-test-tunnel
setup-test-tunnel: ## Create a Cloudflare Tunnel + DNS routes for testing (test-*.rainbow.rocks)
	@bash scripts/setup-test-tunnel.sh

.PHONY: setup-providers
setup-providers: ## Configure OAuth providers in Authentik (requires API token in Keychain)
	@bash services/authentik/setup-providers.sh

.PHONY: config
config: ## Regenerate all configs from rainbow.yaml
	@$(CLI) config apply

.PHONY: config-edit
config-edit: ## Open rainbow.yaml in your editor
	@$(CLI) config edit

# ─── Backup & Restore ───────────────────────────────────────────

.PHONY: backup
backup: ## Run a backup now
	@$(CLI) backup

.PHONY: restore
restore: ## Restore from backup (interactive)
	@bash backups/restore.sh

# ─── Maintenance ─────────────────────────────────────────────────

.PHONY: update
update: ## Pull latest images and restart
	@$(CLI) update

.PHONY: clean
clean: ## Remove generated configs (keeps data)
	rm -f infrastructure/.env
	rm -f infrastructure/caddy/Caddyfile
	rm -f infrastructure/cloudflared/config.yml
	rm -f infrastructure/postgres/init/00-create-databases.sql
	@echo "Generated configs removed. Run 'make config' to regenerate."

.PHONY: reset
reset: ## Full reset: stop services, remove data (DESTRUCTIVE)
	@echo "WARNING: This will stop all services and delete all data."
	@read -p "Type 'yes' to continue: " confirm && [ "$$confirm" = "yes" ] || exit 1
	@$(CLI) stop
	container-compose -f infrastructure/docker-compose.yml down -v
	@echo "Reset complete. Run 'make setup && make start' to start fresh."

# ─── Cloudflare Workers ─────────────────────────────────────────

.PHONY: cf-deploy
cf-deploy: ## Deploy Cloudflare Workers
	cd cloudflare && npx wrangler deploy

.PHONY: cf-dev
cf-dev: ## Run Cloudflare Workers locally
	cd cloudflare && npx wrangler dev

# ─── Brand site (rainbow.rocks) ──────────────────────────────────

.PHONY: site-dev
site-dev: ## Run the brand site locally
	@bash website/scripts/dev.sh

.PHONY: site-deploy
site-deploy: ## Deploy the brand site to Cloudflare Pages
	@bash website/scripts/deploy.sh

.PHONY: site-deploy-preview
site-deploy-preview: ## Deploy a preview of the brand site
	@bash website/scripts/deploy.sh --preview

.PHONY: site-setup-domain
site-setup-domain: ## One-time: attach rainbow.rocks to the Pages project
	@bash website/scripts/deploy.sh --setup-domain
