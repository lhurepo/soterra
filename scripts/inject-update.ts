// [S] npm run inject:update — applies the escalation fixture (zone SON-3A: Warning → Order). Exercises change
// detection, bulletin events, and callbacks for anyone who asked "call me if it changes".
import { seedFixtureSet } from "./seed-fixtures";

const results = seedFixtureSet("ridgeview-update.json", false);
console.log(JSON.stringify(results, null, 2));
console.log("\nExpect change \"updated\" above. Subscriptions for ridgeview-fire-demo get a notification row (mock notifier by default).");
