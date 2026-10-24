// [B] Deterministic intent checks that must not depend on the model: consent, goodbye, follow-ups,
// stopping updates, exact-address questions, and questions about "my area". English and Spanish.
import { normalizeForMatch } from "./text";

const test = (re: RegExp, utterance: string) => re.test(normalizeForMatch(utterance));

export function declinesTranscript(utterance: string): boolean {
  return test(
    /\b(summary only|only (a |the )?summary|don'?t (record|transcribe|save)|no transcript|solo (un )?resumen|no (grabe|guarde|transcriba))\b/,
    utterance,
  );
}

export function isGoodbye(utterance: string): boolean {
  return test(
    /^(ok(ay)?[,.]?\s+)?(thanks?( you)?( so much)?[,.!]?\s*)?(good ?bye|bye|that'?s all|that is all|adios|gracias,? adios|eso es todo)\b/,
    utterance,
  );
}

/** "Stop updates", "stop calling me", "unsubscribe", "deje de llamarme", "parar actualizaciones". */
export function asksToStopUpdates(utterance: string): boolean {
  return test(
    /\b(stop (the |these |my |all )?(updates|calls|calling( me)?|notifications)|no more (updates|calls)|unsubscribe|cancel (the |my )?(updates|callbacks?|notifications)|don'?t call me (again|anymore|back)|deje de llamarme|dejen de llamarme|no me llame mas|parar (las )?actualizaciones|cancelar (las )?(actualizaciones|llamadas)|ya no quiero (actualizaciones|llamadas))\b/,
    utterance,
  );
}

/** "Call me if…", "keep me updated", "llámame". Checked after asksToStopUpdates. */
export function asksForFollowUp(utterance: string): boolean {
  return test(
    /\b(call me( back)?|keep me (updated|posted|informed)|let me know (if|when)|notify me|text me|llamame|llameme|avisame|aviseme|mantengame informad[oa]|mantenme informad[oa])\b/,
    utterance,
  );
}

/** "…when you know", "if you find out": the caller wants the answer to an unanswered question. */
export function wantsAnswerWhenKnown(utterance: string): boolean {
  return test(/\b(when you (know|find out|hear)|if you (find out|hear)|once you know|cuando (sepa|se sepa|tenga la respuesta)|si se entera)\b/, utterance);
}

/** "Is 412 Oak Lane in the zone?" — Soterra never guesses address-in-zone. */
export function asksAboutExactAddress(utterance: string): boolean {
  return test(
    /\b\d{1,6}\s+[a-z]+(\s+[a-z]+)?\s+(st(reet)?|ave(nue)?|rd|road|ln|lane|dr(ive)?|way|ct|court|blvd|boulevard|pl(ace)?|calle|avenida)\b|\b(calle|avenida)\s+[a-z]+\s+\d{1,6}\b/,
    utterance,
  );
}

/** Questions that only make sense with the caller's location: "near me", "my area", "cerca de mí". */
export function isLocationDependent(utterance: string): boolean {
  return test(
    /\b(near me|nearby|near here|around here|close to me|my (area|neighborhood|town|city|street|zone)|where i live|cerca de mi|por aqui|mi (zona|area|barrio|ciudad|calle)|donde vivo)\b/,
    utterance,
  );
}
