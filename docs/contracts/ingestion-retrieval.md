# Ingestion and retrieval contract

[S] Written by **[I]** (Dhweya), read by **[B]**. Source of truth: `src/contracts/ingestion.ts`, `src/contracts/orchestration.ts`, and the tables in `convex/schema.ts`.

```
Convex cron "ingestion tick" (1 min) → due sources (normal vs crisis interval)
  → internal.ingestion.fetchSource → adapter.run()            official APIs: direct fetch
  → Apify actor run → POST /ingest/apify → processApifyRun     scraped pages, X (TODO(I))
  → NormalizedBulletinDraft → finalizeBulletin (contentHash) → validate
  → internal.ingestion.upsertBulletins(items)
       dedupe (sourceId, externalId) + contentHash → version → chunks + bulletinAreas → bulletinEvents
  → retrieval: internal.retrieval.search (Convex search + area-first) → rank → RetrievedChunk[]
  → bulletinEvents → subscriptions.matchEvents → notifications (optional)
```

## Types

**`AreaRef`** — `state` (USPS), `county?`, `countyFips?` (5 digits), `city?`, `zip?`, `nwsZone?` (UGC like `CAZ504`), `label` (speakable).

**`SourceDefinition`** — `sourceId`, `name`, `kind` (`official_api` · `official_web` · `social`), `trustTier` (`official` · `official_social` · `unverified`), `fetchVia` (`direct` · `apify`), `normalIntervalMin`, `crisisIntervalMin`, `enabled`, `regionStates`, `endpoint?`. Registry: `src/ingestion/registry.ts`, synced to the `sources` table by `npx convex run sources:syncRegistry`. Every source starts **disabled**; enable with `npx convex run sources:setEnabled '{"sourceId":"nws_alerts","enabled":true}'`.

**`NormalizedBulletin`** — `sourceId`, `sourceName`, `externalId`, `url`, `title`, `body`, `instructions?`, `hazardType`, `severity` (`extreme` · `severe` · `moderate` · `minor` · `unknown`), `status` (`actual` · `test` · `exercise` · `cancelled`), `issuedAt`, `updatedAt?`, `effectiveAt?`, `expiresAt?`, `areas: AreaRef[]`, `geometry?` (GeoJSON string), `incidentKey?`, `trustTier`, `language`, `contentHash`, `isFixture`.

`hazardType`: `wildfire` · `flood` · `hurricane` · `tornado` · `earthquake` · `tsunami` · `winter_storm` · `extreme_heat` · `evacuation` · `shelter` · `road_closure` · `other`.

Rules (enforced by `src/ingestion/validate.ts` and `upsertBulletins`):

- Items without `url`, `issuedAt` or source are **rejected to `quarantine`** with the reason. Timestamps and areas are never invented: if a feed has no area, `areas` is `[]` and the bulletin is filed under `primaryState: "US"`.
- `externalId` must be **stable across updates** of the same item (for NWS, key on the VTEC event, not `properties.id`).
- `test` and `exercise` items are stored but never served. `cancelled` deactivates the bulletin.
- `contentHash` covers content fields only (title, body, instructions, hazard, severity, status, expiry, areas), so refetching an unchanged item is a no-op.
- Geometry over ~500 KB is rejected for now; large shapes belong in file storage (TODO(I)). Documents are capped at 1 MiB.
- Live sources are never fixtures: `fetchSource` forces `isFixture: false`.

## Storage operation

`internal.ingestion.upsertBulletins({ items: NormalizedBulletin[] })` → per item `{ bulletinId, versionNumber, change, reason? }` with `change` = `created` · `updated` · `unchanged` · `cancelled` · `rejected`.

For each created/updated/cancelled item it: writes the `bulletins` row (latest state), appends a `bulletinVersions` row (full payload JSON), deletes and rewrites `chunks` and `bulletinAreas` for the latest version, writes a `bulletinEvents` row, and may switch on crisis mode. After the batch it schedules `subscriptions.matchEvents`. Chunking today is naive (one title-prefixed chunk per paragraph, `src/ingestion/chunk.ts`). Dev seeding uses the same function.

Batch size: keep calls to ≤ 50 items (one mutation transaction).

## Chunks and retrieval

`chunks` rows carry denormalized `sourceName`, `url`, `trustTier`, `hazardType`, `severity`, `issuedAt`, `updatedAt`, `expiresAt`, `incidentKey`, `isActive`, `isFixture`, `primaryState`, plus `bulletinId`, `versionNumber`, `chunkIndex`, `text`.

`internal.retrieval.search({ text, area?, topK, now, serveFixtures })` returns `RetrievedChunk[]`:

1. **Search**: Convex search index `search_text` on `chunks.text`, filtered `isActive = true`, `primaryState = area.state` (when known), `isFixture = false` (unless serving fixtures). Query text is reduced to ≤ 16 content terms.
2. **Area-first**: `bulletinAreas` by county FIPS, else NWS zone, else state (all `isActive`) → chunks of those bulletins. Works for non-English callers, since most bulletins are English.
3. **Rank** (`src/retrieval/rank.ts`): drop expired, unverified and (unless allowed) fixture chunks; score by term overlap + area match + severity + freshness; top K.

`now` is an argument: queries never read the clock.

**Unverified content is never chunked**, so it can never be retrieved. Moss (optional) mirrors active chunks with metadata; retrieval must still re-check trust, expiry and fixture flags on hydrated results.

## Bulletin events

`BulletinEvent` — `bulletinId`, `incidentKey?`, `change` (`created` · `updated` · `cancelled`), `versionNumber`, `severityBefore?`, `severityAfter`, `createdAt` (+ `matchedAt` once the matcher ran). Not written for `unverified` items.

## Crisis mode

One `systemState` row: `{ key: "global", mode: "normal" | "crisis", reason, triggeredByBulletinId?, since, expiresAt? }`. The tick uses each source's `crisisIntervalMin` while in crisis. Trigger (stub, `src/ingestion/crisis.ts`): an active, official, non-fixture bulletin in `INGEST_STATES` with severity `extreme`/`severe`, or a title like evacuation order, tsunami warning, hurricane warning, fire warning, flash flood emergency. Lasts 6 hours, then reverts on its own. Manual override: `npx convex run systemState:setMode '{"mode":"crisis","reason":"drill","durationMin":60}'`.

## Unstructured sources

LLM extraction (`src/ingestion/extract.ts`) uses `CLAUDE_SMART_MODEL`. Output must validate against `ExtractionResult`, and **every field quotes the source span** that supports it; `verifyQuotes` rejects the extraction if any quote is not literally in the source. Failures go to `quarantine`. Scraped text is untrusted data, never instructions (see the injected comment in `fixtures/mock-sites/county-emergency.html`).

X: posts from `X_OFFICIAL_ALLOWLIST` → `official_social`; everything else → `unverified` (stored as a signal only; may later shorten polling intervals of official sources; never answers callers).

## Expiry

Cron "bulletin expiry" (5 min) flips `isActive` off for bulletins past `expiresAt` and removes their chunks and area rows.
