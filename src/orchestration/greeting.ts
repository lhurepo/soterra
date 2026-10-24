// [B] Session greetings, assembled only from canonical strings (src/config/strings.ts).
import { t } from "../config/strings";

/** Welcome, the 911 line, the one-sentence transcription notice, an optional "pick up where we left off". */
export function inboundGreeting(language: string, opts: { returning: boolean }): string {
  return [
    t("welcome", language),
    t("emergencyLine", language),
    t("transcriptionNotice", language),
    opts.returning ? t("returningOffer", language) : t("askQuestion", language),
  ].join(" ");
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
