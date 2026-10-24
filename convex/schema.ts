// [S] Convex schema. Sections are marked by owner; only add indexes that code actually uses.
// Limits to respect: documents ≤ 1 MiB (large raw payloads and geometry go to file storage),
// search filters are equality only, no wall-clock reads inside queries.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  areaCandidate,
  areaRef,
  bulletinStatus,
  callerContext,
  citation,
  hazardType,
  notificationChannel,
  notificationStatus,
  replyKind,
  runOutcome,
  severity,
  subscriptionTrigger,
  timeBasis,
  trustTier,
} from "./validators";

export default defineSchema({
  // ───────────── [B] Identity and memory ─────────────
  /** One row per caller phone number (E.164). Minimal memory; never an account and never personal details. */
  callers: defineTable({
    phone: v.string(),
    language: v.optional(v.string()),
    knownArea: v.optional(areaRef),
    lastCallSummaryId: v.optional(v.id("callSummaries")),
    /** Public incident keys cited on the last call (safe to use on caller ID alone). */
    lastIncidentKeys: v.optional(v.array(v.string())),
    lastCallAt: v.number(),
    /** Anonymous memory expiry (ANON_MEMORY_TTL_DAYS after the last call); unset while linked to a verified account. */
    expiresAt: v.optional(v.number()),
  })
    .index("by_phone", ["phone"])
    .index("by_expiresAt", ["expiresAt"]),

  /** Future app users (iOS). Auth is TODO(B). Needs live here, on the account profile, never on callers. */
  accounts: defineTable({
    tokenIdentifier: v.optional(v.string()),
    displayName: v.optional(v.string()),
    preferredLanguage: v.optional(v.string()),
    needs: v.optional(v.array(v.string())),
    createdAt: v.number(),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  /** A call is associated with an account only through a VERIFIED phone link. */
  phoneLinks: defineTable({
    accountId: v.id("accounts"),
    phone: v.string(),
    verifiedAt: v.optional(v.number()),
  }).index("by_phone", ["phone"]),

  // ───────────── [B] Calls ─────────────
  /** The session. */
  calls: defineTable({
    provider: v.literal("cartesia"),
    providerCallId: v.string(),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    status: v.union(v.literal("active"), v.literal("ended"), v.literal("finalized")),
    callerId: v.optional(v.id("callers")),
    callerPhone: v.optional(v.string()),
    calledPhone: v.optional(v.string()),
    accountId: v.optional(v.id("accounts")),
    language: v.string(),
    transcriptConsent: v.union(v.literal("notice_given"), v.literal("declined")),
    knownArea: v.optional(areaRef),
    notificationId: v.optional(v.id("notifications")),
    /** Caller context built once at session start (src/memory/callerContext.ts). */
    callerContext: v.optional(callerContext),
    /** Active bulletin area labels for place-name matching, refreshed every few minutes. */
    areaCandidates: v.optional(v.array(areaCandidate)),
    areaCandidatesAt: v.optional(v.number()),
    startedAt: v.number(),
    lastActivityAt: v.number(),
    endedAt: v.optional(v.number()),
    endReason: v.optional(
      v.union(v.literal("caller_hangup"), v.literal("agent_end"), v.literal("transfer"), v.literal("error"), v.literal("timeout")),
    ),
    finalizedAt: v.optional(v.number()),
    /** The greeting returned at session start (a repeated start returns the same text). */
    greeting: v.optional(v.string()),
    /** Anonymous calls only, set at finalize: when the turns are deleted, and when the call row and summary go. */
    transcriptExpiresAt: v.optional(v.number()),
    memoryExpiresAt: v.optional(v.number()),
    safetyFlag: v.optional(v.boolean()),
  })
    .index("by_providerCallId", ["providerCallId"])
    .index("by_status_and_lastActivityAt", ["status", "lastActivityAt"])
    .index("by_transcriptExpiresAt", ["transcriptExpiresAt"])
    .index("by_memoryExpiresAt", ["memoryExpiresAt"])
    .index("by_accountId_and_startedAt", ["accountId", "startedAt"])
    .index("by_callerId_and_startedAt", ["callerId", "startedAt"]),

  /** One row per caller utterance; the assistant reply is stored on the same row once produced. */
  callTurns: defineTable({
    callId: v.id("calls"),
    turnIndex: v.number(),
    utterance: v.string(),
    language: v.string(),
    receivedAt: v.number(),
    interruptedPrevious: v.optional(v.boolean()),
    status: v.union(v.literal("pending"), v.literal("complete")),
    reply: v.optional(v.string()),
    replyLanguage: v.optional(v.string()),
    kind: v.optional(replyKind),
    citations: v.optional(v.array(citation)),
    endCall: v.optional(v.boolean()),
    /** The caller barged in over this turn's reply (set when the next turn arrives with interruptedPrevious). */
    interrupted: v.optional(v.boolean()),
    unansweredQuestionId: v.optional(v.id("unansweredQuestions")),
    subscriptionId: v.optional(v.id("subscriptions")),
    degraded: v.optional(v.boolean()),
    errorCode: v.optional(v.string()),
    retriever: v.optional(v.string()),
    retrievedAt: v.optional(v.number()),
    llmModel: v.optional(v.string()),
    areaSource: v.optional(v.string()),
    retrievedChunkIds: v.optional(v.array(v.id("chunks"))),
    citedChunkIds: v.optional(v.array(v.id("chunks"))),
    /** Copied from the cited chunks, which are rewritten when a bulletin updates. */
    citedIncidentKeys: v.optional(v.array(v.string())),
    citedHazards: v.optional(v.array(hazardType)),
    timingsMs: v.optional(v.record(v.string(), v.number())),
  }).index("by_callId_and_turnIndex", ["callId", "turnIndex"]),

  callSummaries: defineTable({
    callId: v.id("calls"),
    callerId: v.optional(v.id("callers")),
    accountId: v.optional(v.id("accounts")),
    summary: v.string(),
    language: v.string(),
    topics: v.array(v.string()),
    areasMentioned: v.array(areaRef),
    hazards: v.array(hazardType),
    unansweredQuestionIds: v.array(v.id("unansweredQuestions")),
    followUpsRequested: v.array(v.string()),
    safetyFlag: v.boolean(),
    model: v.string(),
    /** True when the LLM failed and the deterministic summary was stored instead. */
    fallback: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_callId", ["callId"])
    .index("by_callerId", ["callerId"]),

  unansweredQuestions: defineTable({
    callId: v.id("calls"),
    turnIndex: v.number(),
    callerId: v.optional(v.id("callers")),
    text: v.string(),
    language: v.string(),
    area: v.optional(areaRef),
    status: v.union(v.literal("open"), v.literal("answered"), v.literal("dismissed")),
    createdAt: v.number(),
    answeredAt: v.optional(v.number()),
    answerText: v.optional(v.string()),
    answerSourceUrl: v.optional(v.string()),
    answerSourceName: v.optional(v.string()),
    answerBulletinId: v.optional(v.id("bulletins")),
  })
    .index("by_callId_and_turnIndex", ["callId", "turnIndex"])
    .index("by_status", ["status"]),

  // ───────────── [I] Ingestion ─────────────
  /** One row per source: the SourceDefinition plus mode and run bookkeeping. Synced from src/ingestion/sources.ts. */
  sources: defineTable({
    sourceId: v.string(),
    name: v.string(),
    kind: v.union(v.literal("official_api"), v.literal("official_web"), v.literal("social")),
    trustTier,
    fetchVia: v.union(v.literal("direct"), v.literal("apify")),
    normalIntervalMin: v.number(),
    crisisIntervalMin: v.number(),
    enabled: v.boolean(),
    regionStates: v.array(v.string()),
    endpoint: v.optional(v.string()),
    /** Optional only so rows written by the skeleton (before modes existed) still validate; absent = "fixture". */
    mode: v.optional(v.union(v.literal("fixture"), v.literal("live"))),
    lastRunAt: v.optional(v.number()),
    nextDueAt: v.optional(v.number()),
    lastOutcome: v.optional(runOutcome),
    consecutiveFailures: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    /** @deprecated Skeleton field, superseded by lastRunAt. Kept so existing rows validate. */
    lastFetchedAt: v.optional(v.number()),
  }).index("by_sourceId", ["sourceId"]),

  /** Latest state of each official item, keyed by (sourceId, externalId). */
  bulletins: defineTable({
    sourceId: v.string(),
    externalId: v.string(),
    sourceName: v.string(),
    url: v.string(),
    title: v.string(),
    body: v.string(),
    hazardType,
    severity,
    status: bulletinStatus,
    issuedAt: v.number(),
    updatedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    incidentKey: v.optional(v.string()),
    trustTier,
    language: v.string(),
    contentHash: v.string(),
    latestVersion: v.number(),
    isActive: v.boolean(),
    isFixture: v.boolean(),
    primaryState: v.string(),
    geometry: v.optional(v.string()),
    geometryStorageId: v.optional(v.id("_storage")),
    timeBasis: v.optional(timeBasis),
  })
    .index("by_sourceId_and_externalId", ["sourceId", "externalId"])
    .index("by_isActive_and_expiresAt", ["isActive", "expiresAt"]),

  /** Every external id seen for a bulletin (NWS Update/Cancel messages get new ids that reference old ones). */
  bulletinAliases: defineTable({
    sourceId: v.string(),
    externalId: v.string(),
    bulletinId: v.id("bulletins"),
  }).index("by_sourceId_and_externalId", ["sourceId", "externalId"]),

  /** Full history: one row per distinct content version (the normalized payload, minus geometry). */
  bulletinVersions: defineTable({
    bulletinId: v.id("bulletins"),
    versionNumber: v.number(),
    contentHash: v.string(),
    payload: v.string(),
    createdAt: v.number(),
  }).index("by_bulletinId_and_versionNumber", ["bulletinId", "versionNumber"]),

  /** Retrieval units for the LATEST version of each bulletin, with denormalized metadata for citations. */
  chunks: defineTable({
    bulletinId: v.id("bulletins"),
    versionNumber: v.number(),
    chunkIndex: v.number(),
    text: v.string(),
    sourceId: v.string(),
    sourceName: v.string(),
    url: v.string(),
    trustTier,
    hazardType,
    severity,
    issuedAt: v.number(),
    updatedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    incidentKey: v.optional(v.string()),
    isActive: v.boolean(),
    isFixture: v.boolean(),
    primaryState: v.string(),
    timeBasis: v.optional(timeBasis),
  })
    .index("by_bulletinId", ["bulletinId"])
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["isActive", "primaryState", "isFixture"],
    }),

  /** Area-first lookup: every area of every active bulletin. */
  bulletinAreas: defineTable({
    bulletinId: v.id("bulletins"),
    state: v.string(),
    countyFips: v.optional(v.string()),
    nwsZone: v.optional(v.string()),
    label: v.string(),
    isActive: v.boolean(),
  })
    .index("by_bulletinId", ["bulletinId"])
    .index("by_isActive_and_state", ["isActive", "state"])
    .index("by_isActive_and_countyFips", ["isActive", "countyFips"])
    .index("by_isActive_and_nwsZone", ["isActive", "nwsZone"]),

  bulletinEvents: defineTable({
    bulletinId: v.id("bulletins"),
    incidentKey: v.optional(v.string()),
    change: v.union(v.literal("created"), v.literal("updated"), v.literal("cancelled")),
    versionNumber: v.number(),
    severityBefore: v.optional(severity),
    severityAfter: severity,
    createdAt: v.number(),
    matchedAt: v.optional(v.number()),
  }).index("by_bulletinId", ["bulletinId"]),

  quarantine: defineTable({
    sourceId: v.string(),
    externalId: v.optional(v.string()),
    reason: v.string(),
    /** Truncated raw item for debugging; full raw payloads belong in file storage. */
    rawExcerpt: v.string(),
    createdAt: v.number(),
    runId: v.optional(v.id("ingestionRuns")),
  }),

  /** Unverified posts kept only as signals: never bulletins, never chunked, never retrievable. */
  signals: defineTable({
    sourceId: v.string(),
    platform: v.literal("x"),
    externalId: v.string(),
    url: v.string(),
    authorHandle: v.string(),
    text: v.string(),
    postedAt: v.optional(v.number()),
    observedAt: v.number(),
    /** postedAt when known, else observedAt: the time used for burst windows. */
    signalAt: v.number(),
    hazardTypes: v.array(hazardType),
    states: v.array(v.string()),
    /** First of `states` (or "US"): indexed for burst detection. */
    primaryState: v.string(),
    isFixture: v.boolean(),
  })
    .index("by_externalId", ["externalId"])
    .index("by_primaryState_and_signalAt", ["primaryState", "signalAt"]),

  /** One row per source run. Every run ends with a recorded outcome. */
  ingestionRuns: defineTable({
    sourceId: v.string(),
    trigger: v.union(v.literal("tick"), v.literal("manual"), v.literal("signal_burst"), v.literal("escalation")),
    mode: v.union(v.literal("fixture"), v.literal("live")),
    status: v.union(v.literal("running"), v.literal("awaiting_apify"), v.literal("processing"), v.literal("succeeded"), v.literal("failed")),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    apifyRunId: v.optional(v.string()),
    apifyDatasetId: v.optional(v.string()),
    apifyEventType: v.optional(v.string()),
    counts: v.optional(
      v.object({
        fetched: v.number(),
        created: v.number(),
        updated: v.number(),
        unchanged: v.number(),
        cancelled: v.number(),
        rejected: v.number(),
        skipped: v.number(),
        signals: v.number(),
      }),
    ),
    mossSync: v.optional(v.union(v.literal("skipped"), v.literal("ok"), v.literal("failed"))),
    error: v.optional(v.string()),
  })
    .index("by_apifyRunId", ["apifyRunId"])
    .index("by_sourceId", ["sourceId"]),

  /** Raw fetched payloads, kept briefly in file storage for debugging (RAW_PAYLOAD_TTL_HOURS). */
  rawPayloads: defineTable({
    sourceId: v.string(),
    runId: v.id("ingestionRuns"),
    storageId: v.id("_storage"),
    url: v.string(),
    contentType: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  }).index("by_expiresAt", ["expiresAt"]),

  systemState: defineTable({
    key: v.literal("global"),
    mode: v.union(v.literal("normal"), v.literal("crisis")),
    reason: v.string(),
    triggeredByBulletinId: v.optional(v.id("bulletins")),
    since: v.number(),
    expiresAt: v.optional(v.number()),
    /** When a signal burst last triggered an early poll of official sources. */
    lastSignalPollAt: v.optional(v.number()),
  }).index("by_key", ["key"]),

  /** Every crisis-mode change, for the log. */
  systemModeLog: defineTable({
    mode: v.union(v.literal("normal"), v.literal("crisis")),
    reason: v.string(),
    triggeredByBulletinId: v.optional(v.id("bulletins")),
    expiresAt: v.optional(v.number()),
    at: v.number(),
  }),

  // ───────────── [B] Follow-ups (optional) ─────────────
  subscriptions: defineTable({
    recipient: v.object({
      callerId: v.optional(v.id("callers")),
      accountId: v.optional(v.id("accounts")),
      phone: v.string(),
    }),
    target: v.object({
      kind: v.union(v.literal("incident"), v.literal("area"), v.literal("question")),
      incidentKey: v.optional(v.string()),
      area: v.optional(areaRef),
      unansweredQuestionId: v.optional(v.id("unansweredQuestions")),
    }),
    trigger: subscriptionTrigger,
    channels: v.array(notificationChannel),
    language: v.string(),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("cancelled"), v.literal("expired")),
    consentAt: v.number(),
    createdVia: v.union(v.literal("call"), v.literal("app")),
    expiresAt: v.number(),
    lastNotifiedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    createdFromCallId: v.optional(v.id("calls")),
  })
    .index("by_status_and_targetIncidentKey", ["status", "target.incidentKey"])
    .index("by_status_and_targetKind", ["status", "target.kind"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"])
    .index("by_targetUnansweredQuestionId", ["target.unansweredQuestionId"])
    .index("by_recipientPhone_and_status", ["recipient.phone", "status"])
    .index("by_recipientCallerId_and_status", ["recipient.callerId", "status"])
    .index("by_recipientAccountId", ["recipient.accountId"]),

  /** Every notification attempt, including rate-limited ones (status "failed", error "rate_limited"). */
  notifications: defineTable({
    subscriptionId: v.optional(v.id("subscriptions")),
    recipientPhone: v.string(),
    channel: notificationChannel,
    language: v.string(),
    message: v.string(),
    bulletinRefs: v.array(v.id("bulletins")),
    dedupeKey: v.string(),
    status: notificationStatus,
    providerRef: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_subscriptionId_and_createdAt", ["subscriptionId", "createdAt"])
    .index("by_providerRef", ["providerRef"]),

  // ───────────── [S] Dev only ─────────────
  /** Mock HTML pages served at /mock-sites/* when ENABLE_MOCK_SITES=true, so Apify can scrape a real URL. */
  mockSites: defineTable({
    path: v.string(),
    /** v1 = initial state; v2 = escalated (one zone warning → order, shelter capacity changed). */
    /** Absent on rows seeded by the skeleton: treated as v1. */
    variant: v.optional(v.union(v.literal("v1"), v.literal("v2"))),
    contentType: v.string(),
    body: v.string(),
    updatedAt: v.number(),
  }).index("by_path_and_variant", ["path", "variant"]),

  /** Dev-only key/value settings (e.g. the active mock-site variant). */
  devSettings: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),
});
