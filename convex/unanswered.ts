// [B] Unanswered questions: recorded whenever Soterra says "I don't know yet" (deduped within a call).
// answerUnansweredQuestion stands in for the future responder console: run it from the Convex dashboard.
import { v } from "convex/values";
import type { AreaRef } from "../src/contracts";
import { answerDedupeKeyFor } from "../src/notifications/match";
import { buildAnswerMessage } from "../src/notifications/message";
import { normalizeForMatch } from "../src/orchestration/text";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { queueNotification } from "./subscriptions";

const sameQuestion = (a: string, b: string) =>
  normalizeForMatch(a).replace(/[^\p{L}\p{N} ]/gu, "") === normalizeForMatch(b).replace(/[^\p{L}\p{N} ]/gu, "");

/** Records (or reuses) the call's question. The same question asked twice in one call is stored once. */
export async function recordUnansweredForCall(
  ctx: MutationCtx,
  call: Doc<"calls">,
  q: { turnIndex: number; text: string; language: string; area?: AreaRef },
): Promise<Id<"unansweredQuestions">> {
  const existing = await ctx.db
    .query("unansweredQuestions")
    .withIndex("by_callId_and_turnIndex", (x) => x.eq("callId", call._id))
    .take(50);
  const dup = existing.find((e) => e.turnIndex === q.turnIndex || sameQuestion(e.text, q.text));
  if (dup) return dup._id;
  return await ctx.db.insert("unansweredQuestions", {
    callId: call._id,
    turnIndex: q.turnIndex,
    callerId: call.callerId,
    text: q.text.slice(0, 1_000),
    language: q.language,
    area: q.area,
    status: "open",
    createdAt: Date.now(),
  });
}

/** Open questions, oldest first. */
export const listOpen = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) =>
    await ctx.db
      .query("unansweredQuestions")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .take(Math.min(limit ?? 50, 100)),
});

/**
 * Answers a question with an official source and notifies every active "answer_available" subscription
 * linked to it (through the normal notification path: dedupe key, rate limit, stored attempt).
 * npx convex run unanswered:answerUnansweredQuestion '{"id":"…","answer":"…","sourceUrl":"https://…","sourceName":"…"}'
 */
export const answerUnansweredQuestion = internalMutation({
  args: { id: v.id("unansweredQuestions"), answer: v.string(), sourceUrl: v.string(), sourceName: v.string() },
  returns: v.object({ notificationsCreated: v.number() }),
  handler: async (ctx, { id, answer, sourceUrl, sourceName }) => {
    const question = await ctx.db.get("unansweredQuestions", id);
    if (!question) throw new Error(`unanswered question ${id} not found`);
    if (!/^https?:\/\//.test(sourceUrl)) throw new Error("sourceUrl must be an http(s) URL");
    if (answer.trim() === "" || sourceName.trim() === "") throw new Error("answer and sourceName are required");
    const now = Date.now();
    await ctx.db.patch("unansweredQuestions", id, {
      status: "answered",
      answeredAt: now,
      answerText: answer.trim(),
      answerSourceUrl: sourceUrl,
      answerSourceName: sourceName.trim(),
    });

    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_targetUnansweredQuestionId", (q) => q.eq("target.unansweredQuestionId", id))
      .take(50);
    let notificationsCreated = 0;
    for (const sub of subs) {
      if (sub.status !== "active" || sub.expiresAt <= now || sub.trigger !== "answer_available") continue;
      const message = buildAnswerMessage(
        { question: question.text, answer: answer.trim(), sourceName: sourceName.trim(), answeredAt: now, state: question.area?.state },
        sub.language,
      );
      const created = await queueNotification(ctx, sub, { dedupeKey: answerDedupeKeyFor(sub._id, id), message, bulletinRefs: [], now });
      if (created === "queued") notificationsCreated++;
    }
    return { notificationsCreated };
  },
});

export const dismiss = internalMutation({
  args: { id: v.id("unansweredQuestions") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch("unansweredQuestions", id, { status: "dismissed" });
    return null;
  },
});
