// [B] Text-message templates: the missed-call text, the recap after an answered update call, and the confirmation
// after a call that set up updates. Templates only (no LLM): the update text comes from official bulletin fields
// (src/notifications/message.ts) and recap answers are the grounded replies already spoken on the call.
import { DEFAULTS } from "../config/defaults";
import { t, tf } from "../config/strings";
import { formatInterval } from "./schedule";

/** "+18046066867" → "(804) 606-6867"; anything else is shown as given. */
export function formatPhoneForText(phone: string): string {
  const m = phone.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

export function smsFooter(language: string, hotline?: string): string {
  return hotline ? tf("smsFooterHotline", language, { hotline: formatPhoneForText(hotline) }) : t("smsFooter", language);
}

const sentences = (text: string) => (text.match(/[^.!?]+[.!?]+["”]?|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);

/**
 * Keeps `body` within `max` characters together with the footer: whole sentences first, then a cut at a word with "…".
 * The footer (STOP, 911) is never cut.
 */
export function fitText(body: string, footer: string, max: number = DEFAULTS.smsMaxChars): string {
  const room = max - footer.length - 1;
  let out = "";
  for (const s of sentences(body)) {
    const next = out ? `${out} ${s}` : s;
    if (next.length <= room) {
      out = next;
      continue;
    }
    // The sentence that does not fit is cut at a word, unless almost nothing of it would be left.
    const left = room - (out ? out.length + 1 : 0) - 1;
    if (left >= 30) {
      const cut = s.slice(0, left);
      const piece = cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : cut.length).replace(/[\s,;:]+$/, "");
      out = out ? `${out} ${piece}…` : `${piece}…`;
    }
    break;
  }
  return `${out} ${footer}`;
}

/** "ridgeview-fire-demo" → "Ridgeview Fire": a readable incident name for texts. */
export function incidentLabel(incidentKey: string): string {
  const words = incidentKey.split(/[-_\s]+/).filter(Boolean);
  if (words.length > 1 && words[words.length - 1].toLowerCase() === "demo") words.pop();
  return words.map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
}

export type TextTarget = { kind: "incident" | "area" | "question"; incidentKey?: string; area?: { label: string } };

export function textTopic(target: TextTarget, language: string): string {
  if (target.kind === "incident" && target.incidentKey) return incidentLabel(target.incidentKey);
  if (target.kind === "area" && target.area) return target.area.label;
  return t("topicQuestionText", language);
}

/**
 * A spoken answer without its attribution: drops the closing "Sonoma County Fire, 2:10 PM." and the corroboration
 * sentences, keeping the facts. Texts stay short; callers can call the line for sources.
 */
export function answerWithoutAttribution(reply: string): string {
  const time = /\b\d{1,2}(:\d{2})?\s*(a\.?\s?m\.?|p\.?\s?m\.?)|\b(yesterday|today|ayer|hoy)\b|\b(january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+\d{1,2}\b/i;
  const kept = sentences(reply).filter((s, i, all) => {
    if (/^(also reported by|sources differ|también lo informa|las fuentes difieren|fuente:)/i.test(s)) return false;
    // The attribution is the last sentence, short, with a time in it.
    return !(i === all.length - 1 && i > 0 && s.split(/\s+/).length <= 10 && time.test(s));
  });
  return kept.join(" ");
}

export function buildMissedCallText(updateMessage: string, language: string, hotline?: string): string {
  return fitText(tf("smsMissedCall", language, { message: updateMessage }), smsFooter(language, hotline));
}

/** The update first, then up to two answers given on the call, as space allows. */
export function buildRecapText(updateMessage: string, answers: string[], language: string, hotline?: string): string {
  const footer = smsFooter(language, hotline);
  const head = tf("smsRecap", language, { message: updateMessage });
  const short = answers.map(answerWithoutAttribution).filter(Boolean).slice(0, 2);
  if (short.length === 0) return fitText(head, footer);
  const withAnswers = `${head} ${tf("smsRecapAnswers", language, { answers: short.join(" ") })}`;
  return withAnswers.length + footer.length + 1 <= DEFAULTS.smsMaxChars ? `${withAnswers} ${footer}` : fitText(withAnswers, footer);
}

export type ConfirmationItem = { channel: "phone_call" | "sms"; intervalMs?: number; topic: string };

/** "Soterra: you'll get texts about Ridgeview Fire when officials post updates, until October 25 at 3:00 PM Pacific." */
export function buildConfirmationText(items: ConfirmationItem[], until: string, language: string, hotline?: string): string {
  const parts = items.map((i) => {
    const vars = { topic: i.topic, interval: i.intervalMs === undefined ? "" : formatInterval(i.intervalMs, language) };
    if (i.intervalMs !== undefined) return tf(i.channel === "sms" ? "smsItemScheduledTexts" : "smsItemScheduledCalls", language, vars);
    return tf(i.channel === "sms" ? "smsItemTexts" : "smsItemCalls", language, vars);
  });
  const joiner = language.toLowerCase().startsWith("es") ? "; y " : "; and ";
  return fitText(tf("smsConfirmation", language, { items: parts.join(joiner), until }), smsFooter(language, hotline));
}
