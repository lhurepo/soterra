// [B] Builds the speakable update for a callback from official bulletin fields only.
import { formatSpokenTime } from "../orchestration/time";

export function buildUpdateMessage(
  b: { sourceName: string; title: string; body: string; issuedAt: number; updatedAt?: number; primaryState: string },
  language: string,
): string {
  const firstSentence = (b.body.match(/[^.!?]+[.!?]/)?.[0] ?? b.body).trim();
  const when = formatSpokenTime(b.updatedAt ?? b.issuedAt, b.primaryState, language);
  // TODO(B): Spanish template; today non-English callers hear the English bulletin text.
  return `Update from ${b.sourceName}, ${when}: ${b.title}. ${firstSentence}`;
}
