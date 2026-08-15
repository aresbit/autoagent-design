#!/usr/bin/env bash
# OpenCC (Claude Code CLI) automated build & deploy script
# Usage: ./scripts/deploy-opencc.sh [install|install-local|clean]
#
# Defaults to deepseek API endpoint: ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
# Only requires ANTHROPIC_API_KEY (your deepseek key).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OPENCC_DIR="${PROJECT_ROOT}/packages/opencc"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

check_bun() {
  if ! command -v bun &>/dev/null; then
    log_error "bun is not installed. Install via: curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
  local bun_version
  bun_version="$(bun --version)"
  log_info "bun version: ${bun_version}"
}

check_node() {
  if ! command -v node &>/dev/null; then
    log_error "node is not installed. Install Node ~24 first."
    exit 1
  fi
  local node_version
  node_version="$(node --version)"
  log_info "node version: ${node_version}"
}

build_opencc() {
  log_info "Building OpenCC..."
  cd "${OPENCC_DIR}"

  if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
    log_info "Installing dependencies..."
    bun install
  fi

  log_info "Running build..."
  make build

  if [ ! -f "dist/cli.js" ]; then
    log_error "Build failed: dist/cli.js not found"
    exit 1
  fi

  local size
  size="$(du -h dist/cli.js | cut -f1)"
  log_info "Build complete: dist/cli.js (${size})"
}

print_config_hint() {
  echo ""
  log_info "=== DeepSeek Configuration ==="
  echo ""
  echo "  export ANTHROPIC_BASE_URL='https://api.deepseek.com/anthropic'"
  echo "  export ANTHROPIC_API_KEY='your-deepseek-api-key'"
  echo ""
  log_info "Add the above to your ~/.bashrc or ~/.zshrc to persist."
  echo ""
  log_info "=== Verify ==="
  echo "  opencc --version"
  echo "  echo 'hello' | opencc -p"
}

main() {
  local cmd="${1:-build}"

  log_info "OpenCC deploy script"
  log_info "Project root: ${PROJECT_ROOT}"
  log_info "OpenCC dir:   ${OPENCC_DIR}"

  check_node
  check_bun

  case "${cmd}" in
    build)
      build_opencc
      log_info "Build only. Run with './deploy-opencc.sh install' to install system-wide."
      print_config_hint
      ;;
    install)
      build_opencc
      cd "${OPENCC_DIR}"
      log_info "Installing system-wide..."
      sudo make install
      log_info "Installation complete."
      print_config_hint
      ;;
    install-local)
      build_opencc
      cd "${OPENCC_DIR}"
      log_info "Installing to ~/.local/..."
      make install-local
      log_info "Installation complete."
      print_config_hint
      ;;
    clean)
      cd "${OPENCC_DIR}"
      log_info "Cleaning build artifacts..."
      make clean
      log_info "Clean complete."
      ;;
    *)
      echo "Usage: $0 [build|install|install-local|clean]"
      exit 1
      ;;
  esac
}

main "$@"
