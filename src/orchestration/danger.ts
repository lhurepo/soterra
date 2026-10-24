// [B] Deterministic danger check. Runs before any retrieval or LLM call; a hit short-circuits the turn.
// Patterns are broad on purpose (a false positive costs one sentence, a miss can cost a life) but are
// statements about the caller's situation, so news questions like "is there a fire near me?" pass.
// English and Spanish patterns run on every turn whatever the session language: callers switch under stress.
// TODO(B): review the patterns with a native Spanish speaker before the demo.
import { normalizeForMatch } from "./text";

// Matched against normalizeForMatch() output: lowercase, no accents, straight apostrophes.
const PATTERNS: Record<"en" | "es", RegExp[]> = {
  en: [
    /\b(i'?m|i am|we'?re|we are|they'?re|he'?s|she'?s|someone'?s|someone is|somebody is|people are|my \w+ (is|are))\s+(still\s+)?(trapped|stuck inside|drowning|injured|hurt|bleeding|unconscious|not breathing|on fire|burning)\b/,
    /\btrapped (in|inside|under|by)\b/,
    /\b(can'?t|cannot|can not|unable to)\s+(breathe|get out|escape|get away|leave the house)\b/,
    /\b(my|our|the) (house|home|apartment|building|car|room) is (on fire|burning|flooding)\b/,
    /\b(fire|flames|smoke) (is |are )?(in|inside|reaching) (my|our|the) (house|home|room|car|apartment|building)\b/,
    /\bwater is (rising|coming) (in|into|inside)\b/,
    /\b(heart attack|having a stroke|not breathing|unconscious|seizure|bleeding badly|overdose)\b/,
    /\b(need|send|get me|call me)\s+(an?\s+)?(ambulance|rescue|firefighters|fire department|police)\b/,
    /\bcall 911 for me\b/,
  ],
  es: [
    /\batrapad[oa]s?\b/,
    /\bno (puedo|podemos|puede|pueden) (respirar|salir|escapar)\b/,
    /\bahogando(me|nos|se)?\b/,
    /\b(alguien|hay alguien|mi \w+) (esta |estan )?(herid[oa]s?|sangrando|inconsciente)\b/,
    /\b(estoy|estamos|esta|estan) (herid[oa]s?|sangrando|inconsciente)\b/,
    /\bno respira\b/,
    /\b(mi|nuestra|la) casa (se esta quemando|esta en llamas|se esta inundando|se quema)\b/,
    /\bse esta (quemando|incendiando|inundando) (mi|nuestra) casa\b/,
    /\b(fuego|incendio|humo|agua) (esta |estan )?(en|dentro de|entrando en|entrando a) (mi|nuestra) (casa|cuarto|carro|coche|apartamento)\b/,
    /\b(el )?agua (ya )?esta entrando\b/,
    /\b(ataque al corazon|derrame cerebral|convulsion)\b/,
    /\b(necesito|necesitamos|manden|envien|mande) (una |un )?(ambulancia|rescate|bomberos|policia)\b/,
  ],
};

export function detectDanger(utterance: string): boolean {
  return dangerLanguage(utterance) !== null;
}

/**
 * The language the caller was in danger in: which pattern set matched. When both match, `preferred` wins.
 * The warning is spoken in that language even if the call started in the other one.
 */
export function dangerLanguage(utterance: string, preferred: "en" | "es" = "en"): "en" | "es" | null {
  const text = normalizeForMatch(utterance);
  const hits = (["en", "es"] as const).filter((lang) => PATTERNS[lang].some((re) => re.test(text)));
  if (hits.length === 0) return null;
  return hits.includes(preferred) ? preferred : hits[0];
}
