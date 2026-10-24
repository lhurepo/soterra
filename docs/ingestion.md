# Ingestion (owner: Dhweya)

Turns official US disaster sources into validated, deduplicated, versioned, chunked bulletins in Convex, which the backend's retrieval reads. Contract: [contracts/ingestion-retrieval.md](contracts/ingestion-retrieval.md). Verification notes: [DECISIONS.md](DECISIONS.md).

**Fixture mode is the default.** Every source runs from `fixtures/` with no network and no keys. Live mode is per source (`sources:setMode`) or, for all Apify sources at once, `APIFY_MODE=live`.

```
tick (1 min) ─▶ due sources (normal | crisis interval; Apify ≥ 5 min; exponential backoff on failure)
  └▶ ingestion:runSource ─┬─ direct: fixture() | fetchLive() ─▶ adapter.normalize ─┐
                          └─ apify:  startRun (+ ad-hoc webhook) ─▶ /ingest/apify ─▶ recordApifyEvent
                                     (MockApify simulates the webhook)            └▶ processApifyRun
                                     dataset items ─▶ deterministic parser | LLM extraction (quoted) ─┤
  raw payload → file storage (24 h) ◀────────────────────────────────────────────────────────────────┤
  prepareItems (trust tier + isFixture from the source) → quarantine rejects → large geometry → storage
  → upsertBatch ×N (≤ 25 items): dedupe/lineage → version → chunks + areas → bulletinEvents → crisis
  → signals (unverified X posts; bursts poll official sources early) → Moss sync (if configured)
  → finishRun (outcome, counts, backoff, nextDueAt)
```

## Sources

All start `enabled: false`, `mode: "fixture"`. Registry: `src/ingestion/sources.ts`; rows: `sources` table (`npx convex run sources:syncRegistry`).

| sourceId | Source / URL | Method | Trust | Normal / crisis (min) | Live status |
| --- | --- | --- | --- | --- | --- |
| `nws_alerts` | `https://api.weather.gov/alerts/active?area={STATE}` | direct, GeoJSON | official | 5 / 1 | **Live-ready** (verified; needs `NWS_USER_AGENT` with a contact) |
| `usgs_earthquakes` | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson` | direct, GeoJSON | official | 5 / 2 | Live-ready (verified) |
| `openfema_declarations` | `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=state eq '{STATE}'…` | direct, JSON | official | 60 / 30 | Live-ready (verified) |
| `nhc_storms` | `https://www.nhc.noaa.gov/CurrentStorms.json` | direct, JSON | official | 30 / 10 | Live-ready (verified; no US areas in the file) |
| `tsunami_ntwc` | `https://www.tsunami.gov/events/xml/PAAQCAP.xml` | direct, CAP XML | official | 5 / 1 | Live-ready (verified one `<alert>`) |
| `inciweb` | `https://inciweb.wildfire.gov/incidents/rss.xml` | direct, RSS | official | 30 / 10 | Live-ready (verified; state from "State:" line) |
| `nifc_wfigs` | WFIGS Incident Locations Current FeatureServer `…/query?where=POOState='US-{STATE}'&f=geojson` | direct, GeoJSON | official | 15 / 5 | Live-ready (URL from catalog mirrors; answered live) |
| `mock_county_emergency` | `{CONVEX_SITE_URL}/mock-sites/county-emergency.html` | Apify Website Content Crawler → LLM extraction | official (demo) | 30 / 5 | Live = real actor vs Convex-served page |
| `mock_shelters` | `{CONVEX_SITE_URL}/mock-sites/shelters.html` | Apify Cheerio Scraper → deterministic parser | official (demo) | 30 / 5 | Live = real actor vs Convex-served page |
| `mock_disaster_assistance` | `{CONVEX_SITE_URL}/mock-sites/disaster-assistance.html` | Apify Website Content Crawler → LLM extraction | official (demo) | 360 / 60 | Live = real actor vs Convex-served page |
| `x_posts` | Tweet Scraper V2 (`twitterHandles` = `X_ALLOWLIST`, search terms per state) | Apify | official_social (allowlist) / signals | 60 / 30 | Fixture only for now (paid actor; see cost notes) |

Mock-site sources are always `isFixture: true`, even when scraped live: their content is fictional.

"Live-ready": on 2026-10-24 each direct adapter fetched its live feed (from Node, with a contact User-Agent) and normalized it with **zero rejections** (NWS 88 alerts across CA/CO/AK/TX/FL, OpenFEMA 21 declarations, WFIGS 64 incidents, InciWeb 7, NHC 1, Tsunami.gov 1, USGS 0 above threshold that hour). That run found NWS cancellations sent as `messageType: "Alert"` with only CAN/EXP VTEC actions; the adapter now treats those as cancellations. Live fetches have not yet run inside a deployed Convex action.

## Scripts

| Command | What it does | Needs |
| --- | --- | --- |
| `npm run ingest:run -- --source <id> [--mode fixture\|live]` | Runs one source now; prints the outcome and counts. | Pushed deployment (`npx convex dev`) |
| `npm run ingest:escalate [-- --mode live]` | Switches the mock sites to **v2** (zone SON-3A warning → order, shelter capacity changes) and scrapes them now. Produces an `updated` bulletin event, so callbacks fire from ingested data. | Run the mock-site sources once on v1 first |
| `npm run ingest:apify-mock-sites` | Runs the three mock-site sources with **real Apify actors** against `/mock-sites/*`. | `APIFY_TOKEN`, `APIFY_WEBHOOK_SECRET`, `ENABLE_MOCK_SITES=true`, `npm run seed:fixtures` |
| `npm run seed:fixtures` | Also seeds both mock-site variants (v1, v2) for `/mock-sites/*`. | — |

Useful CLI calls:

```bash
npx convex run sources:syncRegistry
npx convex run sources:setEnabled '{"sourceId":"nws_alerts","enabled":true}'     # the tick now runs it
npx convex run sources:setMode '{"sourceId":"nws_alerts","mode":"live"}'
npx convex run ingestionRuns:sourceStatus                                          # per-source status (for /health)
npx convex run ingestionRuns:recentRuns '{"limit":10}'
npx convex run mockSites:setVariant '{"variant":"v1"}'                             # reset the demo
npx convex run systemState:setMode '{"mode":"crisis","reason":"drill","durationMin":30}'
npx convex run signals:recent
```

## Switching modes

- **Per source:** `sources:setMode` (`fixture` | `live`). `ingest:run --mode` overrides for one run.
- **All Apify sources:** `APIFY_MODE=live` (default `mock`). Live Apify needs `APIFY_TOKEN` and `APIFY_WEBHOOK_SECRET`; mock-site sources also need `ENABLE_MOCK_SITES=true`. The webhook URL is `${CONVEX_SITE_URL}/ingest/apify` (Convex sets `CONVEX_SITE_URL` automatically).
- **Extraction model:** `LLM_PROVIDER=anthropic` uses Claude (`CLAUDE_SMART_MODEL`, `EXTRACTION_TIMEOUT_MS`); otherwise a **deterministic extraction mock** in `src/ingestion/extractionMock.ts` (flagged: the backend's `MockLlm` returns no items for `purpose: "extraction"`).
- **Moss:** synced only when `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY` and `MOSS_INDEX_NAME` are set. Failures are recorded on the run (`mossSync: "failed"`) and never fail ingestion. The backend's sync function is still a placeholder, so today it records `failed` when configured.

Ingestion env vars (all optional): `APIFY_MODE`, `APIFY_MIN_INTERVAL_MIN` (5), `APIFY_MAX_ITEMS` (50), `APIFY_MAX_CHARGE_USD` (0.5), `USGS_MIN_MAGNITUDE` (3), `X_ALLOWLIST` (`handle:Issuer:CA|OR,…`), `SIGNAL_BURST_THRESHOLD` (3), `SIGNAL_BURST_WINDOW_MIN` (30), `BACKOFF_CAP_MIN` (60), `RAW_PAYLOAD_TTL_HOURS` (24), `EXTRACTION_TIMEOUT_MS` (20000), `EXTRACTION_MAX_CHARS` (12000).

## Rules this module enforces

- **No invented facts, times or areas.** Times come from the source; a page's own "last updated"/"checked at" time is `timeBasis: "page_updated"` (parsed only with a full date, clock time and zone); otherwise `issuedAt` is the fetch time with `timeBasis: "observed"`. Areas come from codes or names in the source, or from the source's configured jurisdiction.
- **Trust tier comes from the SourceDefinition** (`prepareItems` overwrites whatever an adapter or model produced). X routing is by `X_ALLOWLIST`, never by content.
- **Untrusted content is data.** Extraction prompts wrap the page in `<untrusted_document>` (the page cannot close it) and say to ignore instructions in it. The model only returns quotes; code checks every quote is literally in the page, drops failing optional fields, quarantines items whose title or body fail, and derives hazard type, severity and page time from verified quotes itself. Conditional sentences ("leave if an order is issued") never raise severity.
- `test`/`exercise` messages are stored inactive; cancellations deactivate the bulletin, remove its chunks and emit `cancelled`; expiry deactivates without an event.
- Fixture data is always `isFixture: true` and labeled "(Demo)".
- One failing source never blocks the others: each run is its own scheduled action and always ends with a recorded outcome.

## Apify actors and cost

| Use | Actor | Input we send | Cost / terms (Store pages, 2026-10-24) |
| --- | --- | --- | --- |
| Free-text pages | `apify~website-content-crawler` | `startUrls`, `crawlerType: "cheerio"`, `maxCrawlPages: 1`, `maxCrawlDepth: 0` | Free actor; platform usage ≈ $0.2 per 1,000 pages with the raw-HTTP crawler |
| Structured lists | `apify~cheerio-scraper` | `startUrls`, `pageFunction` (`SHELTER_PAGE_FUNCTION`), `maxPagesPerCrawl: 1` | Free actor; platform usage only |
| X posts | `apidojo~tweet-scraper` | `twitterHandles`, `searchTerms`, `sort: "Latest"`, `maxItems ≥ 50` | From $0.40 per 1,000 tweets (pay per event); ≥ 50 tweets per query; 1 concurrent run; no repeating the same query at short intervals; not usable via API on the free plan |

Every run is capped with `maxItems` and `maxTotalChargeUsd` (`APIFY_MAX_ITEMS`, `APIFY_MAX_CHARGE_USD`), and Apify sources never run more often than every `APIFY_MIN_INTERVAL_MIN` minutes, even in crisis mode.

## Known gaps

- **Live Apify is unexercised here:** no `APIFY_TOKEN` in this environment. The request shape follows the API docs and `apify-client` 2.25.0 types; `crawlerType: "cheerio"` and the Cheerio `request.loadedUrl` field are from the actor docs/README, not a live run. Run `npm run ingest:apify-mock-sites` once on the dev deployment.
- **X live mode** is wired but not recommended yet (paid actor, "no monitoring" term). Real official handles for `X_ALLOWLIST` are TODO.
- **DisasterAssistance.gov** (real site) has no API; only the mock page is configured. Add a real `website-content-crawler` source when a target page is chosen.
- **Geography:** the county gazetteer covers California only; other states get FIPS codes without names (`County 12086`). NHC storms have no US area (filed as national).
- **NWS** uses `references` for lineage; VTEC is used for `incidentKey` only.
- **Moss sync** depends on the backend's placeholder `syncChunksToMoss`.
- **timeBasis in speech:** the backend still says "issued <time>" for every chunk; observed and page-updated times need their own phrasing (see TEAM_PLAN changelog).
