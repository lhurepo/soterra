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
    /\b(stop (the |these |my |all )?(updates|calls|calling( me)?|notifications)|no more (updates|calls)|turn (them|the updates|my updates|all (of )?(them|updates)) (all )?off|unsubscribe|cancel (the |my )?(updates|callbacks?|notifications)|don'?t call me (again|anymore|back)|deje de llamarme|dejen de llamarme|no me llame mas|parar (las )?actualizaciones|cancelar (las )?(actualizaciones|llamadas)|ya no quiero (actualizaciones|llamadas))\b/,
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

/** "Where did that come from?", "what's your source", "how old is that". Then the full source and time are spoken. */
export function asksForSource(utterance: string): boolean {
  return test(
    /\b(where (did|does|do|is|are|was) (that|this|the|you|it)\b.{0,30}\b(come|from|get|got|info|information|source)|what('?s| is| was) (the|your) source|which source|who (said|says|told|reported)|how (old|recent|current|fresh|up to date)|when was (that|this|it) (updated|issued|posted|published|checked)|source of)\b|\b(de donde (viene|vino|sale|salio|es|saco|sacaste)|cual es (la|su) fuente|que fuente|quien (dijo|dice|informo)|que tan (viejo|reciente|actual)|cuando se actualizo)\b/,
    utterance,
  );
}

// ── Personal commands (need a verified call; see src/orchestration/pipeline.ts) ──────────────────────────────

export type ProfileCommand = { kind: "remember"; text: string } | { kind: "recall" } | { kind: "recap" } | { kind: "updates" } | { kind: "verify" } | { kind: "forget" };

const flat = (utterance: string) => normalizeForMatch(utterance).replace(/[.?!,;:¿¡]+/g, " ").replace(/\s+/g, " ").trim();

/** Speech recognition keeps the "um"s: drop leading filler and softeners so the rest can be matched. */
const LEADING_FILLER = /^(?:(?:um+|uh+|er+|hmm+|mm+|well|so|okay|ok|yeah|no|hey|hello|hi|like|and|but|then|please|sorry|actually|i mean|you know|oh)\s+)+/;
const spoken = (utterance: string) => flat(utterance).replace(LEADING_FILLER, "");

// Something about the caller: "I use a wheelchair", "we have two dogs", "my son needs oxygen". "keep me updated" and
// "keep my family safe" are not, so they are never mistaken for "remember this".
const ABOUT_CALLER =
  /^(?:(?:i|we)\s+(?:also\s+|really\s+|still\s+|always\s+|currently\s+|now\s+)?(?:use|used|have|had|need|needed|am|'m|m|was|were|take|took|own|owned|got|require|rely on|depend on|live with|care for|walk with|cannot|can't|can not)\b|(?:my|our)\s+\w+(?:\s+\w+)?\s+(?:is|are|uses|needs|has|have|can't|cannot|requires)\b)/;
const REMEMBER_VERB = /(?:^|\b)(?:remember|save|store|keep(?: in mind)?|note|hold|record|add)(?: down)?(?: that| this| it)?(?: (?:data|information|info|details?|fact))?(?: that)? ((?:i|we|my|our)\b.+)$/;

/**
 * "remember I use a wheelchair", "what have you saved about me", "what did we talk about last time",
 * "forget me". Matched on the whole phrase shape so ordinary questions ("what do you know about the fire")
 * are never taken for a command.
 */
export function profileCommand(utterance: string): ProfileCommand | null {
  const text = spoken(utterance);
  const aboutDisaster = /\b(evacuat|fire|flood|shelter|warning|order|road|alert|quake|storm)/.test(text);
  // "delete my stored details", "delete all the data you have about me", "remove everything that's stored", "forget me".
  if (
    /\b(forget (me|everything|my (info|information|data|details|profile))|olvidame|olvida todo|borra (toda )?(mi|mis) (informacion|datos|perfil)|borra todo)\b/.test(text) ||
    (!aboutDisaster &&
      /\b(?:delete|remove|erase|wipe|clear|purge|get rid of|destroy)\b.{0,40}\b(?:data|info|information|details|profile|history|records?|everything|memory|stored|saved)\b/.test(text) &&
      /\b(?:my|me|mine|caller id|number|stored|saved|you (?:have|got|know|keep)|that you|all that|everything)\b/.test(text))
  ) {
    return { kind: "forget" };
  }
  // Not about a disaster: "call me back so you can verify me", "am I verified". These never reach the model, which used to
  // read "call me back" as "set up updates". Topic words keep "call me back to confirm the evacuation order" out.
  if (
    !aboutDisaster &&
    /\b(?:(?:call|ring|phone|dial) me back\b.{0,40}\b(?:confirm|verify|authenticate|make sure it'?s me)|(?:verify|confirm|authenticate)\b.{0,12}\b(?:me|my identity|that it'?s me|it'?s me|my number|my phone)|confirm with me|i (?:want|need|would like) (?:you )?to (?:verify|confirm)|(?:am i|are we) (?:not )?(?:already )?(?:verified|confirmed))\b/.test(text)
  ) {
    return { kind: "verify" };
  }
  // "what updates you have about me": the caller's own updates (not "any updates for me near San Francisco").
  if (!aboutDisaster && /\bupdates?\b.{0,25}\b(?:about|on) me\b/.test(text)) return { kind: "updates" };
  // "what updates do I have", "what did I ask you to call me back about", "what are you watching for me".
  if (
    /\b(?:updates?|alerts?|notifications?|callbacks?)\b.{0,50}\b(?:connected|related|relating|tied|linked|associated|attached)\b.{0,15}\b(?:to |with )?(?:me|my|this)\b|\b(?:set up|setup|signed up|created|made|have|had|got|requested)\b.{0,30}\b(?:updates?|alerts?|notifications?|callbacks?)\b.{0,30}\b(?:previously|before|already|earlier|last time)\b|\b(?:previously|already|earlier)\b.{0,30}\b(?:set up|setup|signed up|requested)\b.{0,30}\b(?:updates?|alerts?|notifications?)\b|\b(what|which) (updates?|alerts?|notifications?|callbacks?|calls?) (do|did|have|am|are) (i|you|we)\b.{0,40}\b(have|ask(ed)?|set up|request(ed)?|signed up|subscribed|watching|waiting)\b|\bwhat (did|do) i ask you to (call|notify|update|tell)\b|\bwhat (am i|are we) (signed up|subscribed)\b|\bwhat are you (watching|monitoring|tracking) (for|on) me\b|\bwhat (was|were) (it|the thing|the updates?) (that )?i asked (you )?(for|to)\b|\bwhat i asked you to call me back\b|\bwhat i (?:asked|requested)(?: you)?(?: for| about)?(?: earlier| before)?$|\basked you to (?:call|notify|update|tell|text) me(?: back)?\b.{0,30}\b(?:for|about)\b.{0,40}\bwhat\b|\bque (actualizaciones|alertas) tengo\b/.test(text)
  ) {
    return { kind: "updates" };
  }
  const remember = text.match(REMEMBER_VERB);
  if (remember && ABOUT_CALLER.test(remember[1])) return { kind: "remember", text: remember[1] };
  const recuerda = text.match(/^(?:por favor )?(?:recuerda|recuerde|guarda|guarde|anota|anote)(?: que)? (.+)$/);
  if (recuerda) return { kind: "remember", text: recuerda[1] };
  if (
    /\b(what did (we|i) (talk|discuss|ask)( you)? about|(recap|summary|summarize|go over|remind me)\b.{0,40}\b(last|previous|earlier)\b.{0,20}\b(call|time|conversation)|(last|previous|earlier) (call|time|conversation)\b.{0,30}\b(summary|recap)|de que hablamos|resumen de (mi |la )?(ultima|llamada anterior)|que hablamos (la ultima vez|antes))\b/.test(text)
  ) {
    return { kind: "recap" };
  }
  if (
    /^(what (do you|have you|did you) (know|saved|stored|remember|keep|got)( about me| for me| on me)?|what (info|information|details) (do you|have you) (have|got|saved|stored)( about| on| for)? me|what do you have (about|on) me|do you have my (info|information|details)|what did i (tell|say to) you|what('?s| is) (saved|stored)( about me| for me)?|read (back )?my (info|information|profile|details|saved info)|que (sabes|tienes guardado|guardaste)( de mi| sobre mi)?|que tengo guardado)$/.test(text)
  ) {
    return { kind: "recall" };
  }
  // "do you remember if I used a wheelchair", "did I tell you about my dogs", "have I told you I take insulin".
  // Only when it goes on to talk about the caller ("I", "my", "we", "our"): "do you remember where I should go" and
  // "did I miss any alerts" are ordinary questions.
  if (
    /^(?:(?:do|can|could) you (?:remember|recall)|did i (?:tell|say|mention)(?: to)? you|have i (?:told|said|mentioned)(?: to)? you)(?: that| if| whether| about| anything about)? (?:i|my|we|our)\b/.test(text) &&
    !/\b(should|could|can i|where|when|how|why|evacuate|miss(?:ed)?)\b/.test(text) &&
    !/\b(?:last|previous|earlier) (?:call|conversation)\b/.test(text)
  ) {
    return { kind: "recall" };
  }
  // "the information you have about me", "do we have any previous conversations", "let me know about my previous calls".
  if (
    /\b(?:you|that you) (?:have|know|saved|stored|remember|keep|got)\b.{0,15}\b(?:about|on) me\b/.test(text) ||
    (/\b(?:previous|past|earlier|prior) (?:calls?|conversations?|chats?|history)\b/.test(text) && /\b(?:me|my|our|we|us|i)\b/.test(text) && !aboutDisaster) ||
    /\b(?:have|did) (?:we|i) (?:talked?|spoken|spoke|called) (?:to each other |with you |to you )?before\b/.test(text)
  ) {
    return { kind: "recall" };
  }
  // "do you remember me", "I called you earlier, do you remember", "remember my last call" ask for history.
  if (
    /\b(?:do you|can you|could you) (?:remember|recall) (?:me|that i called|my (?:earlier|last|previous) (?:call|conversation)|what i (?:told|said)|what we (?:talked|spoke) about)\b/.test(text) ||
    /\bi (?:called|talked to|spoke to|spoke with) you (?:earlier|before|yesterday|today|last time)\b.{0,40}\b(?:remember|recall)\b/.test(text) ||
    /\b(?:if|whether) you (?:remember|recall) (?:that )?i (?:called|talked to|spoke to|spoke with)\b/.test(text)
  ) {
    return { kind: "recap" };
  }
  if (/^(?:do you (?:know|have)|have you (?:got|saved|stored)) (?:anything|something|much|what)? ?(?:about|on) me$|^(?:te acuerdas|recuerdas|sabes)(?: de)?(?: si| que)? (?:uso|tengo|necesito|soy|tomo)\b/.test(text)) {
    return { kind: "recall" };
  }
  return null;
}

export function isConfirmation(utterance: string): boolean {
  return /^(yes|yeah|yep|yup|sure|confirm|confirmed|do it|delete it|go ahead|si|claro|confirmo|dale)\b/.test(flat(utterance));
}

export function isRefusal(utterance: string): boolean {
  return /^(no|nope|cancel|never mind|nevermind|don'?t|stop|cancela|cancelar|no gracias)\b/.test(flat(utterance));
}

/**
 * Did the caller actually ask to be called or told? A follow-up (an update subscription) is only created when they did:
 * "do you have updates connected to my phone" and a bare "yes" are not requests, and the model used to create one anyway.
 */
export function explicitFollowUpRequest(utterance: string): boolean {
  return test(
    /\b(call me|ring me|phone me|text me|notify me|alert me|remind me|let me know|keep me (updated|posted|informed)|tell me (if|when)|send me|set (up )?(an? )?(update|updates|notification|notifications|alert|alerts|reminder|callback)|sign me up|subscribe|llamame|llameme|avisame|aviseme|mantenme|mantengame|notificame)\b/,
    utterance,
  );
}
