// [B] Canonical strings exist in both languages, keep their placeholders, and say what they must say.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { allStrings, fill, t } from "../src/config/strings";
import { inboundGreeting, outboundGreeting } from "../src/orchestration/greeting";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("canonical strings", () => {
  const { en, es } = allStrings();

  it("exist in English and Spanish with the same keys and placeholders, none empty", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(en[key].trim(), key).not.toBe("");
      expect(es[key].trim(), key).not.toBe("");
      expect(placeholders(es[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("put the 911 line in every safety-critical sentence", () => {
    for (const lang of ["en", "es"] as const) {
      for (const key of ["safety", "fallback", "noInfo", "goodbye", "emergencyLine"] as const) expect(t(key, lang), `${lang}.${key}`).toMatch(/911/);
    }
  });

  it("never say or imply that Soterra sent help", () => {
    for (const lang of ["en", "es"] as const) {
      expect(t("safety", lang)).not.toMatch(/help is (on the way|coming)|we (have )?sent|dispatched|la ayuda (va|está) en camino|enviamos/i);
      expect(t("safety", "en")).toMatch(/can't send help/);
      expect(t("safety", "es")).toMatch(/no puedo enviar ayuda/);
    }
  });

  it("fall back to English for any other language", () => {
    expect(t("safety", "fr")).toBe(t("safety", "en"));
    expect(t("safety", "es-MX")).toBe(t("safety", "es"));
  });

  it("fill placeholders and leave unknown ones visible", () => {
    expect(fill("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });

  it("carry the file header asking for human review", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../src/config/strings.ts"), "utf8");
    expect(source.slice(0, 400)).toMatch(/HUMAN REVIEW REQUIRED BEFORE THE DEMO/);
  });
});

describe("greetings", () => {
  it("inbound: welcome, 911 line, one-sentence transcription notice, optional returning offer", () => {
    const g = inboundGreeting("en", { returning: false });
    expect(g).toContain(t("transcriptionNotice", "en"));
    expect(g).toContain(t("emergencyLine", "en"));
    expect(g).not.toContain(t("returningOffer", "en"));
    expect(inboundGreeting("es", { returning: true })).toContain(t("returningOffer", "es"));
    expect(t("transcriptionNotice", "en").match(/[.!?](\s|$)/g)).toHaveLength(1);
  });

  it("outbound: the update, how to stop updates, the 911 line", () => {
    const g = outboundGreeting("en", "Update from X: Y.");
    expect(g).toContain("Update from X: Y.");
    expect(g).toContain(t("stopUpdates", "en"));
    expect(g).toContain(t("emergencyLine", "en"));
  });
});
