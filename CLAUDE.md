<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

# Soterra — team workflow (read this first)

AI disaster-information phone hotline (Cal Hacks 13). Plan and owners: `TEAM_PLAN.md`; decisions and
verified facts: `docs/DECISIONS.md`; voice details: `voice/README.md`.

## Setup on a new machine

A SessionStart hook (`.claude/settings.json`) runs `scripts/dev-check.sh` and prints what is missing.
If anything is missing, tell the user and fix it:

1. `npm run setup` — installs the Cartesia CLI (to `~/.cartesia/bin`, not on PATH), `npm ci`, `voice/.venv`.
2. Logins (interactive, the user must run them; suggest `! <command>`):
   `~/.cartesia/bin/cartesia auth login` (Cartesia API key) and `npx convex login`.
3. `.env.local` is not in git: copy it from a teammate. Never print or commit its values.
4. `npm run check` re-runs the readiness check.

Never `npm install` without a reason: it rewrites `package-lock.json` and has dropped the native
rolldown binding (Vitest then fails "Cannot find native binding"); fix with
`git checkout package-lock.json && npm ci`.

## Live resources (dev)

| What | Value |
| --- | --- |
| Phone number | **+1 712 600 3362** (Cartesia number id `ap_CWGJppviDa2Ea1jeZEYwBt`) |
| Voice agent (code, deployed from `voice/`) | `soterra-voice` = `agent_1iwkwy7nwEfejQJzwM75hm` |
| Cartesia account | "Soterra" (key in Convex env `CARTESIA_API_KEY`, never in git). Another account was used briefly for a new agent and number; switch with `cartesia auth login <key>` plus the three `CARTESIA_*` Convex env vars |
| Convex dev deployment | `brazen-perch-21` → `https://brazen-perch-21.convex.site` (`/health`) |
| Twilio webhooks (texts) | `https://brazen-perch-21.convex.site/twilio/status` (set per text) and `/twilio/inbound` (set on the Twilio number) |

The dev deployment has `PHONE_NOTIFIER=cartesia`, so `npm run inject:update` places **real phone calls**
to subscribers. Never place calls (or run `inject:update`) toward numbers that have not agreed to it. With
`SMS_NOTIFIER=twilio` it also sends **real texts** (update texts, missed-call texts, the update after an answered call, confirmations); a Twilio
trial account only texts numbers verified in the Twilio console. With `SMS_NOTIFIER=mac_relay` (`docs/mac-relay.md`) texts
go out from a teammate's iPhone to **any** number while `npm run relay:mac` runs on their Mac. Code without the relay
does not accept `SMS_NOTIFIER=mac_relay` and fails to load its config, so pull before `npx convex dev`.

## The demo (Marina Earthquake) — current focus

The Cal Hacks demo runs from the terminal: `npm run demo:start` (crawls wave 1's calm pages; the first Enter crawls
wave 1's earthquake pages, each later Enter one wave-2 site), `npm run demo:control`, `npm run demo:status`, `npm run demo:stop`.
Read `demo/README.md` first (story, call script, how it works, limits). On the dev deployment **everything else
is offline on purpose**: every source is disabled and every non-demo bulletin is out of service; the pipeline code
stays. Do not re-enable sources or re-seed the old Ridgeview fixtures unless the user asks (`npm run demo:offline`
restores the offline state). The demo's callbacks are real calls: only to people who agreed.

## After you change code

Always first: `npm test && npm run typecheck && npm run test:voice`
(`test:voice` needs uv; without it: `cd voice && .venv/bin/python -m pytest`).

| You changed | Then |
| --- | --- |
| `convex/` or `src/` (backend) | `npx convex dev --once` (pushes to the dev deployment; read `convex/_generated/ai/guidelines.md` before editing `convex/`) |
| `voice/` | Redeploy the phone agent: `cd voice && find . -name __pycache__ -prune -exec rm -rf {} + && ~/.cartesia/bin/cartesia deploy --agent-id agent_1iwkwy7nwEfejQJzwM75hm .` then `~/.cartesia/bin/cartesia deployments ls --agent-id agent_1iwkwy7nwEfejQJzwM75hm` until "deployed" |
| voice env vars | `~/.cartesia/bin/cartesia env set --agent-id agent_1iwkwy7nwEfejQJzwM75hm KEY=value` (redeploys) |
| `src/contracts/` | follow "Contract change protocol" in `TEAM_PLAN.md` (zod + fixture + Python mirror) |
| anything | after deploying, **call +1 712 600 3362** and run the demo script (`TEAM_PLAN.md` → Demo script) |

Commit and push only when the user asks.

## What to do next

When asked "what's next", answer from `TEAM_PLAN.md` → **Next steps** (kept current there), then the
milestones table.
