# Hackathon log

- **Project:** Soterra
- **Event:** Cal Hacks 13.0
- **What it does:** A phone hotline where an AI voice agent answers disaster questions only from official, timestamped bulletins, then calls or texts callers when those bulletins change.
- **Live app:** live phoneline at +1 (712) 600-3362
- **Repo:** https://github.com/lhurepo/soterra
- **Frontend:** not deployed (native SwiftUI iOS app in `ios/`, run from Xcode)
- **Convex deployment:** https://brazen-perch-21.convex.cloud
- **Components:** none
- **Convex features:** schema, indexes, queries, mutations, actions, HTTP actions, crons, scheduled functions, file storage, full text search, paginated queries
- **Auth:** Other (custom sign-in: a code read out by phone, then a session token; `convex/accounts.ts`), minimzed authentication for use case
- **AI models:** claude-haiku-5-5, claude-sonnet-5-5, sonic-3.6
- **Started:** 2026-10-24T04:36:47Z
- **Last updated:** 2026-10-25T08:26:17Z

## How we use Convex

- **Answering a call:** the voice agent posts each turn to HTTP actions (`/voice/turn` etc.) that run the answer pipeline. `convex/http.ts`, `convex/voice.ts`
- **Finding the answer:** bulletin chunks have a full text search index (`search_text`). `convex/schema.ts`, `convex/retrieval.ts`
- **Fresh official data:** crons schedule source fetches and expire old bulletins; raw payloads and GeoJSON go to file storage. `convex/crons.ts`, `convex/ingestion.ts`
- **Update calls and texts:** new events schedule `matchEvents`, then `notifications.deliver`; Twilio webhooks are HTTP actions. `convex/notifications.ts`, `convex/twilio.ts`
- **Marina Earthquake demo:** a scheduled chain crawls 13 mock sites that Convex serves at `/mock-sites/`. `convex/demo.ts`, `convex/mockSites.ts`
- **Live screens:** no screen uses reactive `useQuery`. iOS Home and Alerts poll the `GET /app/state` HTTP action every 5 s, so new alerts appear without a manual refresh. `convex/app.ts`, `ios/Soterra/App/RootView.swift`

## Log

Dates are UTC, 2026. Docs-only and asset-only commits are left out.

- 10-24 `542a77b` Set up Convex: `convex/README.md`, `convex/tsconfig.json`
- 10-24 `4284ea4` Shared skeleton: `convex/schema.ts`, `convex/ingestion.ts`, `convex/calls.ts`
- 10-24 `e991675` Ingestion v1: `convex/ingestion.ts`, `src/ingestion/`
- 10-24 `1d41d9d` Voice agent: `voice/soterra_voice/agent.py`
- 10-24 `4fef4ef` Backend turn pipeline: `convex/calls.ts`, `src/orchestration/pipeline.ts`
- 10-24 `6c77bb7` Phone agent live, callbacks: `scripts/dev-check.sh`, `voice/`
- 10-24 `39d394e` Moss retrieval: `src/providers/moss/live.ts`, `convex/voice.ts`
- 10-24 `7d51622` Live-data fixes: `convex/ingestion.ts`, `convex/retrieval.ts`
- 10-24 `d83e227` Corroboration tiers: `src/retrieval/corroboration.ts`
- 10-24 `a737f79` Anthropic key pool: `src/providers/llm/pool.ts`
- 10-24 `f9827ee` iOS app: `ios/Soterra/`
- 10-24 `9b5beb7` iOS reads backend feed: `convex/app.ts`, `convex/http.ts`
- 10-24 `195cda0` Twilio texts: `convex/schema.ts`, `src/providers/twilio/sms.ts`
- 10-24 `5e551e4` Calls or texts, timed updates: `convex/subscriptions.ts`
- 10-24 `19ea962` Missed-call texts, webhooks: `convex/notifications.ts`, `convex/twilio.ts`
- 10-24 `5b912f7` Scheduled-updates cron: `convex/crons.ts`
- 10-24 `b3a967d` Verified in-app dialing: `convex/accounts.ts`, `convex/calls.ts`
- 10-25 `afc4660` iOS Simple mode, map: `ios/Soterra/Features/`
- 10-25 `03945f1` New text format, STOP keyword: `src/notifications/sms.ts`
- 10-25 `6aa8db0` Text relay through a Mac: `convex/smsRelay.ts`
- 10-25 `8212d73` Marina Earthquake demo: `convex/demo.ts`, `demo/scenario.ts`
- 10-25 `6dd9377` iOS auto-refresh, brand: `ios/Soterra/`
- 10-25 `9b087fd` Voice and demo tuning: `convex/demo.ts`
- 10-25 `4d8cd41` Text formatting: `src/notifications/sms.ts`
