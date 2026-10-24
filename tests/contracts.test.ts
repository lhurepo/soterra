// [S] Golden fixtures parse with the zod contracts, and invalid ones are rejected.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import * as contracts from "../src/contracts";

const dir = resolve(import.meta.dirname, "../fixtures/contracts");
type Entry = { file: string; schema: string; python: boolean };
const manifest = JSON.parse(readFileSync(resolve(dir, "manifest.json"), "utf8")) as { valid: Entry[]; invalid: Entry[] };

function schemaFor(name: string): z.ZodType {
  const schema = (contracts as Record<string, unknown>)[name];
  if (!schema || typeof (schema as z.ZodType).safeParse !== "function") throw new Error(`unknown schema ${name}`);
  return schema as z.ZodType;
}
const load = (file: string) => JSON.parse(readFileSync(resolve(dir, file), "utf8"));

describe("golden contract fixtures", () => {
  it.each(manifest.valid)("$file parses as $schema", ({ file, schema }) => {
    const result = schemaFor(schema).safeParse(load(file));
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true);
  });

  it.each(manifest.invalid)("$file is rejected by $schema", ({ file, schema }) => {
    expect(schemaFor(schema).safeParse(load(file)).success).toBe(false);
  });

  it("every voice fixture carries the current contractVersion", () => {
    for (const { file } of manifest.valid.filter((e) => e.file.startsWith("voice.") || e.file.startsWith("health"))) {
      expect(load(file).contractVersion, file).toBe(contracts.CONTRACT_VERSION);
    }
  });

  it("additive fields are tolerated (and stripped)", () => {
    const parsed = contracts.TurnResponse.parse(load("voice.turn.response.future-field.json"));
    expect(parsed).not.toHaveProperty("someFutureOptionalField");
  });
});

describe("normalized fixtures", () => {
  it.each(["ridgeview-initial.json", "ridgeview-update.json"])("%s are valid drafts flagged as fixtures", (file) => {
    const items = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/normalized", file), "utf8")) as unknown[];
    for (const item of items) {
      const draft = contracts.NormalizedBulletinDraft.parse(item);
      expect(draft.isFixture).toBe(true);
      expect(draft.sourceName).toMatch(/\(Demo\)$/);
    }
  });
});
