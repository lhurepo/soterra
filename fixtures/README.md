# Fixtures

Everything here is **fictional demo data** ("Ridgeview Fire", Sonoma County, CA). Source names end in "(Demo)" and every normalized item has `isFixture: true`. Callers only hear fixture data when the deployment has `SERVE_FIXTURES=true`.

| Folder | What | Used by |
| --- | --- | --- |
| `contracts/` | Golden request/response JSON for every contract, plus `invalid/` cases. `manifest.json` maps each file to its schema. | `tests/contracts.test.ts`, `voice/tests/test_models.py` |
| `normalized/` | `NormalizedBulletin` drafts (no `contentHash`; `finalizeBulletin` adds it). `ridgeview-initial.json` is the scenario; `ridgeview-update.json` upgrades zone SON-3A to an Evacuation **Order**. | `npm run seed:fixtures`, `npm run inject:update`, Convex tests |
| `raw/` | One sample per real feed, shaped like the real API response (fictional content). For adapter work. | `[I]` adapter tests (to write) |
| `mock-sites/` | HTML pages for the scraped sources. Served at `/mock-sites/<file>` when `ENABLE_MOCK_SITES=true` so a cloud Apify actor can scrape a reachable URL. | `npm run seed:fixtures`, Apify work |
| `social/` | Mock X posts from an allowlisted official account and from an unverified account. | X ingestion work |
| `conversations/` | Scripted calls: utterances plus the expected reply `kind` per turn. | `npm run sim:call`, Convex end-to-end test |

Deliberately missing fact: nothing says whether **Hillcrest Elementary** is a shelter, so that question must get "I don't know yet".

The Red Flag Warning expires 2026-11-15; bump `expiresAt` if you demo after that.
