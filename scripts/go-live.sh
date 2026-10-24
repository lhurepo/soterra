#!/usr/bin/env bash
# Switch the official direct feeds to LIVE ingestion for California on the deployment in .env.local.
# Needs: `npx convex login` done. Run: npm run go-live   (undo: npm run go-live -- --off)
# Not touched: the three mock-site Apify sources (fictional pages) and x_posts (paid actor, no allowlist yet).
set -euo pipefail
cd "$(dirname "$0")/.."

SOURCES=(nws_alerts usgs_earthquakes openfema_declarations nhc_storms tsunami_ntwc inciweb nifc_wfigs usgs_volcanoes)

if [[ "${1:-}" == "--off" ]]; then
  for s in "${SOURCES[@]}"; do
    npx convex run sources:setEnabled "{\"sourceId\":\"$s\",\"enabled\":false}" >/dev/null
    npx convex run sources:setMode "{\"sourceId\":\"$s\",\"mode\":\"fixture\"}" >/dev/null
    echo "off  $s"
  done
  exit 0
fi

echo "Pushing functions (adds usgs_volcanoes)…"
npx convex dev --once

# NWS rejects requests without a User-Agent that names the app and a contact.
if ! npx convex env get NWS_USER_AGENT >/dev/null 2>&1 || [[ -z "$(npx convex env get NWS_USER_AGENT 2>/dev/null)" ]]; then
  npx convex env set NWS_USER_AGENT "Soterra/0.1 (dhweya.modi@gmail.com)"
fi
npx convex env set INGEST_STATES CA

npx convex run sources:syncRegistry >/dev/null
for s in "${SOURCES[@]}"; do
  npx convex run sources:setMode "{\"sourceId\":\"$s\",\"mode\":\"live\"}" >/dev/null
  npx convex run sources:setEnabled "{\"sourceId\":\"$s\",\"enabled\":true}" >/dev/null
  echo "live $s"
done

echo
echo "The 1-minute tick will start these within a minute. Watch with:"
echo "  npx convex run ingestionRuns:sourceStatus"
echo "  npx convex run ingestionRuns:recentRuns '{\"limit\":10}'"
