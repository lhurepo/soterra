// [B] Session greetings, assembled only from canonical strings (src/config/strings.ts).
import { t, tf } from "../config/strings";

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

/**
 * The call that reads the app its sign-in code. Digits are spaced so they are read one by one ("4 8 2 9 1 7"), and the code
 * comes first so nobody has to sit through the notice to hear it. `code` is null when the code has already expired.
 */
export function appCodeGreeting(language: string, code: string | null): string {
  const first = code ? tf("appCodeIntro", language, { code: code.split("").join(" ") }) : t("appCodeExpired", language);
  return [first, t("transcriptionNotice", language)].join(" ");
}
