// [B] Every scripted conversation in fixtures/conversations runs green through the HTTP routes (the same
// runner `npm run sim:call` uses against the dev deployment).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import basic from "../../fixtures/conversations/ridgeview-basic.json";
import danger from "../../fixtures/conversations/danger.json";
import spanish from "../../fixtures/conversations/spanish.json";
import withheld from "../../fixtures/conversations/withheld.json";
import { runConversation, type Conversation } from "../../scripts/lib/simCall";
import { SECRET, fetchPath, newTest, setupEnv } from "../test.setup";
import { seedBulletins, useDemoClock } from "./backend.helpers";

beforeEach(() => {
  useDemoClock();
  setupEnv();
});
afterEach(() => vi.useRealTimers());

describe.each([
  ["ridgeview-basic", basic],
  ["danger", danger],
  ["spanish", spanish],
  ["withheld", withheld],
])("conversation %s", (name, conversation) => {
  it("meets every expectation", async () => {
    const t = newTest();
    await seedBulletins(t);
    const result = await runConversation({ fetchPath: fetchPath(t), secret: SECRET, conversation: conversation as Conversation, providerCallId: `conv-${name}` });
    expect(result.failures).toEqual([]);
    for (const turn of result.turns) {
      expect(turn.response.reply).not.toMatch(/https?:\/\/|\*\*|^- /m); // speakable: no URLs or markdown
      if (turn.response.kind === "answer") expect(turn.response.citations.length).toBeGreaterThan(0);
    }
  });
});
