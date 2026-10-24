// [I] Time parsing for feeds and pages. Every parser returns undefined rather than guessing a date,
// a time of day or a time zone.

/** ISO-8601 (or RFC 2822) time from a structured feed. */
export function parseFeedTime(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const TZ_OFFSET_HOURS: Record<string, number> = {
  UTC: 0, GMT: 0, EDT: -4, EST: -5, CDT: -5, CST: -6, MDT: -6, MST: -7, PDT: -7, PST: -8, AKDT: -8, AKST: -9, HST: -10,
};

/**
 * A human-written page time such as "Last updated: October 24, 2026, 1:45 PM PDT" or
 * "Checked at 2:30 PM PDT on October 24, 2026". Requires a full date, a clock time and a time zone
 * abbreviation; anything less returns undefined.
 */
export function parsePageTime(text: string): number | undefined {
  const date = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(text);
  const clock = /\b(\d{1,2}):(\d{2})\s*(AM|PM|a\.m\.|p\.m\.)/i.exec(text);
  const zone = /\b(UTC|GMT|EDT|EST|CDT|CST|MDT|MST|PDT|PST|AKDT|AKST|HST)\b/.exec(text);
  if (!date || !clock || !zone) return undefined;
  const month = MONTHS.indexOf(date[1].toLowerCase());
  const day = Number(date[2]);
  const year = Number(date[3]);
  let hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (hour < 1 || hour > 12 || minute > 59 || day < 1 || day > 31) return undefined;
  const pm = clock[3].toLowerCase().startsWith("p");
  if (hour === 12) hour = pm ? 12 : 0;
  else if (pm) hour += 12;
  const offset = TZ_OFFSET_HOURS[zone[1]];
  const utc = Date.UTC(year, month, day, hour - offset, minute);
  // Reject impossible dates like February 31 (Date.UTC rolls them over).
  const check = new Date(Date.UTC(year, month, day));
  if (check.getUTCMonth() !== month) return undefined;
  return utc;
}

/** X/Twitter time as returned by the Tweet Scraper actor: "Sat Oct 24 20:50:00 +0000 2026". */
export function parseTwitterTime(value: string): number | undefined {
  const m = /^\w{3} (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/.exec(value.trim());
  if (!m) return parseFeedTime(value);
  const month = MONTHS.findIndex((name) => name.startsWith(m[1].toLowerCase()));
  if (month < 0) return undefined;
  const sign = m[6] === "+" ? 1 : -1;
  const offsetMin = sign * (Number(m[7]) * 60 + Number(m[8]));
  return Date.UTC(Number(m[9]), month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) - offsetMin * 60_000;
}
