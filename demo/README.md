# Marina Earthquake demo (run from the terminal)

The only data source in use for the Cal Hacks demo. Everything else (real scrapers, real X, the old Sonoma
"Ridgeview Fire" fixtures) is **offline** on the dev deployment: the pipeline code stays, but no source is
enabled and no other bulletin is served. Do not re-enable sources unless the user asks.

## Run it

```bash
npm run demo:start     # clean slate → wave 1 calm crawls → "calm ready" → Enter: wave 1 earthquake, then one wave-2 site each
npm run demo:control   # reopen the control panel (closing it with q leaves the demo running)
npm run demo:status    # is it on, the counts, and each site's crawl: status, seconds, counts
npm run demo:stop      # reset to the beginning (run before every new attempt; start also resets)
npm run demo:offline   # switch every source off and take every non-demo bulletin out of service
```

`demo:start` stays open as a control panel, redrawn in place:

```
11 done (5 calm, 6 escalation)
1 in progress (1 escalation)
6 sources remaining (6 escalation)

[Enter] next crawl: SFMTA   [q] close (the demo keeps running)
```

The 13 sites are in two waves (`wave` in `demo/scenario.ts`). Wave 1: Evacuation Order, USGS, SF Fire, shelters, X feed.
Wave 2: the other 8. Wave 1 is crawled twice (calm, then escalation), so the counts cover 18 crawls: 5 calm + 13 escalation.
If the panel cannot reach Convex it says "Not updating" with the age of the counts on screen.

1. Run `demo:start` **before** the call and wait for **calm ready**. Wave 1's 5 calm pages are crawled together, which takes
   about 15–40 s, and the terminal beeps. Calm bulletins that land before the caller asks for a callback cannot trigger it.
2. Take the call. The agent answers from the calm pages ("no active emergency alerts").
3. Press **Enter** once: every page switches to the earthquake (times from that moment) and wave 1 is crawled again.
   The Evacuation Order updates its calm bulletin, and that update triggers the callback.
4. Each later Enter crawls the next wave-2 site (shown as `next:`). While wave 1 holds all 5 Apify slots, or if you press
   Enter several times quickly, the extra crawls wait for a free slot (counted as in progress).

Failed crawls count as done and are listed as failed. Crawls typically take 15–40 s per site; at most 5 Apify runs
at once (the plan's limit), and a run Apify refuses for the limit is queued again.

`npm run demo:start -- --auto` is the old flow with no key presses: no calm crawls, the pages switch after 5 s
(`--delay 10000` changes it, in milliseconds) and all 13 sites are crawled. The HTTP button also uses it.

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
    `crawlNext` is the queue for real Apify runs, 5 at a time (it checks every 2 s for a free slot).
    - Manual (`start({ manual: true })`, the terminal): `crawlNext` phase `calm` crawls wave 1's v1 pages. The first
      `release` (Enter) rewrites the v2 pages with times from that moment, switches to them and releases wave 1; each
      later release adds one wave-2 site.
    - Auto (the default for the mutation and the button): after the delay, `escalate` switches to v2 and `crawlNext` crawls every site.
  - `progress`: every crawl of the run as done / in progress / remaining, split calm and escalation (the control panel
    polls it).
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
- Calm crawls are real Apify runs and Claude extractions too: 5 more per attempt.
- Stopping while crawls are in flight is safe: results from a stopped or earlier run are dropped when they land
  (`acceptsResult`, shown in `demo:status` as failed "dropped: late result"). Apify itself still finishes those runs, so
  they can hold concurrency slots for up to ~40 s after a restart; the queue just waits for them.
- Tests: `tests/demo.test.ts` (every page through the adapters and extraction) and `convex/tests/demo.test.ts`
  (the switch). The Apify page functions themselves are only exercised by a live run.
