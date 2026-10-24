// [I] Tsunami.gov CAP adapter. GET https://www.tsunami.gov/events/xml/PAAQCAP.xml (NTWC; PTWC is PHEBCAP.xml)
// returns one CAP 1.2 <alert> (live-verified 2026-10-24). Areas only from state names in the message.
import { z } from "zod";
import type { AreaRef, NormalizedBulletinDraft, Severity } from "../../contracts";
import tsunamiFixture from "../../../fixtures/raw/tsunami-cap.json";
import { STATE_NAMES, statesNamedIn } from "../geo";
import { parseFeedTime } from "../time";
import { emptyResult, getRaw, type DirectAdapter, type NormalizeContext, type NormalizeResult, type RawResponse } from "./types";
import { elements, text } from "./xml";

export const TSUNAMI_URL = "https://www.tsunami.gov/events/xml/PAAQCAP.xml";

const Envelope = z.object({ url: z.string(), contentType: z.string(), body: z.string() });

const SEVERITY: Record<string, Severity> = { Extreme: "extreme", Severe: "severe", Moderate: "moderate", Minor: "minor", Unknown: "unknown" };

function statusOf(status: string | undefined, msgType: string | undefined): NormalizedBulletinDraft["status"] {
  if (status === "Exercise") return "exercise";
  if (status !== "Actual") return "test";
  return msgType === "Cancel" ? "cancelled" : "actual";
}

export function normalizeTsunami(raw: RawResponse[], ctx: NormalizeContext): NormalizeResult {
  const out = emptyResult();
  for (const r of raw) {
    if (r.kind !== "text") {
      out.rejected.push({ reason: "Tsunami.gov response is not text", raw: r.url });
      continue;
    }
    for (const alert of elements(r.body, "alert")) {
      const identifier = text(alert, "identifier");
      const sent = parseFeedTime(text(alert, "sent"));
      const info = elements(alert, "info")[0];
      if (!identifier || sent === undefined || info === undefined) {
        out.rejected.push({ externalId: identifier, reason: "CAP alert without identifier, sent or info", raw: alert.slice(0, 500) });
        continue;
      }
      const event = text(info, "event") ?? "Tsunami message";
      const headline = text(info, "headline");
      const description = text(info, "description") ?? "";
      const states = statesNamedIn(`${headline ?? ""} ${text(info, "areaDesc") ?? ""}`);
      const areas: AreaRef[] = states.map((state) => ({ state, label: STATE_NAMES[state] }));
      if (!areas.some((a) => ctx.ingestStates.includes(a.state))) {
        out.skipped++;
        continue;
      }
      const draft: NormalizedBulletinDraft = {
        sourceId: ctx.source.sourceId,
        sourceName: ctx.source.name,
        externalId: identifier,
        url: text(info, "web") ?? TSUNAMI_URL,
        title: headline ?? event,
        body: description,
        instructions: text(info, "instruction"),
        hazardType: "tsunami",
        severity: SEVERITY[text(info, "severity") ?? "Unknown"] ?? "unknown",
        status: statusOf(text(alert, "status"), text(alert, "msgType")),
        issuedAt: sent,
        expiresAt: parseFeedTime(text(info, "expires")),
        areas,
        incidentKey: text(alert, "incidents") ? `tsunami:${text(alert, "incidents")}` : undefined,
        trustTier: ctx.source.trustTier,
        language: "en",
        isFixture: ctx.isFixture,
        timeBasis: "issued",
      };
      out.drafts.push(draft);
    }
  }
  return out;
}

export const tsunamiAdapter: DirectAdapter = {
  sourceId: "tsunami_ntwc",
  fixture: () => {
    const env = Envelope.parse(tsunamiFixture);
    return [{ kind: "text", url: env.url, fetchedAt: 0, contentType: env.contentType, body: env.body }];
  },
  fetchLive: async (ctx, now) => [await getRaw(ctx, TSUNAMI_URL, "application/xml", "text", now)],
  normalize: normalizeTsunami,
};
