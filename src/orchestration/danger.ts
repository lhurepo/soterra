// [B] Deterministic danger check. Runs before any retrieval or LLM call; a hit short-circuits the turn.
// Patterns are deliberately broad: a false positive costs one sentence, a miss can cost a life.
// TODO(B): review the patterns in every supported language with a native speaker.

const PATTERNS: Record<"en" | "es", RegExp[]> = {
  en: [
    /\b(i'?m|i am|we'?re|we are|they'?re|he'?s|she'?s|someone is|somebody is)\s+(trapped|stuck|drowning|injured|hurt|bleeding|unconscious|not breathing|on fire)\b/i,
    /\btrapped\b/i,
    /\b(can'?t|cannot|can not)\s+(breathe|get out|escape|leave)\b/i,
    /\b(fire|flames|smoke|water)\s+(is\s+)?(in|inside|at|reaching)\s+(my|our|the)\s+(house|home|room|car|apartment)\b/i,
    /\bwater\s+(is\s+)?(rising|coming)\s+(in|inside)\b/i,
    /\b(heart attack|stroke|not breathing|unconscious|seizure|bleeding badly|overdose)\b/i,
    /\b(need|send|get)\s+(an?\s+)?(ambulance|rescue|firefighters|police)\b/i,
    /\bcall\s+911\s+for\s+me\b/i,
  ],
  es: [
    /\batrapad[oa]s?\b/i,
    /\bno\s+(puedo|podemos)\s+(respirar|salir|escapar)\b/i,
    /\b(me|nos|se)\s+(estoy|estamos|está)\s+ahogando\b/i,
    /\b(herid[oa]s?|sangrando|inconsciente|no respira)\b/i,
    /\b(fuego|incendio|humo|agua)\s+(está\s+)?(en|dentro de)\s+(mi|nuestra)\s+(casa|cuarto|carro|coche)\b/i,
    /\b(ataque al corazón|derrame)\b/i,
    /\b(necesito|manden|envíen)\s+(una\s+)?(ambulancia|rescate|bomberos|policía)\b/i,
  ],
};

export function detectDanger(utterance: string): boolean {
  const text = utterance.normalize("NFC");
  // Check every language: callers switch languages under stress.
  return [...PATTERNS.en, ...PATTERNS.es].some((re) => re.test(text));
}
