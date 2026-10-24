#!/usr/bin/env bash
# [S] Environment readiness check. Runs at every Claude Code session start (.claude/settings.json) and by hand.
# Fast, offline except `cartesia auth status`, never prints secrets, always exits 0.
cd "$(dirname "$0")/.." || exit 0

CARTESIA="$(command -v cartesia || echo "$HOME/.cartesia/bin/cartesia")"
missing=()
ok() { echo "  ok   $1"; }
bad() { echo "  MISS $1"; missing+=("$2"); }

echo "Soterra dev-check (see CLAUDE.md → 'Team workflow'):"

if [ -x "$CARTESIA" ]; then
  if "$CARTESIA" auth status 2>/dev/null | grep -q "Authenticated"; then ok "Cartesia CLI ($CARTESIA), logged in"
  else bad "Cartesia CLI installed but not logged in" "$CARTESIA auth login   # paste the Cartesia API key"; fi
else
  bad "Cartesia CLI" "bash scripts/setup.sh   # installs it to ~/.cartesia/bin"
fi

if [ -f "$HOME/.convex/config.json" ]; then ok "Convex login"
else bad "Convex login" "npx convex login"; fi

if [ -f .env.local ] && grep -q '^CONVEX_DEPLOYMENT=' .env.local; then ok ".env.local (CONVEX_DEPLOYMENT set)"
else bad ".env.local" "copy .env.local from a teammate (never commit it), or run: npx convex dev --once"; fi

if [ -d node_modules ]; then ok "node_modules"
else bad "node_modules" "npm ci"; fi

if [ -x voice/.venv/bin/python ]; then ok "voice/.venv"
else bad "voice/.venv" "bash scripts/setup.sh   # creates voice/.venv"; fi

if [ ${#missing[@]} -eq 0 ]; then
  echo "All set. Before redeploying anything, read CLAUDE.md → 'After you change code'."
else
  echo "To fix:"; for m in "${missing[@]}"; do echo "  $m"; done
fi
exit 0
