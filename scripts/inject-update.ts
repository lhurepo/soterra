// [S, improved by B] npm run inject:update — applies the escalation fixture (zone SON-3A: Warning → Order) through
// the ingestion contract (internal.ingestion.upsertBulletins). That emits a real bulletinEvent, the matcher queues
// a notification for anyone who asked "call me if it changes", and the notifier (mock by default) delivers it.
import { finalizeBulletin } from "../src/ingestion/normalize";
import type { NormalizedBulletinDraft } from "../src/contracts";
import { convexRun, readJson } from "./lib/env";

const drafts = readJson<NormalizedBulletinDraft[]>("fixtures/normalized/ridgeview-update.json");
const results = convexRun("ingestion:upsertBulletins", { items: drafts.map(finalizeBulletin) });
console.log(JSON.stringify(results, null, 2));
console.log('\nExpect change "updated" above (a second run is "unchanged" and notifies nobody).');

await new Promise((r) => setTimeout(r, 3_000));
const recent = convexRun("notifications:recent", { limit: 5 }) as { status: string; recipientPhone: string; message: string; createdAt: number; error?: string }[];
console.log(`\nMost recent notifications (${recent.length}):`);
for (const n of recent) {
  console.log(`- ${new Date(n.createdAt).toISOString()} ${n.status}${n.error ? ` (${n.error})` : ""} → ${n.recipientPhone}: ${n.message}`);
}
