#!/usr/bin/env bash
# [S] Deploy voice/ to a Cartesia code agent and wait until it is live.
#   npm run voice:deploy                      deploys to the agent linked in voice/.cartesia/config.toml
#   npm run voice:deploy -- agent_xxxxxxxx    deploys to another agent (e.g. Leia's); see voice/README.md "Handing the agent over"
# Needs the Cartesia CLI and `cartesia auth login` (npm run setup installs the CLI).
set -euo pipefail
cd "$(dirname "$0")/../voice"

CLI="$(command -v cartesia || true)"
[ -n "$CLI" ] || CLI="$HOME/.cartesia/bin/cartesia"
[ -x "$CLI" ] || { echo "Cartesia CLI not found. Run: npm run setup"; exit 1; }

AGENT_ID="${1:-$(sed -n "s/^agent-id *= *['\"]\(.*\)['\"].*/\1/p" .cartesia/config.toml 2>/dev/null | head -1)}"
[ -n "$AGENT_ID" ] || { echo "No agent id. Pass one: npm run voice:deploy -- agent_xxxxxxxx"; exit 1; }

echo "Deploying voice/ to ${AGENT_ID} ..."
find . -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
"$CLI" deploy --agent-id "$AGENT_ID" .

echo "Waiting for the new deployment (Ctrl-C to stop watching; the deploy continues)..."
for _ in $(seq 1 30); do
  # Newest deployment is the first data row of the table.
  row="$("$CLI" deployments ls --agent-id "$AGENT_ID" 2>&1 | grep -m1 "$AGENT_ID" || true)"
  echo "$row"
  echo "$row" | grep -q "Ready" && { echo "Live."; exit 0; }
  echo "$row" | grep -qi "Failed" && { echo "Deployment failed. See voice/README.md 'Redeploy' for how to read build logs."; exit 1; }
  sleep 10
done
echo "Still not Ready after 5 minutes. Check: $CLI deployments ls --agent-id $AGENT_ID"
exit 1
