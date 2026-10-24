// [B] Grounding enforcement, citation building and attribution (fresh and stale).
import { describe, expect, it } from "vitest";
import { t, tf } from "../src/config/strings";
import {
  attributionSentence,
  citationsFor,
  claimsAddressInZone,
  claimsShelterOpen,
  enforceGrounding,
  withAttribution,
} from "../src/orchestration/grounding";
import { NOW, answer, chunk, shelterChunk } from "./helpers";

const ground = (draft = answer(), retrieved = [chunk()], utterance = "q", language = "en", now = NOW) =>
  enforceGrounding({ draft, retrieved, utterance, language, now });

describe("citations", () => {
  it("are built from chunk metadata, one per bulletin", () => {
    const c2 = chunk({ chunkId: "c1b", chunkIndex: 1 });
    expect(citationsFor([chunk(), c2, shelterChunk()])).toEqual([
      { sourceName: "Sonoma County Emergency Management (Demo)", url: "https://example.org/evac", issuedAt: 1792874700000 },
      { sourceName: "Sonoma County Emergency Management (Demo)", url: "https://example.org/shelters", issuedAt: 1792875600000, updatedAt: 1792877400000 },
    ]);
  });
});

describe("attribution", () => {
  it("uses the canonical template with the local time", () => {
    const s = attributionSentence(chunk(), "en", NOW);
    expect(s).toBe(tf("attribution", "en", { source: "Sonoma County Emergency Management (Demo)", verb: t("issued", "en"), time: "October 24 at 1:45 PM Pacific" }));
  });

  it("does not call a scraped page 'issued': observed and page-updated times say what they are", () => {
    expect(attributionSentence(chunk({ timeBasis: "observed" }), "en", NOW)).toBe(
      "That's from Sonoma County Emergency Management (Demo), as of our last check on October 24 at 1:45 PM Pacific.",
    );
    expect(attributionSentence(chunk({ timeBasis: "page_updated" }), "en", NOW)).toBe(
      "That's from Sonoma County Emergency Management (Demo). The page was last updated on October 24 at 1:45 PM Pacific.",
    );
    expect(attributionSentence(chunk({ timeBasis: "observed" }), "es", NOW)).toMatch(/^Fuente: .+, según nuestra revisión del 24 de octubre/);
    expect(attributionSentence(chunk({ timeBasis: "issued" }), "en", NOW)).toMatch(/, issued October 24/);
  });

  it("says 'as of' when the newest cited source is older than three hours", () => {
    const later = NOW + 5 * 3_600_000;
    expect(attributionSentence(chunk(), "en", later)).toBe(
      tf("attributionStale", "en", { source: "Sonoma County Emergency Management (Demo)", time: "October 24 at 1:45 PM Pacific" }),
    );
    expect(attributionSentence(chunk(), "es", later)).toMatch(/^Fuente: .+ información del 24 de octubre a las 1:45 p\.\s?m\. hora del Pacífico\.$/);
  });

  it("is appended only when no cited source is named", () => {
    expect(withAttribution("Zones are under a warning.", [chunk()], "en", NOW)).toMatch(/That's from Sonoma County Emergency Management \(Demo\), issued/);
    const named = "Sonoma County Emergency Management says zones are under a warning.";
    expect(withAttribution(named, [chunk()], "en", NOW)).toBe(named);
    // Named but stale and without "as of": the stale attribution is still added.
    expect(withAttribution(named, [chunk()], "en", NOW + 5 * 3_600_000)).toMatch(/as of October 24/);
  });
});

describe("grounding enforcement", () => {
  it("keeps a cited answer with citations and source and time", () => {
    const g = ground();
    expect(g.kind).toBe("answer");
    expect(g.citations).toHaveLength(1);
    expect(g.reply).toMatch(/October 24 at 1:45\sPM Pacific\.$/);
    expect(g.rewritten).toBe(false);
  });

  it("rewrites an uncited answer to the canonical no_info and records the question", () => {
    const g = ground(answer({ citedChunkIds: [] }), [chunk()], "Is the school open?");
    expect(g).toMatchObject({ kind: "no_info", reply: t("noInfo", "en"), unansweredQuestion: "Is the school open?", citations: [], rewritten: true, issue: "uncited_answer" });
  });

  it("treats any cited id not retrieved this turn as an error", () => {
    expect(ground(answer({ citedChunkIds: ["made-up"] }))).toMatchObject({ kind: "no_info", issue: "unknown_chunk" });
    expect(ground(answer({ citedChunkIds: ["c1", "made-up"] }))).toMatchObject({ kind: "no_info", issue: "unknown_chunk" });
  });

  it("never answers from unverified content", () => {
    expect(ground(answer(), [chunk({ trustTier: "unverified" })]).kind).toBe("no_info");
  });

  it("replaces model safety wording with the canonical string", () => {
    const g = ground(answer({ kind: "safety", reply: "Help is on the way!" }), []);
    expect(g).toMatchObject({ kind: "safety", reply: t("safety", "en") });
  });

  it("never confirms an address is inside a zone", () => {
    const g = ground(answer({ reply: "Yes, 412 Oak Lane is inside zone SON-3A." }), [chunk()], "Is 412 Oak Lane in the evacuation zone?");
    expect(g.kind).toBe("answer");
    expect(g.reply.startsWith(t("addressRefusal", "en"))).toBe(true);
    expect(g.issue).toBe("address_claim");
    expect(claimsAddressInZone("I can't confirm whether a specific address is inside a zone.")).toBe(false);
    expect(claimsAddressInZone("You're in zone SON-3A.")).toBe(true);
  });

  it("says a shelter is open only with a cited source that says so", () => {
    expect(claimsShelterOpen("The Hillcrest shelter is open now.")).toBe(true);
    expect(claimsShelterOpen("El refugio está abierto.")).toBe(true);
    const unsupported = ground(answer({ reply: "Hillcrest Elementary shelter is open.", citedChunkIds: ["c1"] }), [chunk()], "Is Hillcrest open?");
    expect(unsupported).toMatchObject({ kind: "no_info", issue: "unsupported_shelter_claim" });
    const supported = ground(answer({ reply: "Two shelters are open.", citedChunkIds: ["c2"] }), [shelterChunk()]);
    expect(supported.kind).toBe("answer");
    expect(supported.reply).toMatch(/updated October 24 at 2:30\sPM Pacific/);
    // Non-answer kinds carry no citations, so they cannot claim it either.
    expect(ground(answer({ kind: "smalltalk", reply: "Good news, the shelter is open!", citedChunkIds: [] })).kind).toBe("no_info");
  });

  it("keeps the model's no_info question text, or falls back to the utterance", () => {
    expect(ground(answer({ kind: "no_info", reply: "", citedChunkIds: [], unansweredQuestion: "Is Hillcrest a shelter?" })).unansweredQuestion).toBe("Is Hillcrest a shelter?");
    expect(ground(answer({ kind: "no_info", reply: "", citedChunkIds: [] }), [], "raw").unansweredQuestion).toBe("raw");
  });
});
