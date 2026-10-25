#!/usr/bin/env bash
# agentic-commerce workspace setup (macOS & Linux). Run from anywhere:
#   ./platform/setup.sh                 full setup: tools → repos → .env → infra → init → install → build → doctor
#   ./platform/setup.sh tools --install install missing tools (Homebrew on macOS; prints commands on Linux)
#   ./platform/setup.sh <command>       any `ac` command (doctor, infra up, dev, new service …)
#   ./platform/setup.sh setup --yes     non-interactive (API keys from environment variables)
set -euo pipefail
cd "$(dirname "$0")"

install_node() {
  echo "Node.js 22+ is required (24 LTS recommended)."
  if [[ "$(uname)" == "Darwin" ]]; then
    if ! command -v brew >/dev/null 2>&1; then
      echo "Install Homebrew first: https://brew.sh — then re-run ./platform/setup.sh"
      exit 1
    fi
    read -r -p "Install Node.js 24 with Homebrew now? [Y/n] " a
    if [[ ! "${a:-y}" =~ ^[Nn] ]]; then
      brew install node@24 && brew link --overwrite --force node@24
      return 0
    fi
  else
    echo "Install with nvm:  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash && nvm install 24"
  fi
  exit 1
}

if ! command -v node >/dev/null 2>&1; then install_node; fi
major=$(node -p 'process.versions.node.split(".")[0]')
if (( major < 22 )); then echo "Found Node.js $(node -v)."; install_node; fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Installing pnpm 12 (npm i -g pnpm@12)…"
  npm install -g pnpm@12 || { echo "Could not install pnpm globally. Try: sudo npm i -g pnpm@12"; exit 1; }
fi

exec node scripts/ac.mjs "$@"
