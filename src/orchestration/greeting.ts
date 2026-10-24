// [B] Session greetings, assembled only from canonical strings (src/config/strings.ts).
import { t } from "../config/strings";

/**
 * Welcome, the 911 line, the one-sentence transcription notice, the question. Memory is never volunteered:
 * `opts.returning` is accepted for callers but ignored; a caller asks for their history if they want it.
 */
export function inboundGreeting(language: string, _opts?: { returning?: boolean }): string {
  return [t("welcome", language), t("emergencyLine", language), t("transcriptionNotice", language), t("askQuestion", language)].join(" ");
}

/** The callback check: we called the caller's number, so whoever answers holds the phone (this call only). */
export function verificationGreeting(language: string): string {
  return [t("verifyIntro", language), t("emergencyLine", language), t("transcriptionNotice", language), t("verifyAsk", language)].join(" ");
}

/** The update itself, an invitation to ask about it, how to stop updates, the 911 line, and the notice. */
export function outboundGreeting(language: string, updateMessage: string): string {
  return [
    t("outboundIntro", language),
    updateMessage,
    t("outboundInvite", language),
    t("stopUpdates", language),
    t("emergencyLine", language),
    t("transcriptionNotice", language),
  ].join(" ");
}
