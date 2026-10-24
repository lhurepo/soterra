// [B] Caller memory rules. A phone number is not an account: caller ID can be spoofed.
// - buildCallerContext assembles what the backend knows (cached on the call at session start).
// - toLlmContext is the policy filter: on caller ID alone the model sees language, a county-level area,
//   public incidents asked about recently and active update topics. Stored needs and past-summary text
//   reach the model only for a call that is verified: linked to an account, or a callback we placed to the
//   caller's own number (verified_phone, that call only). Nothing here is ever read back.
import type { AreaRef, CallerContext } from "../contracts";
import { DEFAULTS } from "../config/defaults";

export type CallerContextSources = {
  callerId?: string;
  accountId?: string;
  language: string;
  knownArea?: AreaRef;
  /** Needs come only from a verified account's profile, never from caller memory. */
  accountNeeds?: string[];
  /** This call is our own callback to the caller's number: they hold the phone. */
  verifiedPhone?: boolean;
  /** Things the caller asked us to remember by voice; used only when verifiedPhone. */
  profileNeeds?: string[];
  lastSummary?: { text: string; createdAt: number };
  lastCallAt?: number;
  lastIncidentKeys?: string[];
  activeSubscriptions?: { kind: "incident" | "area" | "question"; incidentKey?: string; areaLabel?: string; trigger: string }[];
  now: number;
};

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

export function subscriptionTopic(s: NonNullable<CallerContextSources["activeSubscriptions"]>[number]): string {
  const target = s.kind === "incident" ? `incident ${s.incidentKey ?? "?"}` : s.kind === "area" ? `area ${s.areaLabel ?? "?"}` : "an unanswered question";
  return `${target} (${s.trigger.replace(/_/g, " ")})`;
}

/** ≈ 300 tokens at most: the summary, needs and lists are clipped. */
export function buildCallerContext(src: CallerContextSources): CallerContext {
  const phoneVerified = !src.accountId && src.verifiedPhone === true && src.callerId !== undefined;
  const identity: CallerContext["identity"] = src.accountId
    ? "verified_account"
    : phoneVerified
      ? "verified_phone"
      : src.callerId
        ? "caller_id"
        : "anonymous";
  const needs = src.accountId
    ? [...new Set([...(src.accountNeeds ?? []), ...(src.profileNeeds ?? [])])]
    : phoneVerified
      ? src.profileNeeds
      : undefined;
  const recent = (at: number | undefined) => at !== undefined && src.now - at <= DEFAULTS.lastSummaryTtlMs;
  const context: CallerContext = {
    callerId: src.callerId,
    accountId: src.accountId,
    identity,
    language: src.language,
    knownArea: src.knownArea,
    needs: needs?.length ? needs.slice(0, 5).map((n) => clip(n, 80)) : undefined,
    lastCallSummary: src.lastSummary && recent(src.lastSummary.createdAt) ? clip(src.lastSummary.text, 600) : undefined,
    activeSubscriptions: src.activeSubscriptions?.length ? src.activeSubscriptions.slice(0, 3).map((s) => clip(subscriptionTopic(s), 80)) : undefined,
    recentIncidentKeys: recent(src.lastCallAt) && src.lastIncidentKeys?.length ? src.lastIncidentKeys.slice(0, 3) : undefined,
  };
  // Strip undefined keys so the cached copy validates against the stored schema.
  return Object.fromEntries(Object.entries(context).filter(([, v]) => v !== undefined)) as CallerContext;
}

/** Rough size check used by tests: ≈ 4 characters per token. */
export function approxTokens(context: CallerContext): number {
  return Math.ceil(JSON.stringify(context).length / 4);
}

/** What the model may see. */
export function toLlmContext(context: CallerContext): CallerContext {
  if (context.identity === "verified_account" || context.identity === "verified_phone") return context;
  const area = context.knownArea;
  return {
    callerId: context.callerId,
    identity: context.identity,
    language: context.language,
    // County-level area only: it scopes retrieval and is not a personal detail.
    knownArea: area ? { state: area.state, county: area.county, countyFips: area.countyFips, label: area.label } : undefined,
    activeSubscriptions: context.activeSubscriptions,
    recentIncidentKeys: context.recentIncidentKeys,
  };
}
