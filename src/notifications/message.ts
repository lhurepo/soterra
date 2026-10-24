// [B] Speakable callback messages, built from official bulletin fields only (a template, no LLM).
// Bulletin text stays in its original language; only the framing is translated.
import { tf } from "../config/strings";
import { formatSpokenTime } from "../orchestration/time";

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
  return tf("updateMessage", language, { source: b.sourceName, time, title: b.title.replace(/[.\s]+$/, ""), detail: detailSentence(b.body) }).trim();
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
