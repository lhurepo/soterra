// [S] Call completion contract: the summary written after every call.
import { z } from "zod";
import { AreaRef, HazardType, Language } from "./common";

export const CallSummary = z.object({
  /** ≤ 80 words, neutral, no personal details beyond what the caller volunteered. */
  summary: z.string().max(800),
  language: Language,
  topics: z.array(z.string()),
  areasMentioned: z.array(AreaRef),
  hazards: z.array(HazardType),
  unansweredQuestionIds: z.array(z.string()),
  followUpsRequested: z.array(z.string()),
  safetyFlag: z.boolean(),
});
export type CallSummary = z.infer<typeof CallSummary>;

export const TranscriptConsent = z.enum(["notice_given", "declined"]);
export type TranscriptConsent = z.infer<typeof TranscriptConsent>;
