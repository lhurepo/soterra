# Decisions and verified facts

[S] Dated log of what we checked against official docs (or the installed packages) and what it changed. Newest entries go at the bottom of each section. "Unverified" means nobody has confirmed it yet: treat it as a risk.

## Verification log (2026-10-24)

### Cartesia Line SDK

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| Package, version, Python | Installed `cartesia-line` from PyPI and read its source; [docs/line/sdk/overview](https://docs.cartesia.ai/line/sdk/overview.md) | PyPI name `cartesia-line`, import root `line`, latest **0.2.19**. Package metadata: `Requires-Python >=3.10`. Hosted deployments support Python 3.9–3.13 ([deployments](https://docs.cartesia.ai/line/infrastructure/deployments)). | `voice/pyproject.toml` pins `cartesia-line>=0.2.19,<0.3` and `requires-python >=3.11,<3.14` (3.14 is not supported by Cartesia hosting). |
| Custom agent interface | `line/agent.py`, `line/voice_agent_app.py` (0.2.19); [agents](https://docs.cartesia.ai/line/sdk/agents.md) | An agent is a class with `process(env, event)` (an async generator of output events) or a function with that signature. `VoiceAgentApp(get_agent=..., pre_call_handler=None)`; `get_agent(env: AgentEnv, call_request: CallRequest)` returns the agent or `(agent, run_filter, cancel_filter)`. The `env` passed to `process` is a `TurnEnv`. | As specified. |
| Event names, transcript location | `line/events.py` | Input: `CallStarted`, `UserTurnStarted`, `UserTurnEnded`, `UserTextSent`, `UserDtmfSent`, `CallEnded`, … The caller's words: `UserTurnEnded.content` is a list of `UserTextSent | UserDtmfSent`; text is `UserTextSent.content`. Output: `AgentSendText(text, interruptible=True)`, `AgentEndCall(reason="agent_ended")`, `AgentUpdateCall(voice_id, language, …)`, `AgentTransferCall`, `LogMetric`, `LogMessage`. | The agent joins all `UserTextSent` items (the docs' `content[0]` example breaks on DTMF). |
| Default filters, barge-in | `ConversationRunner._prepare_agent` | Run on `CallStarted`, `UserTurnEnded`, `CallEnded`; cancel on `UserTurnStarted` (the in-flight task is cancelled). | Turns are indexed and idempotent; the agent sends `interruptedPrevious` after a cancellation. |
| `CallRequest` fields | `line/voice_agent_app.py` | `call_id`, `from_` (alias `from`), `to`, `agent_call_id`, `agent` (`id`, `system_prompt`, `introduction`), **`metadata: dict`** (not in the docs table), `agent_token`, `api_base_url`. | `call_id` → `providerCallId`. Outbound `notification_id` is read from `metadata`. |
| Setting language | `events.py`, `_harness_types.py`, agents doc | Mid-call: `AgentUpdateCall(language="es")` sets STT and TTS language. Before the call: `pre_call_handler` returning `PreCallResult(config={...})`; the docs show only `"tts"`; the harness type `ConfigOutput` has `tts`, `stt`, `language`. | Agent switches language after session start with `AgentUpdateCall`. `pre_call_handler` not used yet (its `stt` key is undocumented). |
| Hosting end date | [migrate-from-line-sdk](https://docs.cartesia.ai/agents/migrate-from-line-sdk), [changelog 2026](https://docs.cartesia.ai/changelog/2026.md) | Cartesia stops hosting code-first Line agents on **December 1, 2026**; self-hosted agents are unaffected. The deployments page still documents `cartesia deploy` with no deprecation notice. Self-host path: `cartesia connect --agent-id <id> --url https://…`. | **Unverified:** whether `cartesia deploy` accepts *new* agents today — Leia's first-hour task answers it. Fallbacks documented in `voice/README.md`. |
| CLI | [line/cli](https://docs.cartesia.ai/line/cli) | `cartesia auth login`, `cartesia deploy`, `cartesia env set --from .env`, `cartesia chat <port>` (text, local), `cartesia connect`, `cartesia phone-numbers provision/assign`. | Used in `voice/README.md`. |

### Cartesia telephony and STT

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| Outbound-call API | [create-outbound-call](https://docs.cartesia.ai/api-reference/agents/calls/create-outbound-call.md), [outbound dialing](https://docs.cartesia.ai/line/integrations/telephony/outbound-dialing.md) | `POST https://api.cartesia.ai/agents/calls`, headers `X-API-Key` and `Cartesia-Version: 2026-08-14`. Body: `from_number_id`, `agent_id`, `outbound_calls: [{ to_number, dynamic_variables }]`, optional `ringing_timeout_seconds`, `max_call_duration_minutes`. Response `{ calls: [{ number, agent_call_id } | { number, error }] }`. US numbers only; ≤ 1 call/s per number. The OpenAPI spec says bearer auth while the examples use `X-API-Key`. | Adds env var **`CARTESIA_FROM_NUMBER_ID`** (not in the prompt). Adapter sends `X-API-Key`; untested live. |
| Does call metadata reach the agent? | Same pages + SDK source | The request has **no `metadata` field**, only `dynamic_variables` ("to personalize a managed agent"). The SDK's `CallRequest.metadata` exists, but no page says `dynamic_variables` populate it. | **Unverified.** The agent reads `metadata.notification_id`; Leia confirms on the first outbound call. Fallback idea: backend looks up the latest queued notification for the dialed number. |
| STT languages | [stt-models/latest](https://docs.cartesia.ai/build-with-cartesia/stt-models/latest), changelog Sept 2026 | `ink-2` (stable, 2026-09-17): **en, fr, hi, ja, es**, auto-detected. Line agents use Ink 2 by default ("eligible" agents, May 2026). `ink-whisper` covers ~100 languages but is batch/older. | English first, Spanish second, as planned. Mandarin and Punjabi from the overview are **not** supported by Ink 2. |
| Phone numbers | provision API, CLI | Provision with `cartesia phone-numbers provision`; assign to an agent for inbound; unassigned numbers are outbound-only. | `voice/README.md`. |

### Anthropic

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| Model IDs | Anthropic model table (claude-api skill, cached 2026-10-06) | `claude-haiku-5-5` and `claude-sonnet-5-5` are current. Use exact IDs, no date suffix. | Defaults for `CLAUDE_FAST_MODEL` / `CLAUDE_SMART_MODEL`. |
| Request shape | Same | `temperature`/`top_p`/`top_k` are rejected (400) on current models as of 2026-10-21. Haiku 5.5 thinks by default (effort default `medium`); latency is tuned with `output_config.effort`. Forced `tool_choice` is rejected on Sonnet 5.5. Check `stop_reason === "refusal"`. | Adapter sends `output_config.effort: "low"` for turns, never `temperature`, and treats refusals as errors (the pipeline then speaks the fallback). |
| TS SDK in Convex's default runtime | `@anthropic-ai/sdk` 1.3.0; `convex/tests/runtime.test.ts` (edge-runtime) | The SDK uses `fetch` and constructs in an edge runtime without Node built-ins; Convex docs: `fetch` works in the default runtime for actions. | No `"use node"` needed. Not yet exercised on a deployed function with a real key. |

### Convex

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| Version, guidelines | `node_modules/convex` (1.48.0), `convex/_generated/ai/guidelines.md` | Table-name-first `ctx.db.get/patch/delete(table, id)`; crons only via `crons.interval`/`crons.cron`; no `Date.now()` in queries; bounded reads (`take`). | Followed throughout. |
| HTTP actions | Guidelines; `httpRouter` types | Routes registered on the `.convex.site` URL; `pathPrefix` routes supported. | `/voice/*`, `/health`, `/ingest/apify`, `/mock-sites/*`. |
| Search index limits | [text-search](https://docs.convex.dev/search/text-search) | 1 search field, ≤ 16 filter fields, ≤ 16 terms per query (≤ 32 chars each), ≤ 1024 results scanned, filters are equality. | `searchText()` trims to 16 terms; filters on `isActive`, `primaryState`, `isFixture`. |
| `"use node"` | [runtimes](https://docs.convex.dev/functions/runtimes) | A `"use node"` file may contain only actions; `fetch` works in the default runtime (actions only). | Everything runs in the default runtime. Moss (native binary) would need a `"use node"` action. |
| `convex-test` | [convex-test docs](https://docs.convex.dev/testing/convex-test), installed 0.0.65 | `t.fetch(path, init)` calls HTTP routes; `finishAllScheduledFunctions(vi.runAllTimers)`; text search has simplified semantics (no relevance order); limits not enforced. `import.meta.glob` must include `_generated/*.js`. | Ranking is done in our code (`src/retrieval/rank.ts`) so results are deterministic in tests. |
| Bundling of test files | `convex/dist/cjs/bundler` | Files whose names contain more than one dot are skipped as entry points. | `convex/test.setup.ts` and `*.test.ts` are never deployed. |
| Typed env (`defineApp({ env })`) | Guidelines | Supported in 1.44+. | **Not used**: `src/config/env.ts` parses `process.env` with zod so the same code runs in tests and scripts. Revisit if it causes friction. |
| Codegen without deploy | `npx convex codegen --help`, `npx convex function-spec` | Codegen regenerates `_generated/` and does not change deployed code (verified: the dev deployment still lists no functions). | The skeleton has **not** been pushed to the dev deployment. |

### Moss

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| Packages | npm registry; [moss.dev](https://www.moss.dev/) | JS: **`@moss-dev/moss`** 1.7.1 (`@inferedge/moss` stopped at 1.0.0-beta.8). Python: `moss`. JS depends on `@moss-dev/moss-core`, native per-platform binaries (incl. `linux-x64-gnu`), `node >= 20.4`. | Moss can only run in a `"use node"` action with the package in `convex.json` `node.externalPackages`. Not installed in the skeleton. |
| API | moss.dev, [Python API](https://docs.moss.dev/docs/reference/python/api.md) | `new MossClient(projectId, projectKey)`; `createIndex(name, docs, { modelId })`, `loadIndex(name)`, `query(name, text, { topK })`; models `moss-minilm` (default), `moss-mediumlm`. Python docs show metadata filters (`$eq`, `$in`, …). | Placeholder in `src/providers/moss/`. |
| Cold load in an action | Not documented | Query latency claims: ~1–10 ms after `loadIndex`; load time not stated. | **Unverified.** Measure before relying on Moss in the call path; the retriever falls back to Convex. |

### Apify

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| Run actor, dataset | [API v2](https://docs.apify.com/api/v2) | `POST /v2/actors/{actorId}/runs`, `Authorization: Bearer <token>`; `GET /v2/datasets/{id}/items`; sync variant `run-sync-get-dataset-items` (≤ 300 s). | `src/providers/apify/`. |
| Webhooks | [ad-hoc webhooks](https://docs.apify.com/platform/integrations/webhooks/ad-hoc-webhooks), [actions](https://docs.apify.com/platform/integrations/webhooks/actions) | Ad-hoc webhooks: base64 JSON array in the `webhooks` query param; events `ACTOR.RUN.SUCCEEDED/FAILED/TIMED_OUT/…`; payload template with `{{resource.*}}`; may be delivered more than once; **no signature** — the docs suggest a secret in the URL. Headers template exists, but its JSON key name (`headersTemplate`) was not shown verbatim. | `/ingest/apify` accepts the secret as `X-Soterra-Webhook-Secret` header **or** `?secret=` query param. Handler must be idempotent (TODO(I)). |
| X actor | [apidojo/tweet-scraper](https://apify.com/apidojo/tweet-scraper) | "Tweet Scraper V2": from $0.40 per 1,000 tweets, pay per event; min 50 tweets per query, max 1 concurrent run, "no monitoring" (don't repeat the same query at short intervals), free plan can't use it via API. X's own terms not addressed. | X ingestion stays P2; polling one query repeatedly conflicts with the actor's rules. Needs a paid Apify plan. |

### Official feeds

| Feed | Source | Finding |
| --- | --- | --- |
| NWS alerts | [weather.gov API docs](https://www.weather.gov/documentation/services-web-api); live request 2026-10-24 | `GET https://api.weather.gov/alerts/active?area=CA`, no key, **User-Agent required**, GeoJSON. Live response confirmed fields: `id`, `sent`, `effective`, `onset`, `expires`, `ends`, `status`, `messageType`, `severity`, `event`, `headline`, `description`, `instruction`, `areaDesc`, `geocode.UGC`, `geocode.SAME`, `references`, `parameters.VTEC`. `id` changes on each update. The `web` field is a generic homepage; use `@id` as the URL. |
| USGS | [GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | `/earthquakes/feed/v1.0/summary/{2.5_hour,all_day,…}.geojson`, updated every minute; times are epoch ms. |
| OpenFEMA | [API docs](https://www.fema.gov/about/openfema/api) | `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries`, no key, OData-style `$filter`, `$top` ≤ 10000. |
| NHC | [GIS page](https://www.nhc.noaa.gov/gis/), live `CurrentStorms.json` | `https://www.nhc.noaa.gov/CurrentStorms.json` → `activeStorms[]` with product links. Not formally documented. |
| Tsunami.gov | [tsunami.gov](https://www.tsunami.gov/) | CAP and Atom: `/events/xml/PAAQCAP.xml` (NTWC), `/events/xml/PHEBCAP.xml` (PTWC). |
| InciWeb | [feeds](https://inciweb.wildfire.gov/feeds) | RSS `https://inciweb.wildfire.gov/incidents/rss.xml`. |
| NIFC / WFIGS | Catalog mirrors + live query 2026-10-24 | `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query` returns GeoJSON (`POOState` = `US-CA`). The official NIFC open-data page did not render for us, so the URL comes from catalog mirrors (it answered live). |
| DisasterAssistance.gov | Homepage | No API found; scrape (via Apify) if needed. |

## Decisions

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-24 | Repo root had only Convex setup and docs, no conflicting app: the skeleton was built in place on branch `skeleton/shared-codebase`. | §0 of the setup prompt. |
| 2026-10-24 | Orchestration lives in the backend; the voice agent only forwards turns. | Lets the backend enforce grounding, danger and memory rules deterministically. |
| 2026-10-24 | `src/` is Convex-free; `convex/` files are thin. The turn pipeline takes its dependencies as functions. | Unit-testable without Convex; owners can replace pieces independently. |
| 2026-10-24 | Danger check is regex-based, checks English and Spanish patterns on every turn, and runs before retrieval and the LLM. The model may also flag safety, but the spoken wording is always the fixed phrase. | Rule 3. |
| 2026-10-24 | Grounding: an `answer` must cite a chunk retrieved in this turn with trust `official`/`official_social`; otherwise it becomes `no_info` and the question is recorded. Every answer ends with a spoken "That's from <source>, issued/updated <time> <zone>." unless the reply already names the source. | Rules 1 and 2, enforced in code. |
| 2026-10-24 | Caller ID is `identity: "caller_id"`. On that basis the model sees only language and county-level area; stored needs and past summaries reach the model only for `verified_account`. | Rule 5. Owners may relax this deliberately. |
| 2026-10-24 | Unverified (X) content is stored as bulletins but never chunked, never indexed, never triggers events or crisis mode. | Rule 4. |
| 2026-10-24 | `upsertBulletins` returns an extra per-item change value, `"rejected"` (item quarantined), with `reason`. | Validation failures must be visible to the caller of the mutation. |
| 2026-10-24 | Content hash is a synchronous 53-bit string hash (cyrb53) over content fields, computed in `finalizeBulletin`. Fixture files omit `contentHash`. | Works in every Convex runtime and in tests; only compared within one bulletin's history. |
| 2026-10-24 | `primaryState` = first area's state, or `"US"` for national items with no area. | Search filter field; areas are never invented. |
| 2026-10-24 | The ranking step (`src/retrieval/rank.ts`) re-applies expiry, trust and fixture filters and scores by term overlap, area match, severity and freshness. | Defence in depth; deterministic under convex-test. |
| 2026-10-24 | The MockLlm only answers when a chunk contains every proper noun in the question (e.g. "Hillcrest Elementary"). | Makes "I don't know yet" testable without a real model. |
| 2026-10-24 | Follow-up subscriptions expire after 7 days; the spoken confirmation says so. | No "stop calls" flow exists yet, so the reply must not promise one. |
| 2026-10-24 | Python `TurnResponse.kind` is a plain string. | A new reply kind must not crash a live call. |
| 2026-10-24 | `package-lock.json` was regenerated (npm optional-dependency bug left out the macOS x64 rolldown binding needed by Vitest 5). | `npm install` must work on every teammate's machine. |
| 2026-10-24 | `/health` is public. | It exposes only integration status and flags, and the voice agent's first task is to reach it. |

## Still unverified (owners)

- `cartesia deploy` accepting new agents before the Dec 1, 2026 shutdown (V).
- Whether outbound `dynamic_variables` reach `CallRequest.metadata`, and `from_`/`to` on outbound calls (V).
- `pre_call_handler` `stt` config key (V).
- Live behaviour of the Cartesia outbound adapter and its auth header (B, reviewed by V).
- Moss cold-load time inside a `"use node"` action (B).
- ~~Apify `headersTemplate` key name~~ verified 2026-10-24 (ingestion pass below). A live Apify run against the mock sites is still pending (I).
- Anthropic adapter against a real key and its latency with Haiku 5.5 (B).
- `Intl` time-zone formatting on the deployed Convex runtime (works in tests; falls back to UTC if not).

## Ingestion pass (2026-10-24, branch `ingestion/pipeline`)

### Verified

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| Apify run endpoint | [Run Actor](https://docs.apify.com/api/v2/actors-runs-post), [API overview](https://docs.apify.com/api/v2) | Canonical path is `POST /v2/actors/{actorId}/runs`; "The `/v2/acts/` prefix is deprecated but still fully functional". Body = actor input. Query: `webhooks` (base64 JSON array), `maxItems`, `maxTotalChargeUsd`, `timeout`, `memory`. Actor id `username~actorName`. Response 201 `data.id`, `data.defaultDatasetId`. | We use `/v2/actors/` (the ingestion brief said `/v2/acts/`; the docs prefer `/actors/`). Every run is capped with `maxItems` and `maxTotalChargeUsd`. |
| Ad-hoc webhook keys | [ad-hoc webhooks](https://docs.apify.com/platform/integrations/webhooks/ad-hoc-webhooks), [actions](https://docs.apify.com/platform/integrations/webhooks/actions), `apify-client` 2.25.0 `webhook.d.ts` | Keys `eventTypes`, `requestUrl`, `payloadTemplate`, `idempotencyKey`, and **`headersTemplate?: string`** (confirmed in the official client types). Default payload `{userId, createdAt, eventType, eventData, resource}`; run events carry `eventData.actorRunId`; `resource` is the run object (with `defaultDatasetId`). Events include `ACTOR.RUN.SUCCEEDED/FAILED/TIMED_OUT/ABORTED`. Unsigned; retried up to 11 times; may be delivered more than once. | We send the secret in `X-Soterra-Webhook-Secret` via `headersTemplate` (query `?secret=` also accepted), and our `payloadTemplate` echoes `soterra.runRecordId` so the receiver finds its run without a race. The receiver is idempotent per run. |
| Dataset items | [Get dataset items](https://docs.apify.com/api/v2/dataset-items-get) | `GET /v2/datasets/{id}/items`, `format=json` (default), `clean=true` = skip empty and hidden (`#`) fields, `limit`. Bearer auth recommended. | `?clean=true&format=json&limit=N`. |
| Actors | [Website Content Crawler](https://apify.com/apify/website-content-crawler), [Cheerio Scraper](https://apify.com/apify/cheerio-scraper), [Tweet Scraper V2](https://apify.com/apidojo/tweet-scraper) | WCC: `startUrls`, `crawlerType` (raw-HTTP option labelled "Raw HTTP client (Cheerio)"), `maxCrawlPages`, `maxCrawlDepth` (0 = start URLs only); items `url`, `text`, `metadata.title`, `crawl.loadedTime`; ≈ $0.2/1,000 pages raw HTTP. Cheerio Scraper: `startUrls`, `pageFunction(context)` with `$`, `request`; `maxPagesPerCrawl` (0 = unlimited); one dataset item per returned object; platform usage only. Tweet Scraper V2: `twitterHandles`, `searchTerms`, `maxItems`, `sort`; items `id`, `url`, `text`, `createdAt` ("Fri Nov 24 17:49:36 +0000 2023"), `author.userName`, `isRetweet`; from $0.40/1,000 tweets; ≥ 50 tweets per query; 1 concurrent run; no repeated queries at short intervals; no API use on the free plan. | Free text → WCC + extraction; structured shelter list → Cheerio + our page function + deterministic parser; X wired but fixture-only. **Unverified:** the exact `crawlerType` value string `"cheerio"` (the page shows labels, not values). |
| Convex limits | [limits](https://docs.convex.dev/production/state/limits) | Per mutation: 16,000 documents / 16 MiB written, 32,000 documents scanned, 4,096 index ranges, 1 s of user code; documents ≤ 1 MiB; ≤ 1,000 scheduled functions per mutation; actions 30 min (Convex runtime) / 10 min (Node). | Upserts in batches of 25 items (≲ 10 writes each); geometry > 50,000 chars to file storage. |
| `CONVEX_SITE_URL` in functions | [environment variables](https://docs.convex.dev/production/environment-variables) | `CONVEX_CLOUD_URL` and `CONVEX_SITE_URL` "are always available in Convex functions". | Webhook URL `${CONVEX_SITE_URL}/ingest/apify`; mock-site URLs for live actors. |
| File storage | [store files](https://docs.convex.dev/file-storage/store-files) | `ctx.storage.store(blob)` from actions returns `Id<"_storage">`. | Raw payloads (24 h TTL, hourly purge cron) and large geometry are stored from actions; mutations only delete. |
| NWS cancellations, live | Live `api.weather.gov/alerts/active?area=AK`, 2026-10-24 | Some cancellations arrive as `messageType: "Alert"` whose VTEC actions are all `CAN` ("The Winter Storm Watch has been cancelled."). Updates carry earlier ids in `references` with their `sent` times. | NWS adapter: Cancel messages **and** all-CAN/EXP VTEC alerts are `cancelled`; Update/Cancel `issuedAt` = earliest referenced `sent`, `updatedAt` = this `sent`. |
| Live feed shapes | Live fetch of every direct feed, normalized in Node | NWS (88 alerts across 5 states), OpenFEMA (21), WFIGS (64), InciWeb (7), NHC (1), Tsunami.gov CAP (1): **0 rejections**. InciWeb `description` holds "Last updated: YYYY-MM-DD" (date only), "The type of incident is …", "State: …"; `pubDate` can be years old (incident creation). Tsunami.gov CAP is a single `<alert>`. | InciWeb: state from "State:", prescribed burns skipped, date-only "Last updated" not turned into a timestamp. |

### Decisions

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-24 | Ingestion settings live in `src/ingestion/config.ts` (own env parsing), not in the backend's `src/config/env.ts`. | Ingestion must not edit backend files. |
| 2026-10-24 | Additive contract fields: `timeBasis`, `supersedesExternalIds` on `NormalizedBulletin`; `timeBasis` on `bulletins` and `chunks`; new `Signal` schema and `signals` table. `ExtractionResult` is deprecated (unused). | Required by the ingestion brief; additive and optional. |
| 2026-10-24 | The extraction model returns **quotes only**; code derives hazard type, severity and page time from verified quotes. | Nothing the model writes reaches callers unless it is literally in the source. |
| 2026-10-24 | Deterministic extraction mock in `src/ingestion/extractionMock.ts` (flagged). | The backend's `MockLlm` returns `{items: []}` for extraction. |
| 2026-10-24 | X routing by `X_ALLOWLIST` (configuration), one `x_posts` source with trust tier `official_social`; non-allowlisted posts → `signals`. Retweets skipped. | Trust from configuration, never content. |
| 2026-10-24 | Fixture bulletins trigger crisis mode only when `SERVE_FIXTURES=true`. | A demo deployment should behave like a real one; fictional data must not change polling on a real one. |
| 2026-10-24 | Mock-site pages get `incidentKey` from the verified title ("Ridgeview Fire: …" → `ridgeview-fire`). | Lets callback subscriptions match ingested page updates; derived only from quoted text. |
| 2026-10-24 | Shelter bulletins are one per row, built only from labeled cell values; a row without a status is rejected. | Never say a shelter is open unless the source says so. |
| 2026-10-24 | Raw-payload storage is best effort (logged, never fails a run). | It exists only for debugging. |
| 2026-10-24 | WFIGS: `FireDiscoveryDateTime` = issued; `ModifiedOnDateTime_dt` = updated (or `page_updated` basis when there is no discovery time). NHC: no units or movement restated (the file does not state units); severity from classification (HU severe, TS/STS moderate, others minor). | No invented facts. |

### Still unverified (ingestion)

- A live Apify run end to end (no `APIFY_TOKEN` here): `npm run ingest:apify-mock-sites` on the dev deployment.
- WCC `crawlerType: "cheerio"` value and Cheerio `request.loadedUrl` in the page function.
- Live fetches from inside a deployed Convex action (verified only from Node).
