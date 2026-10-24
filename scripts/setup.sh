#!/usr/bin/env bash
# [S] One-time machine setup: Cartesia CLI, npm deps, voice/.venv. Safe to re-run.
# Logins are interactive and left to you (it prints them at the end).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v cartesia >/dev/null && [ ! -x "$HOME/.cartesia/bin/cartesia" ]; then
  echo "Installing the Cartesia CLI to ~/.cartesia/bin…"
  curl -fsSL https://cartesia.sh | sh
fi

echo "Installing npm dependencies (npm ci: keeps package-lock.json unchanged)…"
npm ci

echo "Creating voice/.venv…"
if command -v uv >/dev/null; then
  (cd voice && uv sync)
else
  py="$(command -v python3.13 || command -v python3.12 || command -v python3.11 || true)"
  [ -n "$py" ] || { echo "Need uv or Python 3.11–3.13 for voice/"; exit 1; }
  "$py" -m venv voice/.venv
  voice/.venv/bin/pip install -q -e voice pytest
fi

bash scripts/dev-check.sh
