// [B] Deterministic intent checks that must not depend on the model (consent, goodbye, address questions).

export function declinesTranscript(utterance: string): boolean {
  return /\b(summary only|only (a |the )?summary|don'?t (record|transcribe|save)|no transcript|solo (un )?resumen|no (grabe|guarde))\b/i.test(
    utterance,
  );
}

export function isGoodbye(utterance: string): boolean {
  return /^\s*(ok(ay)?[,.]?\s+)?(thanks?( you)?[,.!]?\s*)?(good ?bye|bye|that'?s all|that is all|adiós|adios|gracias,? adiós|eso es todo)\b/i.test(
    utterance,
  );
}

export function asksForFollowUp(utterance: string): boolean {
  return /\b(call me (back )?(if|when)|keep me (updated|posted)|let me know (if|when)|notify me|llámeme si|avíseme|manténgame informad[oa])\b/i.test(
    utterance,
  );
}

/** "Is 412 Oak Lane in the zone?" — Soterra never guesses address-in-zone. */
export function asksAboutExactAddress(utterance: string): boolean {
  return /\b\d{1,6}\s+[A-Za-zÀ-ÿ]+(\s+[A-Za-zÀ-ÿ]+)?\s+(st(reet)?|ave(nue)?|rd|road|ln|lane|dr(ive)?|way|ct|court|blvd|boulevard|pl(ace)?|calle|avenida)\b/i.test(
    utterance,
  );
}
