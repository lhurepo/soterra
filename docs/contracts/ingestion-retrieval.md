# Ingestion and retrieval contract

[S] Written by **[I]** (Dhweya), read by **[B]**. Source of truth: `src/contracts/ingestion.ts`, `src/contracts/orchestration.ts`, and the tables in `convex/schema.ts`. How the module works: [docs/ingestion.md](../ingestion.md).

```
Convex cron "ingestion tick" (1 min) → due sources (normal vs crisis interval, Apify ≥ 5 min, backoff)
  → internal.ingestion.runSource
      direct: fixture | live fetch → adapter.normalize                       (NWS, USGS, FEMA, NHC, Tsunami, InciWeb, WFIGS)
      apify:  start actor run + ad-hoc webhook → POST /ingest/apify → processApifyRun → dataset items
              → deterministic parser (structured pages) | LLM extraction with verified quotes (free text)
              → X: allowlisted → official_social bulletin; everything else → signals table only
  → NormalizedBulletin (finalizeBulletin adds contentHash) → validate → quarantine on failure
  → internal.ingestion.upsertBatch (≤ 25 items): dedupe (incl. lineage) → version → chunks + bulletinAreas
      → bulletinEvents → crisis evaluation
  → Moss sync (best effort) → run outcome (ingestionRuns, sources.lastOutcome, backoff)
  → retrieval: internal.retrieval.search (Convex search + area-first) → rank → RetrievedChunk[]
  → bulletinEvents → subscriptions.matchEvents → notifications (optional)
```

## Types

**`AreaRef`** — `state` (USPS), `county?`, `countyFips?` (5 digits), `city?`, `zip?`, `nwsZone?` (UGC like `CAZ504`), `label` (speakable).

**`SourceDefinition`** — `sourceId`, `name`, `kind` (`official_api` · `official_web` · `social`), `trustTier` (`official` · `official_social` · `unverified`), `fetchVia` (`direct` · `apify`), `normalIntervalMin`, `crisisIntervalMin`, `enabled`, `regionStates`, `endpoint?`. Registry: `src/ingestion/sources.ts` (adds `mode`, `jurisdiction`, Apify actor config), synced to the `sources` table by `npx convex run sources:syncRegistry`. Every source starts **disabled** and in **fixture** mode.

**`NormalizedBulletin`** — `sourceId`, `sourceName`, `externalId`, `url`, `title`, `body`, `instructions?`, `hazardType`, `severity` (`extreme` · `severe` · `moderate` · `minor` · `unknown`), `status` (`actual` · `test` · `exercise` · `cancelled`), `issuedAt`, `updatedAt?`, `effectiveAt?`, `expiresAt?`, `areas: AreaRef[]`, `geometry?` (GeoJSON string), `incidentKey?`, `trustTier`, `language`, `contentHash`, `isFixture`, and (additive, 2026-10-24):

- **`timeBasis?`** — `"issued"` (default when absent): the source's publication time. `"page_updated"`: the page's own "last updated"/"checked at" time. `"observed"`: the source published no time, so `issuedAt` is when Soterra fetched it — speak it as "as of when we checked at 3:05 PM", and imply nothing else. Also stored on `bulletins` and `chunks`.
- **`supersedesExternalIds?`** — earlier message ids this one updates or cancels (NWS `references`). `upsertBulletins` follows them (via `bulletinAliases`) so one alert lineage is one bulletin with versions.

`hazardType`: `wildfire` · `flood` · `hurricane` · `tornado` · `earthquake` · `tsunami` · `winter_storm` · `extreme_heat` · `evacuation` · `shelter` · `road_closure` · `other`.

Rules (enforced by `src/ingestion/validate.ts`, `src/ingestion/pipeline.ts` and `upsertBulletins`):

- Items without `url`, `issuedAt` or source are **rejected to `quarantine`** with the reason. Timestamps and areas are never invented: if a feed has no area, `areas` is `[]` and the bulletin is filed under `primaryState: "US"`.
- **Trust tier and `isFixture` come from the source definition and the run**, whatever an adapter or model produced. Fixture data is labeled "(Demo)".
- `test` and `exercise` items are stored but never active (no chunks). `cancelled` deactivates the bulletin, removes its chunks and emits a `cancelled` event.
- `contentHash` covers content fields only (title, body, instructions, hazard, severity, status, expiry, incident key, areas) — never fetch or update times — so refetching an unchanged item is a no-op.
- Geometry over 50,000 characters goes to file storage (`bulletins.geometryStorageId`); documents are capped at 1 MiB.

## Storage operation

`internal.ingestion.upsertBulletins({ items: NormalizedBulletin[] })` → per item `{ bulletinId, versionNumber, change, reason? }` with `change` = `created` · `updated` · `unchanged` · `cancelled` · `rejected`. The pipeline uses `internal.ingestion.upsertBatch` (same behaviour, plus changed/removed chunk ids for Moss). Keep calls to ≤ 25 items.

For each created/updated/cancelled item it: writes the `bulletins` row (latest state; the first external id of a lineage stays the bulletin's `externalId`, later ids become `bulletinAliases`), appends a `bulletinVersions` row, deletes and rewrites `chunks` and `bulletinAreas`, writes a `bulletinEvents` row (`severityBefore`/`severityAfter`), and evaluates crisis mode. After the batch it schedules `subscriptions.matchEvents`.

## Chunks and retrieval

Chunks are ~800–1,200 characters on paragraph boundaries. **Every chunk starts with a one-sentence header** — title, issuer, area labels, time and its basis — with no internal `.`, `!` or `?`, e.g.:

> Evacuation Warning for the Ridgeview Fire — Sonoma County Emergency Management (Demo) — Sonoma County zones SON-3A and SON-3B — issued October 24 at 1:45 PM Pacific. An Evacuation Warning is in effect…

Basis phrasing in the header: `issued …[, updated …]`, `page last updated …`, `no published time, as observed when Soterra checked …`.

`chunks` rows carry denormalized `sourceName`, `url`, `trustTier`, `hazardType`, `severity`, `issuedAt`, `updatedAt`, `expiresAt`, `incidentKey`, `isActive`, `isFixture`, `primaryState`, `timeBasis`, plus `bulletinId`, `versionNumber`, `chunkIndex`, `text`.

`internal.retrieval.search({ text, area?, topK, now, serveFixtures })` (backend-owned) returns `RetrievedChunk[]` from the search index `search_text` (filters `isActive`, `primaryState`, `isFixture`) plus the area-first lookup through `bulletinAreas` (county FIPS, NWS zone, state), then ranks. Ingestion keeps both populated; a test ingests the mock shelter page and finds it through this query by area and by text, with `isFixture` filtering per `serveFixtures`.

**Unverified content is never chunked**, so it can never be retrieved.

## Bulletin events

`BulletinEvent` — `bulletinId`, `incidentKey?`, `change` (`created` · `updated` · `cancelled`), `versionNumber`, `severityBefore?`, `severityAfter`, `createdAt` (+ `matchedAt` once the matcher ran). Not written for `unverified` items, for unchanged content, for cancellations of something never stored, or for expiry.

## Signals (additive, 2026-10-24)

`signals` table / `Signal` schema: `sourceId`, `platform: "x"`, `externalId`, `url`, `authorHandle`, `text`, `postedAt?`, `observedAt`, `hazardTypes`, `states` (+ `signalAt`, `primaryState`, `isFixture`). Posts from accounts not on `X_ALLOWLIST`. **Never bulletins, never chunked, never retrievable, never a crisis trigger.** A burst (≥ `SIGNAL_BURST_THRESHOLD` signals naming a hazard and a configured state within `SIGNAL_BURST_WINDOW_MIN`) schedules one early poll of enabled official sources (`trigger: "signal_burst"`). Read them with `internal.signals.recent` (operators only).

## Crisis mode

One `systemState` row: `{ key: "global", mode, reason, triggeredByBulletinId?, since, expiresAt?, lastSignalPollAt? }`; every change is logged in `systemModeLog`. Trigger (evaluated after every upsert, `src/ingestion/crisis.ts`): an active, official, `status: "actual"` bulletin in `INGEST_STATES` with severity `extreme`/`severe`, or a title naming an evacuation order, tsunami/hurricane/fire/storm surge warning, flash flood or tornado emergency, extreme wind warning. Fixture bulletins count only when `SERVE_FIXTURES=true` (a demo deployment). Lasts 6 hours; the tick extends it while the triggering bulletin is still active and triggering, and reverts it on its own afterwards. Manual override: `npx convex run systemState:setMode '{"mode":"crisis","reason":"drill","durationMin":60}'`.

## Unstructured sources

LLM extraction (`src/ingestion/extract.ts`, `CLAUDE_SMART_MODEL`, one call per page, timeout, no retries): the page is wrapped in `<untrusted_document>` and the model returns **quotes only** (title, body quotes, instructions, hazard and severity evidence, area quotes, page-updated quote). Code checks each quote is literally in the page; failing optional fields are dropped, a failing title or body sends the item to `quarantine`. Hazard type, severity and page time are derived by code from verified quotes. Fields the model adds (e.g. `trustTier`) are ignored.

## Expiry

Cron "bulletin expiry" (5 min) flips `isActive` off for bulletins past `expiresAt` and removes their chunks and area rows (no event).

## Status for /health

`internal.ingestionRuns.sourceStatus` → per source `{ sourceId, enabled, mode, fetchVia, lastRunAt, nextDueAt, lastOutcome, consecutiveFailures, lastSuccessAt, lastError }`.
