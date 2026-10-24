# Soterra

An AI disaster-information **phone hotline** (Cal Hacks 13). Call a normal US number, stay on one call, ask what's happening near you. Answers come only from official, timestamped sources and name the source and time; when nothing verified exists, Soterra says "I don't know yet" and saves the question. Immediate danger → "hang up and dial 911 now", before anything else.

This repo is the **shared skeleton**: contracts, Convex schema and functions, provider interfaces with mocks, fixtures, docs and tests. One mock path runs end to end. Each owner fills in their module; see [TEAM_PLAN.md](TEAM_PLAN.md).

## Layout

| Path | Owner | What |
| --- | --- | --- |
| `src/contracts/` | shared | zod schemas for every module boundary, `CONTRACT_VERSION` |
| `src/orchestration/` | Alonso, Hikaru | turn pipeline, danger check, grounding, phrases, prompt |
| `src/retrieval/`, `src/memory/`, `src/notifications/`, `src/config/` | Alonso, Hikaru | ranking, caller-memory rules, notifiers, env/health |
| `src/providers/` | Alonso, Hikaru (Apify: Dhweya) | Anthropic/mock LLM, Moss, Apify, Cartesia outbound |
| `src/ingestion/` | Dhweya | source registry, adapters, normalize, validate, dedupe, chunk, extract, crisis |
| `convex/` | per file header | thin Convex functions; `schema.ts`, `http.ts`, `crons.ts` are shared |
| `voice/` | Leia | Python Line SDK agent ([voice/README.md](voice/README.md)) |
| `fixtures/` | shared | fictional "Ridgeview Fire" demo data, golden contract JSON, scripted calls ([fixtures/README.md](fixtures/README.md)) |
| `scripts/` | shared | `seed:fixtures`, `sim:call`, `inject:update` |
| `tests/` | shared | Vitest unit tests (Convex function tests live in `convex/tests/`) |
| `docs/` | shared | [live-call contract](docs/contracts/live-call.md), [ingestion-retrieval contract](docs/contracts/ingestion-retrieval.md), [DECISIONS.md](docs/DECISIONS.md), [SYSTEM_OVERVIEW.md](docs/SYSTEM_OVERVIEW.md) (reference only) |

## Setup

Requires Node ≥ 20.19 and, for `voice/`, [uv](https://docs.astral.sh/uv/) (Python 3.11–3.13).

```bash
npm install
npx convex dev                     # logs in, pushes functions, writes .env.local, watches for changes
npx convex env set VOICE_API_SECRET "$(openssl rand -hex 24)"
npx convex env set SERVE_FIXTURES true      # demo data may be spoken (never in a real deployment)
npx convex run sources:syncRegistry         # writes source rows (all disabled)
```

Add `VOICE_API_SECRET=<same value>` to `.env.local` so `sim:call` can authenticate. All other variables are in [.env.example](.env.example), grouped by where they are set.

## Run the mock path

```bash
npm run seed:fixtures                               # Ridgeview demo bulletins + mock sites, via upsertBulletins
npm run sim:call -- --scenario ridgeview-basic      # text caller against the real HTTP endpoints
npm run sim:call -- --scenario danger
npm run inject:update                               # zone SON-3A: Warning → Order; callbacks for subscribers
npx convex run notifications:get '{"notificationId":"<id>"}'   # or look at the dashboard's notifications table
```

## Test

```bash
npm test            # Vitest: unit tests (node) + Convex function tests (edge-runtime, convex-test)
npm run typecheck   # tsc for src/scripts/tests and for convex/
npm run test:voice  # pytest in voice/ (uv)
```

## What is real, mocked or unconfigured

| Piece | State |
| --- | --- |
| HTTP contract, auth, idempotency, danger check, grounding, unanswered questions, summaries, retention purge, stale-session sweeper, bulletin upsert/versioning/events/expiry, Convex search retrieval, crisis mode | Working (skeleton quality) |
| LLM | `MockLlm` by default; Anthropic adapter is a placeholder (`LLM_PROVIDER=anthropic`) |
| Official feeds | Registry + adapter stubs, all disabled. NWS has request building and mapping notes. |
| Moss, Apify, Cartesia outbound | Placeholders that throw `NotConfiguredError` naming missing env vars |
| SMS | `UnconfiguredSmsNotifier` (no provider chosen) |
| Voice agent | Working against `MockBackendClient` and the HTTP backend; not yet on a phone number |

The non-negotiable product rules are in [TEAM_PLAN.md](TEAM_PLAN.md#rules).
