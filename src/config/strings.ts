// [B] Canonical spoken wording, English and Spanish.
//
// ⚠️ HUMAN REVIEW REQUIRED BEFORE THE DEMO. Every safety-critical sentence Soterra speaks is a fixed
// string in this file, never model output. A fluent English speaker and a native Spanish speaker must
// review the wording (especially `safety`, `fallback`, `noInfo`, `transcriptionNotice`, `stopUpdates`,
// `callbackDeclined` and the attribution templates) before any real caller hears it.
// The voice agent's own fallback line lives in voice/soterra_voice/phrases.py: keep `fallback` in sync.
//
// Tests import these strings; never copy them into test files.
import { supportedLanguage, type SupportedLanguage } from "./defaults";

const STRINGS = {
  en: {
    welcome: "This is Soterra, the disaster information line.",
    emergencyLine: "If you are in immediate danger, hang up and dial 911.",
    transcriptionNotice:
      "This call is transcribed; say \"summary only\" to keep just a summary.",
    askQuestion: "What would you like to know?",
    // Personal commands: only on a call that passed the callback check (docs/backend.md, "Caller memory").
    verifyAnnounce: "For your privacy, I'll call you back at this number to confirm it's you. Please hang up and answer when I call.",
    verifyHidden: "I can't do that because your number is hidden. Please call again without hiding your number.",
    verifyLimited: "I've already tried to call you back a few times. Please try again in a while.",
    verifyIntro: "This is Soterra calling you back to confirm it's you.",
    verifyAsk: "What would you like to save or hear? You can say remember, then what you need, or ask what I have saved.",
    profileSaved: "Okay, I saved that: {need}. Ask what I have saved any time, or say forget me to delete it.",
    profileRejected: "I can't save addresses or phone numbers. You can tell me what you need, like a wheelchair or pets.",
    profileFull: "I'm already keeping five things for you. Say forget me to start over.",
    profileEmpty: "I don't have anything saved for this number. Say remember, then what you need, like I use a wheelchair.",
    profileRecall: "Here's what I have saved: {needs}. Say forget me to delete it.",
    recapNone: "I don't have a summary of an earlier call.",
    recapSummary: "Last time: {summary}",
    updatesList: "I'm watching for: {topics}. Say stop updates to cancel them.",
    updatesNone: "You don't have any updates set up. Say call me if the evacuation changes, and I'll set one up.",
    forgetAsk: "I'll delete everything I saved about this number, and stop any updates. Say yes to confirm.",
    forgetDone: "Done. I deleted what I saved about this number and stopped any updates. Call transcripts are removed within a week.",
    forgetCancelled: "Okay, I kept everything.",
    outboundIntro: "This is Soterra calling with the update you asked for.",
    outboundInvite: "You can ask me a question about it now, or hang up.",
    stopUpdates: "To stop these updates, say \"stop updates\" now or on any call to this line.",
    safety:
      "If you are in immediate danger, hang up and dial 911 now. I can't send help or contact emergency services for you. Once you are safe, you can call back for information.",
    fallback: "Sorry, I can't find that answer right now. If you are in immediate danger, hang up and dial 911.",
    noInfo:
      "I don't know yet. I don't have verified official information about that, so I've saved your question. If you are in immediate danger, dial 911.",
    consentDeclined: "Okay. I'll keep only a short summary of this call, not the transcript.",
    followupCreated: "Okay. I'll call this number if there are official updates about {topic}, for the next {hours} hours.",
    topicIncident: "this incident",
    topicEvacuation: "evacuations for this incident",
    topicSeverity: "changes in severity for this incident",
    topicQuestion: "your question",
    topicArea: "{area}",
    callbackDeclined: "I can't call you back because your number is hidden. Please call this line again for updates.",
    updatesStopped: "Okay. I've stopped any updates to this number. You won't get more update calls from Soterra.",
    goodbye: "Thank you for calling Soterra. Stay safe. If you are in immediate danger, dial 911.",
    clarifyArea: "What city, county or ZIP code are you asking about?",
    addressRefusal:
      "I can't confirm whether a specific address is inside a zone. Please check the official zone lookup for your address.",
    // Attribution is kept to about five words ("Sonoma County Fire, 2:10 PM."); callers can ask for the full source.
    attribution: "{source}, {time}.",
    attributionStale: "{source}, as of {time}.",
    attributionObserved: "{source}, checked {time}.",
    attributionPageUpdated: "{source}, updated {time}.",
    // Corroboration (src/retrieval/corroboration.ts): spoken only when another independent source matched.
    corroborated: "Also reported by {sources}.",
    sourcesDiffer: "Sources differ on the figures.",
    issued: "issued",
    updated: "updated",
    updateMessage: "Update from {source}, {time}: {title}. {detail}",
    answerMessage: "Update on your question, \"{question}\": {answer} That's from {source}, {time}.",
  },
  es: {
    welcome: "Habla Soterra, la línea de información sobre desastres.",
    emergencyLine: "Si está en peligro inmediato, cuelgue y marque 911.",
    transcriptionNotice:
      "Esta llamada se transcribe; diga \"solo resumen\" para guardar solo un resumen.",
    askQuestion: "¿Qué le gustaría saber?",
    verifyAnnounce: "Por su privacidad, le devolveré la llamada a este número para confirmar que es usted. Por favor cuelgue y conteste cuando llame.",
    verifyHidden: "No puedo hacer eso porque su número está oculto. Por favor llame de nuevo sin ocultar su número.",
    verifyLimited: "Ya intenté devolverle la llamada varias veces. Por favor intente de nuevo en un rato.",
    verifyIntro: "Habla Soterra, le devuelvo la llamada para confirmar que es usted.",
    verifyAsk: "¿Qué le gustaría guardar o escuchar? Puede decir recuerda, y luego lo que necesita, o preguntar qué tengo guardado.",
    profileSaved: "De acuerdo, guardé esto: {need}. Pregunte qué tengo guardado cuando quiera, o diga olvídame para borrarlo.",
    profileRejected: "No puedo guardar direcciones ni números de teléfono. Puede decirme lo que necesita, como una silla de ruedas o mascotas.",
    profileFull: "Ya estoy guardando cinco cosas para usted. Diga olvídame para empezar de nuevo.",
    profileEmpty: "No tengo nada guardado para este número. Diga recuerda, y luego lo que necesita, por ejemplo uso silla de ruedas.",
    profileRecall: "Esto es lo que tengo guardado: {needs}. Diga olvídame para borrarlo.",
    recapNone: "No tengo un resumen de una llamada anterior.",
    recapSummary: "La última vez: {summary}",
    updatesList: "Estoy atento a: {topics}. Diga parar actualizaciones para cancelarlas.",
    updatesNone: "No tiene actualizaciones configuradas. Diga llámeme si cambia la evacuación, y la configuro.",
    forgetAsk: "Voy a borrar todo lo que guardé sobre este número y a detener las actualizaciones. Diga sí para confirmar.",
    forgetDone: "Listo. Borré lo que guardé sobre este número y detuve las actualizaciones. Las transcripciones de llamadas se eliminan en una semana.",
    forgetCancelled: "De acuerdo, conservé todo.",
    outboundIntro: "Habla Soterra con la actualización que usted pidió.",
    outboundInvite: "Puede hacerme una pregunta sobre esto ahora, o colgar.",
    stopUpdates: "Para dejar de recibir estas actualizaciones, diga \"parar actualizaciones\" ahora o en cualquier llamada a esta línea.",
    safety:
      "Si está en peligro inmediato, cuelgue y marque 911 ahora. Yo no puedo enviar ayuda ni comunicarme con los servicios de emergencia por usted. Cuando esté a salvo, puede volver a llamar para información.",
    fallback: "Lo siento, no puedo encontrar esa respuesta en este momento. Si está en peligro inmediato, cuelgue y marque 911.",
    noInfo:
      "Todavía no lo sé. No tengo información oficial verificada sobre eso, así que guardé su pregunta. Si está en peligro inmediato, marque 911.",
    consentDeclined: "De acuerdo. Guardaré solo un resumen breve de esta llamada, no la transcripción.",
    followupCreated: "De acuerdo. Llamaré a este número si hay actualizaciones oficiales sobre {topic}, durante las próximas {hours} horas.",
    topicIncident: "este incidente",
    topicEvacuation: "las evacuaciones de este incidente",
    topicSeverity: "cambios en la gravedad de este incidente",
    topicQuestion: "su pregunta",
    topicArea: "{area}",
    callbackDeclined:
      "No puedo devolverle la llamada porque su número está oculto. Por favor, vuelva a llamar a esta línea para recibir novedades.",
    updatesStopped: "De acuerdo. Detuve las actualizaciones a este número. No recibirá más llamadas de actualización de Soterra.",
    goodbye: "Gracias por llamar a Soterra. Cuídese. Si está en peligro inmediato, marque 911.",
    clarifyArea: "¿Sobre qué ciudad, condado o código postal pregunta?",
    addressRefusal:
      "No puedo confirmar si una dirección específica está dentro de una zona. Consulte la búsqueda oficial de zonas para su dirección.",
    attribution: "Fuente: {source}, {time}.",
    attributionStale: "Fuente: {source}, a partir de {time}.",
    attributionObserved: "Fuente: {source}, revisado {time}.",
    attributionPageUpdated: "Fuente: {source}, actualizado {time}.",
    corroborated: "También lo informa {sources}.",
    sourcesDiffer: "Las fuentes difieren en las cifras.",
    issued: "emitido el",
    updated: "actualizado el",
    updateMessage: "Actualización de {source}, {time}: {title}. {detail}",
    answerMessage: "Actualización sobre su pregunta, \"{question}\": {answer} Fuente: {source}, {time}.",
  },
} as const satisfies Record<SupportedLanguage, Record<string, string>>;

export type StringKey = keyof (typeof STRINGS)["en"];

export const STRING_LANGUAGES = Object.keys(STRINGS) as SupportedLanguage[];

/** The canonical string for a key in the caller's language (anything but Spanish gets English). */
export function t(key: StringKey, language: string | undefined): string {
  return STRINGS[supportedLanguage(language)][key];
}

/** Fills `{name}` placeholders. Unknown placeholders are left as-is so a missing value is visible in tests. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function tf(key: StringKey, language: string | undefined, vars: Record<string, string | number>): string {
  return fill(t(key, language), vars);
}

/** Every key in every language, for the "strings exist in both languages" test. */
export function allStrings(): Record<SupportedLanguage, Record<StringKey, string>> {
  return STRINGS;
}
