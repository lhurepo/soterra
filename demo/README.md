# Demo calamity

`calamity.json` is the fictional disaster. Every item has `isFixture: true`, which is the "this is demo data" mark.

- `npm run demo:trigger` publishes it now (timestamps are set to the current time).
- `npm run demo:reset` deletes exactly the bulletins listed in `calamity.json` (and only if marked `isFixture`).

Run them in a loop as often as you like. Callers only hear demo data when the deployment has `SERVE_FIXTURES=true`.
