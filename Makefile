# =============================================================================
# Auto Design — one-command local runtime
# =============================================================================
# `make` installs what is missing and brings the web app up in the background.
#
#   make            # same as `make up`
#   make up         # install deps if needed, start daemon + web, print the URL
#   make dev        # same, but stay in the foreground (Ctrl-C stops everything)
#   make down       # stop the runtime
#   make status     # what is running, on which ports
#   make logs       # tail the runtime logs
#
# Every lifecycle target delegates to `pnpm tools-dev`, which is the only
# supported entry point for starting local apps (see AGENTS.md, "Local
# lifecycle"). This Makefile adds no second way to launch things — it is a
# thin, discoverable front door to the same control plane, so ports,
# namespaces, env, and log paths stay identical whether you type `make up` or
# the underlying `pnpm tools-dev start web ...`.
# =============================================================================

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------

ifeq ($(OS),Windows_NT)
    DETECTED_OS := Windows
    OPEN_CMD := start ""
else
    DETECTED_OS := $(shell uname -s)
    ifeq ($(DETECTED_OS),Darwin)
        OPEN_CMD := open
    else
        OPEN_CMD := xdg-open
    endif
endif

# ---------------------------------------------------------------------------
# Configuration — override on the command line, e.g. `make up WEB_PORT=3000`
# ---------------------------------------------------------------------------

PROJECT_NAME := auto-design

# Ports are governed by tools-dev flags; these are the defaults the README and
# QUICKSTART use, so a fresh clone and the docs agree.
DAEMON_PORT ?= 17456
WEB_PORT    ?= 17573

# Runtime namespace. Two namespaces can run side by side, each with its own
# ports, runtime files, and logs under .tmp/tools-dev/<namespace>/.
NAMESPACE ?= default

PNPM := pnpm
TOOLS_DEV := $(PNPM) tools-dev
PORTS := --daemon-port $(DAEMON_PORT) --web-port $(WEB_PORT)
NS := --namespace $(NAMESPACE)

WEB_URL := http://127.0.0.1:$(WEB_PORT)

.PHONY: all up dev down restart status logs check open \
        deps install opencc desktop build \
        guard typecheck verify test test-daemon test-web \
        clean check-deps info help

# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

all: up

# Bring the web app up in the background and hand back the URL.
up: deps
	@echo "Starting Auto Design (namespace: $(NAMESPACE)) ..."
	@$(TOOLS_DEV) start web $(PORTS) $(NS)
	@echo ""
	@echo "  Auto Design is up → $(WEB_URL)"
	@echo "  make logs     tail the runtime logs"
	@echo "  make down     stop it"
	@echo ""

# Same as `up`, but stays attached: Ctrl-C shuts the runtime down with you.
dev: deps
	@echo "Starting Auto Design in the foreground → $(WEB_URL)"
	@echo "Press Ctrl-C to stop."
	@$(TOOLS_DEV) run web $(PORTS) $(NS)

down:
	@$(TOOLS_DEV) stop $(NS)

restart: deps
	@$(TOOLS_DEV) restart web $(PORTS) $(NS)
	@echo "Auto Design restarted → $(WEB_URL)"

status:
	@$(TOOLS_DEV) status $(NS)

logs:
	@$(TOOLS_DEV) logs $(NS)

# Status plus recent logs — the first thing to run when something looks wrong.
check:
	@$(TOOLS_DEV) check $(NS)

open:
	@$(OPEN_CMD) $(WEB_URL)

# The Electron shell on top of the same daemon + web pair. Needs a GUI session;
# on a bare Linux container, ELECTRON_DISABLE_SANDBOX=1 is usually required.
desktop: deps
	@$(TOOLS_DEV) start desktop $(PORTS) $(NS)

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------

# Install only when the lockfile or a manifest is newer than node_modules, so
# repeated `make up` stays instant.
deps: check-deps
	@if [ ! -d "node_modules" ] || [ "pnpm-lock.yaml" -nt "node_modules" ] || [ "package.json" -nt "node_modules" ]; then \
		echo "Installing workspace dependencies ..."; \
		$(PNPM) install; \
	fi

# Unconditional install, for when you want to force it.
install: check-deps
	@$(PNPM) install

# Build and install OpenCC, the bundled agent brain. Optional: the web app
# starts without it, but no agent will be available to run a design brief.
# Requires Bun. Set ANTHROPIC_API_KEY to your DeepSeek key before running.
opencc:
	@./scripts/build-opencc.sh install-local

# Production web build, for `make up PROD=1`-style manual verification.
build: deps
	@$(PNPM) --filter @open-design/web build

check-deps:
	@command -v node >/dev/null 2>&1 || { echo "Error: node is not installed. Auto Design needs Node ~24 — https://nodejs.org"; exit 1; }
	@command -v $(PNPM) >/dev/null 2>&1 || { echo "Error: pnpm is not installed. Run 'corepack enable' (or 'npm i -g pnpm@10.33.2')."; exit 1; }
	@node -e 'const m=Number(process.versions.node.split(".")[0]); if (m!==24) { console.error(`Warning: Node ${process.versions.node} detected; this repo targets Node ~24 (package.json#engines).`); }'

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

guard: deps
	@$(PNPM) guard

typecheck: deps
	@$(PNPM) typecheck

# What to run before calling a change done.
verify: guard typecheck

test: test-daemon test-web

test-daemon: deps
	@$(PNPM) --filter @open-design/daemon test

test-web: deps
	@$(PNPM) --filter @open-design/web test

# ---------------------------------------------------------------------------
# Housekeeping
# ---------------------------------------------------------------------------

# Stops the runtime and drops its working files. Leaves .od/ alone — that is
# your projects, artifacts, and database, not build output.
clean:
	@$(TOOLS_DEV) stop $(NS) 2>/dev/null || true
	@rm -rf .tmp apps/web/.next
	@echo "Removed .tmp/ and apps/web/.next (your .od/ data is untouched)."

info:
	@echo "Platform:     $(DETECTED_OS)"
	@echo "Node:         $$(node --version 2>/dev/null || echo 'not installed')"
	@echo "pnpm:         $$($(PNPM) --version 2>/dev/null || echo 'not installed')"
	@echo "Namespace:    $(NAMESPACE)"
	@echo "Daemon port:  $(DAEMON_PORT)"
	@echo "Web port:     $(WEB_PORT)"
	@echo "Web URL:      $(WEB_URL)"

help:
	@echo "Auto Design — make targets"
	@echo ""
	@echo "  Run"
	@echo "    make            Same as 'make up'"
	@echo "    make up         Start daemon + web in the background, print the URL"
	@echo "    make dev        Start in the foreground; Ctrl-C stops everything"
	@echo "    make down       Stop the runtime"
	@echo "    make restart    Restart daemon + web"
	@echo "    make desktop    Also launch the Electron shell (needs a GUI session)"
	@echo "    make open       Open $(WEB_URL) in your browser"
	@echo ""
	@echo "  Inspect"
	@echo "    make status     Show what is running and on which ports"
	@echo "    make logs       Tail the runtime logs"
	@echo "    make check      Status plus recent logs (start here when stuck)"
	@echo "    make info       Show detected toolchain and resolved ports"
	@echo ""
	@echo "  Set up"
	@echo "    make deps       Install workspace dependencies if they are stale"
	@echo "    make install    Force 'pnpm install'"
	@echo "    make opencc     Build and install OpenCC, the bundled agent (needs Bun)"
	@echo "    make build      Production web build"
	@echo ""
	@echo "  Validate"
	@echo "    make verify     guard + typecheck"
	@echo "    make guard      Repository guard checks"
	@echo "    make typecheck  Workspace typecheck"
	@echo "    make test       Daemon and web test suites"
	@echo ""
	@echo "  Clean"
	@echo "    make clean      Stop the runtime and remove .tmp/ and .next/"
	@echo ""
	@echo "  Variables"
	@echo "    DAEMON_PORT=$(DAEMON_PORT)   WEB_PORT=$(WEB_PORT)   NAMESPACE=$(NAMESPACE)"
	@echo "    e.g. make up WEB_PORT=3000 NAMESPACE=scratch"
