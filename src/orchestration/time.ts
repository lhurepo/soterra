// [B] Speakable local times: "October 24 at 2:10 PM Pacific". Storage is always epoch ms UTC.

const STATE_TIME_ZONES: Record<string, string> = {
  CA: "America/Los_Angeles",
  OR: "America/Los_Angeles",
  WA: "America/Los_Angeles",
  NV: "America/Los_Angeles",
  AZ: "America/Phoenix",
  CO: "America/Denver",
  UT: "America/Denver",
  TX: "America/Chicago",
  FL: "America/New_York",
  NY: "America/New_York",
  HI: "Pacific/Honolulu",
  AK: "America/Anchorage",
};

const ZONE_LABELS: Record<string, { en: string; es: string }> = {
  "America/Los_Angeles": { en: "Pacific", es: "hora del Pacífico" },
  "America/Phoenix": { en: "Mountain", es: "hora de la Montaña" },
  "America/Denver": { en: "Mountain", es: "hora de la Montaña" },
  "America/Chicago": { en: "Central", es: "hora del Centro" },
  "America/New_York": { en: "Eastern", es: "hora del Este" },
  "Pacific/Honolulu": { en: "Hawaii", es: "hora de Hawái" },
  "America/Anchorage": { en: "Alaska", es: "hora de Alaska" },
  UTC: { en: "UTC", es: "UTC" },
};

export function timeZoneForState(state: string | undefined): string {
  return (state && STATE_TIME_ZONES[state]) || "America/Los_Angeles";
}

export function formatSpokenTime(epochMs: number, state: string | undefined, language: string): string {
  const es = language.toLowerCase().startsWith("es");
  let timeZone = timeZoneForState(state);
  let date: string;
  let time: string;
  try {
    date = new Intl.DateTimeFormat(es ? "es-US" : "en-US", { timeZone, month: "long", day: "numeric" }).format(epochMs);
    time = new Intl.DateTimeFormat(es ? "es-US" : "en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(epochMs);
  } catch {
    // Runtimes without full ICU data: fall back to UTC rather than failing the turn.
    timeZone = "UTC";
    const d = new Date(epochMs);
    date = d.toISOString().slice(0, 10);
    time = d.toISOString().slice(11, 16);
  }
  const label = ZONE_LABELS[timeZone] ?? { en: timeZone, es: timeZone };
  const spoken = es ? `${date} a las ${time} ${label.es}` : `${date} at ${time} ${label.en}`;
  return spoken.replace(/\s+/gu, " "); // ICU may emit narrow no-break spaces
}

/**
 * The bare minimum for an attribution: "2:10 PM" for today, "yesterday", otherwise "October 24".
 * `now` decides what "today" means; the call's time zone comes from the source's state.
 */
export function formatShortTime(epochMs: number, state: string | undefined, language: string, now: number): string {
  const es = language.toLowerCase().startsWith("es");
  const timeZone = timeZoneForState(state);
  try {
    const day = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
    const locale = es ? "es-US" : "en-US";
    if (day(epochMs) === day(now)) {
      // "1:45 p.m." ends in a period; the attribution template adds its own.
      return new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(epochMs).replace(/\s+/gu, " ").replace(/\.$/, "");
    }
    if (day(epochMs) === day(now - 86_400_000)) return es ? "ayer" : "yesterday";
    return new Intl.DateTimeFormat(locale, { timeZone, month: "long", day: "numeric" }).format(epochMs).replace(/\s+/gu, " ");
  } catch {
    return formatSpokenTime(epochMs, state, language);
  }
}

const ZONE_ABBREVIATIONS: Record<string, string> = {
  "America/Los_Angeles": "PT",
  "America/Phoenix": "MT",
  "America/Denver": "MT",
  "America/Chicago": "CT",
  "America/New_York": "ET",
  "Pacific/Honolulu": "HT",
  "America/Anchorage": "AKT",
};

/**
 * Times in texts: "2:22 PM PT" on the day of `now`, otherwise "Oct 23, 2:22 PM PT". "PT" rather than "PST"/"PDT", so it is
 * right all year.
 */
export function formatTextTime(epochMs: number, state: string | undefined, language: string, now: number): string {
  const es = language.toLowerCase().startsWith("es");
  const timeZone = timeZoneForState(state);
  try {
    const locale = es ? "es-US" : "en-US";
    const day = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
    const time = new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(epochMs);
    const date = day(epochMs) === day(now) ? "" : `${new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric" }).format(epochMs).replace(/\.$/, "")}, `;
    return `${date}${time} ${ZONE_ABBREVIATIONS[timeZone] ?? timeZone}`.replace(/\s+/gu, " ");
  } catch {
    return `${new Date(epochMs).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
}
