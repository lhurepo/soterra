// [S] Scheduled jobs. Each is harmless when nothing is configured (all sources start disabled).
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// [I] Decides which sources are due (normal vs crisis intervals) and schedules their fetches.
crons.interval("ingestion tick", { minutes: 1 }, internal.ingestion.tick, {});
// [I] Flips isActive off for bulletins past expiresAt.
crons.interval("bulletin expiry", { minutes: 5 }, internal.ingestion.expireBulletins, {});
// [I] Deletes raw fetched payloads past RAW_PAYLOAD_TTL_HOURS.
crons.interval("raw payload purge", { hours: 1 }, internal.ingestion.purgeRawPayloads, {});
// [B] Finalizes calls that never sent /voice/session/end.
crons.interval("stale session sweeper", { minutes: 5 }, internal.calls.sweepStaleSessions, {});
// [B] Retention: deletes anonymous transcripts past ANON_TRANSCRIPT_TTL_HOURS.
crons.cron("retention purge", "0 11 * * *", internal.memory.purgeExpired, {});

export default crons;
