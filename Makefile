# @hanzo/console — the unified Hanzo Cloud console (Next.js). One package
# manager: pnpm, pinned by `packageManager` in package.json against the tracked
# pnpm-lock.yaml. Every target below calls console's own scripts, so there is
# exactly one recipe per artifact and nothing here to drift.
#
# The bundle the cloud binary EMBEDS is not built from here: hanzoai/cloud's
# `make webui` runs build:embed from a console checkout and overlays out/ onto
# its webui/dist. That target stays the one place that does the embedding —
# `make embed` below only produces out/ locally.

PNPM ?= pnpm

.PHONY: help build embed test e2e lint typecheck dev clean

help: ## Show this help.
	@awk 'BEGIN{FS=":.*##";printf "\nUsage: make <target>\n\nTargets:\n"} /^[a-zA-Z_-]+:.*##/{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: node_modules ## Build the Next.js app (next build).
	$(PNPM) build

embed: node_modules ## Static export into out/ — the bundle cloud embeds.
	$(PNPM) build:embed

test: node_modules ## Run the unit suite (vitest run).
	$(PNPM) test

e2e: node_modules ## Run the Playwright suite.
	$(PNPM) e2e

# This repo has no eslint config and no `lint` script — `tsc --noEmit` IS its
# static check. An alias, not a second recipe: one check, one implementation,
# reachable by the fleet-wide verb and by its own name.
lint: typecheck ## Static check — alias for typecheck.

typecheck: node_modules ## tsc --noEmit.
	$(PNPM) typecheck

dev: node_modules ## Dev server on :4000.
	$(PNPM) dev

node_modules: ## Install deps (pnpm install --frozen-lockfile).
	$(PNPM) install --frozen-lockfile

# Generated output only, matching .gitignore, with two deliberate exclusions.
# next-env.d.ts is gitignored but tsconfig `include`s it, so removing it breaks
# typecheck until the next build — it stays. And this is a root-level rm rather
# than a recursive find, so it cannot wander into .claude/worktrees/*/.next and
# delete another checkout's output. node_modules is never touched: dropping it
# is a reinstall, not a clean.
clean: ## Remove build output (.next, out, dist, *.tsbuildinfo).
	rm -rf .next out dist *.tsbuildinfo
