# Auto Design

AI-powered design agent that runs locally. Chat with OpenCC (reverse-engineered Claude Code CLI) → it builds design artifacts in a real project folder → live preview in a sandboxed iframe. BYOK at every layer.

```bash
make
```

Installs anything missing, starts the daemon and web app, and prints the URL.

## Quick start

```bash
# 1. Bring the web app up (installs dependencies on first run)
make

# 2. Build & install OpenCC (the agent brain) — needs Bun
make opencc

# 3. Set your DeepSeek API key
export ANTHROPIC_API_KEY='sk-your-deepseek-key'
```

Open `http://127.0.0.1:17573` — type a design prompt, the agent builds it.

`make help` lists every target. The common ones:

| Command | What it does |
| --- | --- |
| `make` / `make up` | Start daemon + web in the background |
| `make dev` | Same, in the foreground — Ctrl-C stops everything |
| `make down` | Stop the runtime |
| `make status` / `make logs` | What's running; tail the logs |
| `make desktop` | Also launch the Electron shell |
| `make verify` | `guard` + `typecheck` |

Ports and namespace are overridable: `make up WEB_PORT=3000 NAMESPACE=scratch`.

Every target delegates to `pnpm tools-dev`, so the Makefile and the underlying
commands share one control plane:

```bash
pnpm tools-dev start web --daemon-port 17456 --web-port 17573
```

## Architecture

```
apps/daemon     — Express daemon, od CLI, agent spawning, skills, artifacts
apps/web        — Next.js 16 App Router frontend
apps/desktop    — Electron shell (macOS/Linux/Windows)
apps/packaged   — Packaged Electron runtime + sidecar launcher
packages/opencc — Reverse-engineered Claude Code CLI (runs on Bun)
tools/dev       — Local dev lifecycle (start/stop/status)
tools/pack      — Packaged build/install tooling
```

## Development

```bash
# Typecheck + guard
pnpm guard && pnpm typecheck

# Build specific packages
pnpm --filter @open-design/daemon build
pnpm --filter @open-design/web build

# Run tests
pnpm --filter @open-design/daemon test
pnpm --filter @open-design/web test

# Desktop
pnpm tools-dev start desktop --daemon-port 17456 --web-port 17573
```

## Requirements

- Node ~24, pnpm 10.33.2
- Bun (for OpenCC)
- DeepSeek API key (set as `ANTHROPIC_API_KEY`)

## License

Apache 2.0
