// [B] Unanswered questions: recorded whenever Soterra says "I don't know yet".
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { areaRef } from "./validators";

/** Idempotent per (call, turn) so a replayed turn does not record the question twice. */
export const record = internalMutation({
  args: {
    callId: v.id("calls"),
    turnIndex: v.number(),
    question: v.string(),
    language: v.string(),
    area: v.optional(areaRef),
  },
  returns: v.id("unansweredQuestions"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("unansweredQuestions")
      .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", args.callId).eq("turnIndex", args.turnIndex))
      .unique();
    if (existing) return existing._id;
    const call = await ctx.db.get("calls", args.callId);
    return await ctx.db.insert("unansweredQuestions", {
      ...args,
      callerId: call?.callerId,
      status: "open",
      createdAt: Date.now(),
    });
  },
});

/** Open questions, oldest first. TODO(B): a responder flow that answers them and triggers "answer_available". */
export const listOpen = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) =>
    await ctx.db
      .query("unansweredQuestions")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .take(Math.min(limit, 100)),
});
