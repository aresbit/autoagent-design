#!/usr/bin/env bash
# =============================================================================
# OpenCC (Claude Code CLI) — Automated Build & Deploy Script
# =============================================================================
# One-command build and install for the bundled OpenCC reverse-engineered
# Claude Code CLI. OpenCC source lives at packages/opencc/ and runs on Bun.
#
# Usage:
#   ./scripts/build-opencc.sh              # build only (default)
#   ./scripts/build-opencc.sh install      # build + system-wide install
#   ./scripts/build-opencc.sh install-local # build + user-local install (~/.local)
#   ./scripts/build-opencc.sh ci           # CI mode: build + verify (non-interactive)
#   ./scripts/build-opencc.sh clean        # remove build artifacts
#   ./scripts/build-opencc.sh verify       # check deps + build status
#   ./scripts/build-opencc.sh help         # show this help
#
# Quick start (dev loop):
#   ./scripts/build-opencc.sh install-local
#   export ANTHROPIC_BASE_URL='https://api.deepseek.com/anthropic'
#   export ANTHROPIC_API_KEY='sk-...'
#   echo 'hello' | opencc -p
#
# Environment:
#   ANTHROPIC_BASE_URL   API endpoint (defaults to DeepSeek)
#   ANTHROPIC_API_KEY    API key (required at runtime, not build time)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OPENCC_DIR="${PROJECT_ROOT}/packages/opencc"
DIST_FILE="${OPENCC_DIR}/dist/cli.js"

# ── Color helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "${CYAN}${BOLD}▶${NC} $*"; }

# ── Timing ───────────────────────────────────────────────────────────────────
_now_ms() { date +%s%3N 2>/dev/null || date +%s000; }
_elapsed() {
  local start="$1" end="$(_now_ms)"
  echo "$(((end - start) / 1000)).$(((end - start) % 1000))s"
}

# ── Dependency checks ────────────────────────────────────────────────────────

check_node() {
  if ! command -v node &>/dev/null; then
    log_error "node is not installed. Install Node ~24: https://nodejs.org"
    return 1
  fi
  local v; v="$(node --version)"
  log_info "node ${v}"
}

check_bun() {
  if ! command -v bun &>/dev/null; then
    log_error "bun is not installed. Install: curl -fsSL https://bun.sh/install | bash"
    return 1
  fi
  local v; v="$(bun --version)"
  log_info "bun ${v}"
}

check_deps() {
  local ok=0
  check_node || ok=1
  check_bun || ok=1
  return "${ok}"
}

# ── Build ────────────────────────────────────────────────────────────────────

build_opencc() {
  local start; start="$(_now_ms)"

  log_step "Building OpenCC (packages/opencc) ..."

  cd "${OPENCC_DIR}"

  # Install dependencies if needed
  if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ] || [ "bun.lock" -nt "node_modules" ]; then
    log_info "Installing dependencies (bun install) ..."
    bun install --frozen-lockfile 2>/dev/null || bun install
  else
    log_info "Dependencies up to date"
  fi

  # Build
  log_info "Running build (bun build src/entrypoints/cli.tsx) ..."
  bun run build

  # Verify output
  if [ ! -f "${DIST_FILE}" ]; then
    log_error "Build failed: ${DIST_FILE} not found"
    return 1
  fi

  local size; size="$(du -h "${DIST_FILE}" | cut -f1)"
  local elapsed; elapsed="$(_elapsed "${start}")"
  log_info "Build complete → ${DIST_FILE} (${size}) in ${elapsed}"

  # Quick smoke test: does the binary start?
  if [ "${CI_MODE:-false}" = true ] || [ "${VERIFY:-true}" = true ]; then
    log_info "Smoke test: version check ..."
    local version_out; version_out="$(bun run "${DIST_FILE}" --version 2>&1 || true)"
    if [ -n "${version_out}" ]; then
      log_info "Version: ${version_out}"
    else
      log_warn "Version check produced no output (non-fatal)"
    fi
  fi
}

# ── Install ──────────────────────────────────────────────────────────────────

install_system() {
  log_step "Installing system-wide (requires sudo) ..."
  cd "${OPENCC_DIR}"
  sudo make install
  log_info "Installed → $(which opencc 2>/dev/null || echo '/usr/local/bin/opencc')"
}

install_local() {
  log_step "Installing to ~/.local/ ..."
  cd "${OPENCC_DIR}"
  make install-local
  local bin_path="${HOME}/.local/bin/opencc"
  if [ -f "${bin_path}" ]; then
    log_info "Installed → ${bin_path}"
    if ! echo "${PATH}" | grep -q "${HOME}/.local/bin"; then
      log_warn "~/.local/bin is not in your PATH. Add it to your shell config:"
      log_warn "  export PATH=\"\${HOME}/.local/bin:\${PATH}\""
    fi
  fi
}

# ── Verify ───────────────────────────────────────────────────────────────────

verify() {
  log_step "Verifying OpenCC installation ..."

  if [ ! -f "${DIST_FILE}" ]; then
    log_warn "dist/cli.js not found — run 'build' first"
    return 1
  fi

  local size; size="$(du -h "${DIST_FILE}" | cut -f1)"
  log_info "dist/cli.js: ${size}"

  # Check that 'opencc' or 'claude-js' resolves on PATH
  if command -v opencc &>/dev/null; then
    log_info "opencc on PATH: $(which opencc)"
  elif command -v claude-js &>/dev/null; then
    log_info "claude-js on PATH: $(which claude-js)"
  else
    log_warn "neither 'opencc' nor 'claude-js' on PATH — run 'install' or 'install-local'"
  fi

  log_info "Verify complete"
}

# ── Clean ────────────────────────────────────────────────────────────────────

clean() {
  log_step "Cleaning build artifacts ..."
  cd "${OPENCC_DIR}"
  make clean
  log_info "Clean complete"
}

# ── Config hint ──────────────────────────────────────────────────────────────

print_config_hint() {
  echo ""
  echo -e "${CYAN}${BOLD}══════════════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}${BOLD}  Post-install Configuration${NC}"
  echo -e "${CYAN}${BOLD}══════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "  Add to ~/.bashrc or ~/.zshrc:"
  echo ""
  echo -e "    ${BOLD}export ANTHROPIC_BASE_URL='https://api.deepseek.com/anthropic'${NC}"
  echo -e "    ${BOLD}export ANTHROPIC_API_KEY='your-deepseek-api-key'${NC}"
  echo ""
  echo "  Verify:"
  echo ""
  echo "    opencc --version"
  echo "    echo 'hello' | opencc -p"
  echo ""
  echo -e "${CYAN}${BOLD}══════════════════════════════════════════════════════════════${NC}"
}

# ── Help ─────────────────────────────────────────────────────────────────────

print_help() {
  sed -n '2,18p' "$0"
}

# ── Main ─────────────────────────────────────────────────────────────────────

CI_MODE=false
VERIFY=true

main() {
  local cmd="${1:-build}"

  case "${cmd}" in
    build)
      check_deps
      build_opencc
      print_config_hint
      ;;
    ci)
      CI_MODE=true
      check_deps
      build_opencc
      verify
      log_info "CI build passed"
      ;;
    install)
      check_deps
      build_opencc
      install_system
      print_config_hint
      ;;
    install-local)
      check_deps
      build_opencc
      install_local
      print_config_hint
      ;;
    verify)
      verify
      ;;
    clean)
      clean
      ;;
    help|--help|-h)
      print_help
      ;;
    *)
      log_error "Unknown command: ${cmd}"
      echo ""
      print_help
      exit 1
      ;;
  esac
}

main "$@"
