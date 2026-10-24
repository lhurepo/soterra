# Fixtures

Everything here is **fictional demo data** ("Ridgeview Fire", Sonoma County, CA). Source names end in "(Demo)" and every normalized item has `isFixture: true`. Callers only hear fixture data when the deployment has `SERVE_FIXTURES=true`.

| Folder | What | Used by |
| --- | --- | --- |
| `contracts/` | Golden request/response JSON for every contract, plus `invalid/` cases. `manifest.json` maps each file to its schema. | `tests/contracts.test.ts`, `voice/tests/test_models.py` |
| `normalized/` | `NormalizedBulletin` drafts (no `contentHash`; `finalizeBulletin` adds it). `ridgeview-initial.json` is the scenario; `ridgeview-update.json` upgrades zone SON-3A to an Evacuation **Order**. | `npm run seed:fixtures`, `npm run inject:update`, Convex tests |
| `raw/` | One sample per real feed, shaped like the real API response (fictional content): NWS (Alert, Update with `references`, Cancel, Test), USGS, OpenFEMA, NHC, WFIGS as JSON; Tsunami.gov CAP and InciWeb RSS as JSON envelopes `{url, contentType, body}` holding the raw XML. Fixture mode of each direct source reads these. | `src/ingestion/adapters/*`, `tests/adapters.test.ts` |
| `mock-sites/v1`, `mock-sites/v2` | HTML for the scraped sources. v2 escalates zone SON-3A from warning to order and changes shelter capacity. Served at `/mock-sites/<file>` (active variant) when `ENABLE_MOCK_SITES=true` so a cloud Apify actor can scrape a reachable URL. | `npm run seed:fixtures`, `npm run ingest:escalate` |
| `apify/v1`, `apify/v2` | Mock Apify dataset items, shaped exactly like the actor output (Website Content Crawler, Cheerio Scraper with our page function), matching the mock-site HTML of the same variant (checked by `tests/fixtures-sync.test.ts`). | MockApify (`APIFY_MODE=mock`) |
| `social/` | X posts shaped like Tweet Scraper V2 items: an allowlisted official account, unverified accounts (a signal burst), a prompt-injection attempt and a retweet. | `x_posts` source |
| `conversations/` | Scripted calls: utterances plus the expected reply `kind` per turn. | `npm run sim:call`, Convex end-to-end test |

Deliberately missing fact: nothing says whether **Hillcrest Elementary** is a shelter, so that question must get "I don't know yet".

The Red Flag Warning expires 2026-11-15; bump `expiresAt` if you demo after that.
