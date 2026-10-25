# Marina Earthquake demo (run from the terminal)

The only data source in use for the Cal Hacks demo. Everything else (real scrapers, real X, the old Sonoma
"Ridgeview Fire" fixtures) is **offline** on the dev deployment: the pipeline code stays, but no source is
enabled and no other bulletin is served. Do not re-enable sources unless the user asks.

## Run it

```bash
npm run demo:start     # clean slate → calm pages for 5 s → earthquake pages → real Apify crawls
npm run demo:status    # is it on, and each site's crawl: status, seconds, counts
npm run demo:stop      # reset to the beginning (run before every new attempt; start also resets)
npm run demo:offline   # switch every source off and take every non-demo bulletin out of service
```

`npm run demo:start -- --delay 10000` changes the calm period (milliseconds).

Start the demo when the caller dials. The first callback comes once the crawls land, measured with
`demo:status`. Crawls typically take 15–40 s per site and the 13 sites run in two waves.

## The story

A M6.4 earthquake hits the Palace of Fine Arts during Cal Hacks judging (the "Marina Earthquake").
The caller is studying at the **Marina Branch Library, San Francisco** (inside the evacuation zone) and has a
friend at the hackathon.

1. The caller feels the shaking, calls **+1 712 600 3362**, says they are in **San Francisco** (saying the city
   matters: it sets their area) and asks what happened. There is no data yet, so the agent says so.
2. The caller asks to be called back when there is news ("call me back when you know what happened").
3. About 30–60 s later, Soterra calls back with the Evacuation Order for the Marina District, the first official
   update in San Francisco.
4. On that call: "am I in an evacuation zone?" (yes: north of Lombard Street, Van Ness Avenue to Lyon Street),
   "where is the nearest shelter?" (Hamilton Recreation Center, 1900 Geary Boulevard), and "is everyone at the
   Palace of Fine Arts OK?" (SF Fire: all Cal Hacks attendees and staff are accounted for).
5. After the call, a text arrives (the SMS work, `SMS_NOTIFIER`).

## How it works

- `demo/scenario.ts`: the 13 sites, each with a calm `before` page and an earthquake `after` page, with times
  computed from the start of the run. The pages are short on purpose: one fact per sentence, a
  "Last updated: <date>, <time> PDT" line, and a tab title equal to the headline, so extraction quotes them cleanly.
  - SF Emergency Management: Evacuation Order (`sfdemo_alerts`, the page that drives the callback) and Situation
    Update. Also USGS, SF Fire, shelters (a table), SFMTA, Caltrans, BART, PG&E, SF water, Red Cross, and the
    tsunami center ("no threat").
  - The mock X feed (`sfdemo_x`): 30 hacker posts (robot dog, Iron Man, "#PalaceOfFineArts is in ruins"). These
    are unverified **signals**, never spoken. There are also 5 posts from fictional official accounts
    (`DEMO_X_ACCOUNTS`), which become `official_social` bulletins.
- `convex/demo.ts`:
  - `start`: resets the demo data, runs `takeOffline`, writes the pages to `mockSites` and serves v1 (calm).
    After the delay, `escalate` switches to v2 and `crawlWave` starts the real Apify runs in two waves.
  - `stop`: resets the demo data, cancels the subscriptions and deletes the update notifications created since
    the run started, sets crisis mode back to normal and the pages back to calm.
  - Unused, but available: `POST /demo/start`, `POST /demo/stop` and `GET /demo/status`, with Bearer `DEMO_SECRET`.
- Pages are served at `https://brazen-perch-21.convex.site/mock-sites/sf/<page>.html` (`ENABLE_MOCK_SITES=true`).
  The content crawler pages go through Claude extraction (`LLM_PROVIDER=anthropic`). The shelter page and the X
  feed use Cheerio page functions (`src/providers/apify/actors.ts`).
- The callback works because a "call me back" question keeps the caller's area, so the first official update
  in San Francisco answers it (`src/notifications/match.ts`). Saying "San Francisco" resolves to the county even
  before any bulletin mentions it (`speakableCounties`).

## Needs on the deployment

`SERVE_FIXTURES=true`, `ENABLE_MOCK_SITES=true`, `APIFY_TOKEN`, `APIFY_WEBHOOK_SECRET`, `LLM_PROVIDER=anthropic`.

`PHONE_NOTIFIER=cartesia` means **real calls**. The callback rings every active subscription that matches
San Francisco, including subscriptions for all of California from earlier real calls. Before a run, make sure
only people who agreed are subscribed.

## Known limits

- Crawl times are not measured yet. Run `demo:start` once and read `demo:status` before demoing.
- Stopping while crawls are in flight: their results can land after the reset. Wait about a minute, or run
  `demo:stop` again, before the next start.
- Tests: `tests/demo.test.ts` (every page through the adapters and extraction) and `convex/tests/demo.test.ts`
  (the switch). The Apify page functions themselves are only exercised by a live run.
