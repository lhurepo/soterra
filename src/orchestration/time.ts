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
