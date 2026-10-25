// [B] Speakable callback messages, built from official bulletin fields only (a template, no LLM).
// Bulletin text stays in its original language; only the framing is translated.
import { tf } from "../config/strings";
import { formatSpokenTime } from "../orchestration/time";
import { formatDuration } from "./schedule";

/** First sentence of the body, without the "fictional demo data" disclaimer when that is all there is. */
function detailSentence(body: string): string {
  const sentences = (body.match(/[^.!?]+[.!?]+/g) ?? [body]).map((s) => s.trim()).filter(Boolean);
  return sentences.find((s) => !/fictional demo data/i.test(s)) ?? sentences[0] ?? "";
}

export function buildUpdateMessage(
  b: { sourceName: string; title: string; body: string; issuedAt: number; updatedAt?: number; primaryState: string },
  language: string,
): string {
  const time = formatSpokenTime(b.updatedAt ?? b.issuedAt, b.primaryState, language);
  const title = b.title.replace(/[.\s]+$/, "");
  const detail = detailSentence(b.body);
  // "JORA Fire. JORA Fire, Los Angeles County." says the name twice: when the detail starts with the title, say it once.
  const repeats = detail.toLowerCase().startsWith(title.toLowerCase());
  return tf("updateMessage", language, {
    source: b.sourceName,
    time,
    title: repeats ? detail.replace(/[.\s]+$/, "") : title,
    detail: repeats ? "" : detail,
  }).trim();
}

export function buildAnswerMessage(
  q: { question: string; answer: string; sourceName: string; answeredAt: number; state?: string },
  language: string,
): string {
  const time = formatSpokenTime(q.answeredAt, q.state, language);
  return tf("answerMessage", language, {
    question: q.question.replace(/["“”]/g, "").trim(),
    answer: q.answer.trim().replace(/([^.!?])$/, "$1."),
    source: q.sourceName,
    time,
  });
}

/**
 * A time-based update ("every 2 hours"), spoken on a call or sent as a text. Something new since the last one: the
 * update itself. Nothing new: says so, with the latest official item. Nothing at all: says so and when we check again.
 */
export function buildScheduledMessage(
  args: {
    topic: string;
    latest?: { sourceName: string; title: string; body: string; issuedAt: number; updatedAt?: number; primaryState: string };
    /** When the previous scheduled update (or the request) was. */
    since: number;
    intervalMs: number;
    state?: string;
  },
  language: string,
): string {
  const { latest } = args;
  if (!latest) return tf("scheduledNone", language, { topic: args.topic, interval: formatDuration(args.intervalMs, language) });
  const latestAt = latest.updatedAt ?? latest.issuedAt;
  if (latestAt > args.since) return buildUpdateMessage(latest, language);
  return tf("scheduledNoChange", language, {
    topic: args.topic,
    since: formatSpokenTime(args.since, args.state ?? latest.primaryState, language),
    source: latest.sourceName,
    time: formatSpokenTime(latestAt, latest.primaryState, language),
    title: latest.title.replace(/[.\s]+$/, ""),
  }).trim();
}
