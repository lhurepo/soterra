// [B] Text-message templates: update texts (on change and time-based), the missed-call and recap texts that follow an
// update call, the confirmation after a call that set up updates, and STOP <topic> parsing. Templates only (no LLM):
// every fact comes from official bulletin fields. Nothing said on a call is texted.
import { DEFAULTS } from "../config/defaults";
import { t, tf } from "../config/strings";
import { formatTextTime } from "../orchestration/time";
import { detailSentence } from "./message";
import { formatDuration, formatInterval } from "./schedule";

/** "+17126003362" → "(712) 600-3362"; anything else is shown as given. */
export function formatPhoneForText(phone: string): string {
  const m = phone.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

export function smsFooter(language: string, hotline?: string): string {
  return hotline ? tf("smsFooterHotline", language, { hotline: formatPhoneForText(hotline) }) : t("smsFooter", language);
}

/** Splits at . ! ? followed by a capital, digit or quote, so "2:10 p. m." and "U.S." stay whole. */
const sentences = (text: string) =>
  text
    .split(/(?<=[.!?]["”]?)\s+(?=[A-ZÁÉÍÓÚÑ¿¡"“0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Keeps `body` within `room` characters: whole sentences first, then a cut at a word with "...". */
export function fitBody(body: string, room: number): string {
  let out = "";
  for (const s of sentences(body)) {
    const next = out ? `${out} ${s}` : s;
    if (next.length <= room) {
      out = next;
      continue;
    }
    // The sentence that does not fit is cut at a word, unless almost nothing of it would be left.
    const left = room - (out ? out.length + 1 : 0) - 3;
    if (left >= 30) {
      const cut = s.slice(0, left);
      const piece = cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : cut.length).replace(/[\s,;:]+$/, "");
      out = out ? `${out} ${piece}...` : `${piece}...`;
    }
    break;
  }
  return out;
}

/** `body`, a blank line and the footer within `max` characters. The footer (STOP, 911) is never cut. */
export function fitText(body: string, footer: string, max: number = DEFAULTS.smsMaxChars): string {
  return `${fitBody(body, max - footer.length - 2)}\n\n${footer}`;
}

/** "ridgeview-fire-demo" → "Ridgeview Fire": a readable incident name for texts. */
export function incidentLabel(incidentKey: string): string {
  const words = incidentKey.split(/[-_\s]+/).filter(Boolean);
  if (words.length > 1 && words[words.length - 1].toLowerCase() === "demo") words.pop();
  return words.map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
}

/**
 * A short name from a bulletin title: "Cooley Fire" stays, "Red Flag Warning issued October 24 at 2:00PM PDT by NWS"
 * becomes "Red Flag Warning". Used as the topic of a text and in its STOP keyword.
 */
export function shortTopic(title: string): string {
  const head = title.split(/\s+(?:issued|by|until|for)\s+|[:,(\u2013\u2014]|\s-\s/i)[0].trim().replace(/[.\s]+$/, "");
  if (head.length <= 40) return head;
  const cut = head.slice(0, 40);
  return cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : 40);
}

export type TextTarget = { kind: "incident" | "area" | "question"; incidentKey?: string; area?: { label: string } };

/**
 * What a subscription is about, for texts: the incident's name (from a slug like "ridgeview-fire-demo", or else the latest
 * bulletin's title), the area's label, or "your question".
 */
export function textTopic(target: TextTarget, language: string, bulletinTitle?: string): string {
  if (target.kind === "incident" && target.incidentKey) {
    if (!target.incidentKey.includes(":")) return incidentLabel(target.incidentKey);
    if (bulletinTitle) return shortTopic(bulletinTitle);
    return t("topicIncident", language);
  }
  if (target.kind === "area" && target.area) return target.area.label;
  return t("topicQuestionText", language);
}

/** "STOP COOLEY FIRE": the reply that stops one subscription (a bare STOP stops every Soterra text). */
export function stopKeyword(target: TextTarget, topic: string, language: string): string {
  const name = target.kind === "question" ? t("stopKeywordQuestion", language) : topic;
  return `STOP ${plain(name).toUpperCase()}`;
}

/** Lowercase, no accents, letters and digits only: what STOP keywords are compared on. */
function plain(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * A reply that asks to stop one subscription: "STOP COOLEY FIRE", "stop cooley", "PARAR PREGUNTA". A bare "STOP" (or
 * "STOP ALL") is not one: Twilio and isOptOutText handle that as stopping everything.
 */
export function parseStopTopic(body: string): string | null {
  const m = plain(body).toLowerCase().match(/^(?:stop|parar|para|alto|cancelar|cancel|baja|unsubscribe)\s+(.+)$/);
  if (!m || /^(all|todo|todos|todas)$/.test(m[1])) return null;
  return m[1];
}

/** Whether a requested topic ("cooley", "cooley fire") names this subscription's topic or keyword. */
export function stopTopicMatches(requested: string, names: string[]): boolean {
  const want = plain(requested).toLowerCase();
  if (want.length < 3) return false;
  return names.some((n) => {
    const name = plain(n).toLowerCase();
    return name !== "" && (name === want || name.startsWith(`${want} `) || want.startsWith(`${name} `));
  });
}

export type UpdateTextBulletin = { title: string; body: string; issuedAt: number; updatedAt?: number; primaryState: string };

/** The official item as one short sentence: "Cooley Fire, Mendocino County: about 1,365 acres, 90% contained." */
function bulletinSummary(b: UpdateTextBulletin): string {
  const title = b.title.replace(/[.\s]+$/, "");
  const detail = detailSentence(b.body);
  if (detail && plain(detail).toLowerCase().startsWith(plain(title).toLowerCase())) return detail;
  return detail && !plain(title).toLowerCase().includes(plain(detail).toLowerCase()) ? `${title}. ${detail}` : `${title}.`;
}

export type UpdateTextArgs = {
  topic: string;
  /** The STOP keyword for this subscription ("STOP COOLEY FIRE"); absent = only the bare STOP is offered. */
  keyword?: string;
  /** When the update goes out: the time in the header. */
  sentAt: number;
  /** State whose time zone is used (the area's, else the bulletin's). */
  state?: string;
  latest?: UpdateTextBulletin;
  /** Time-based updates: how often, and since when (the previous update, or the request). */
  scheduled?: { intervalMs: number; since: number };
  /** An answer to the caller's open question (instead of a bulletin). */
  answer?: { question: string; answer: string; answeredAt: number };
};

function compose(header: string, body: string, tail: string): string {
  return `${header}\n\n${fitBody(body, DEFAULTS.smsMaxChars - header.length - tail.length - 4)}\n\n${tail}`;
}

/**
 * An update by text:
 *
 *   Update on Cooley Fire (4:40 PM PT):
 *
 *   As of 2:22 PM PT: Cooley Fire, Mendocino County: about 1,365 acres, 90% contained.
 *
 *   [This is an update every 2 hours.]
 *   Reply STOP COOLEY FIRE to stop receiving updates on Cooley Fire.
 *   Questions? …
 */
export function buildUpdateText(a: UpdateTextArgs, language: string, hotline?: string): string {
  const time = (ms: number, state = a.state) => formatTextTime(ms, state, language, a.sentAt);
  const header = tf("smsUpdateHeader", language, { topic: a.topic, time: time(a.sentAt) });
  let body: string;
  if (a.answer) {
    body = tf("smsAnswer", language, {
      question: a.answer.question.replace(/["“”]/g, "").trim().replace(/([^.!?])$/, "$1?"),
      time: time(a.answer.answeredAt),
      answer: a.answer.answer.trim().replace(/([^.!?])$/, "$1."),
    });
  } else if (!a.latest) {
    body = tf("smsNoneYet", language, { interval: formatDuration(a.scheduled?.intervalMs ?? 3_600_000, language) });
  } else {
    const latestAt = a.latest.updatedAt ?? a.latest.issuedAt;
    const latestTime = time(latestAt, a.state ?? a.latest.primaryState);
    body =
      a.scheduled && latestAt <= a.scheduled.since
        ? tf("smsNoChange", language, { since: time(a.scheduled.since), time: latestTime, summary: bulletinSummary(a.latest) })
        : tf("smsAsOf", language, { time: latestTime, summary: bulletinSummary(a.latest) });
  }
  const tail = [
    a.scheduled ? tf("smsEvery", language, { interval: formatInterval(a.scheduled.intervalMs, language) }) : undefined,
    a.keyword ? tf("smsStopTopic", language, { keyword: a.keyword, topic: a.topic }) : t("smsStopAll", language),
    hotline ? tf("smsHelpHotline", language, { hotline: formatPhoneForText(hotline) }) : t("smsHelp", language),
  ]
    .filter(Boolean)
    .join("\n");
  return compose(header, body, tail);
}

/** The update text of a call nobody answered, with "We tried to call you." in front of the update. */
export function withMissedCallLead(updateText: string, language: string): string {
  const [header, body, ...tail] = updateText.split("\n\n");
  if (body === undefined || tail.length === 0) return fitBody(`${t("smsMissedLead", language)} ${updateText}`, DEFAULTS.smsMaxChars);
  return compose(header, `${t("smsMissedLead", language)} ${body}`, tail.join("\n\n"));
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
