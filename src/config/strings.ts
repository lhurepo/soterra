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
    welcome: "This is Soterra, the disaster info line.",
    emergencyLine: "In danger? Hang up and dial 911.",
    transcriptionNotice: "This call is transcribed.",
    askQuestion: "How can I help?",
    // Personal commands: only on a call that passed the callback check (docs/backend.md, "Caller memory").
    verifyAnnounce: "For your privacy, I'll call you back at this number to confirm it's you. Please hang up and answer when I call.",
    verifyHidden: "I can't do that because your number is hidden. Please call again without hiding your number.",
    verifyLimited: "I've already tried to call you back a few times. Please try again in a while.",
    verifyIntro: "This is Soterra, calling to confirm it's you.",
    verifyAsk: "What would you like to save or hear? You can say remember, then what you need, or ask what I have saved.",
    profileSaved: "Okay, I saved that: {need}. Ask what I have saved any time, or say forget me to delete it.",
    profileRejected: "I can't save addresses or phone numbers. You can tell me what you need, like a wheelchair or pets.",
    profileFull: "I'm already keeping five things for you. Say forget me to start over.",
    profileEmpty: "I don't have anything saved for this number. Say remember, then what you need, like I use a wheelchair.",
    profileRecall: "Here's what I have saved: {needs}. Say forget me to delete it.",
    recapNone: "I don't have a summary of an earlier call.",
    recapSummary: "Last time: {summary}",
    followupUnclear: "I haven't set anything up. To get a call when something changes, say call me if the evacuation changes, or call me if there are updates. To hear what you already have, say what updates do I have.",
    appVerifiedNote: "You're calling from the app, so you're confirmed.",
    appCodeIntro: "Hi, this is Soterra. Your code for the app is {code}. Again, {code}. If you didn't ask for this, just hang up.",
    appCodeExpired: "Hi, this is Soterra. That app code has expired. Please ask for a new one in the app. You can hang up now.",
    verifiedAlready: "You're confirmed on this call. Say what do you know about me, or what updates do I have, or tell me something to remember.",
    updatesList: "I'm watching for: {topics}. Say stop updates to cancel them.",
    updatesNone: "You don't have any updates set up. Say call me if the evacuation changes, and I'll set one up.",
    forgetAsk: "I'll delete everything I saved about this number, and stop any updates. Say yes to confirm.",
    forgetDone: "Done. I deleted what I saved about this number and stopped any updates. Call transcripts are removed within a week.",
    forgetCancelled: "Okay, I kept everything.",
    outboundIntro: "Hi, this is Soterra. I'm calling about the update you asked for.",
    // An update call that reached voicemail: a short message, then hang up (the update follows by text).
    outboundVoicemail: "Hi, this is Soterra, the disaster information line, with the update you asked for on {topic}. We'll text you the details. If you are in danger, call 911. Goodbye.",
    outboundInvite: "Any questions about it?",
    stopUpdates: "Say stop updates any time to cancel these calls.",
    safety:
      "If you are in immediate danger, hang up and dial 911 now. I can't send help or contact emergency services for you. Once you are safe, you can call back for information.",
    fallback: "Sorry, I can't find that answer right now. If you are in immediate danger, hang up and dial 911.",
    noInfo:
      "I don't know that one yet, but I've saved your question.",
    consentDeclined: "Okay. I'll keep only a short summary of this call, not the transcript.",
    followupCreated: "Okay, I'll call you when there's news about {topic}.",
    followupCreatedSms: "Okay, I'll text you when there's news about {topic}.",
    followupScheduled: "Okay, I'll call you every {interval} with the latest on {topic}.",
    followupScheduledSms: "Okay, I'll text you every {interval} with the latest on {topic}.",
    followupMissedCallNote: "If you miss a call, I'll text you the update.",
    stopTexts: "To stop, reply STOP to any text, or say \"stop updates\" on a call to this line.",
    topicIncident: "this incident",
    topicEvacuation: "evacuations for this incident",
    topicSeverity: "changes in severity for this incident",
    topicQuestion: "your question",
    topicArea: "{area}",
    callbackDeclined: "I can't call you back because your number is hidden. Please call this line again for updates.",
    updatesStopped: "Okay. I've stopped any updates to this number. You won't get more update calls from Soterra.",
    goodbye: "Thank you for calling Soterra. Stay safe.",
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
    // Text messages (src/notifications/sms.ts).
    // Update texts: "Update on Cooley Fire (4:40 PM PT):", a blank line, "As of 2:22 PM PT: …", a blank line, how to stop.
    smsUpdateHeader: "Update on {topic} ({time}):",
    smsAsOf: "As of {time}: {summary}",
    smsNoChange: "No new official updates since {since}. Latest, as of {time}: {summary}",
    smsNoneYet: "No official updates yet. We'll check again in {interval}.",
    smsAnswer: "You asked: \"{question}\" As of {time}: {answer}",
    smsMissedLead: "We tried to call you.",
    smsEvery: "This is an update every {interval}.",
    smsStopTopic: "Reply {keyword} to stop receiving updates on {topic}.",
    smsStopAll: "Reply STOP to stop all Soterra texts.",
    smsHelp: "In danger? Call 911.",
    smsHelpHotline: "Questions? Call {hotline}. In danger? Call 911.",
    // Replies to "STOP <topic>" (POST /twilio/inbound).
    smsStopDone: "Soterra: you won't get more updates on {topics}. Reply STOP to stop all Soterra texts.",
    smsStopNoMatch: "Soterra: no active updates match \"{text}\". Reply STOP to stop all Soterra texts.",
    stopKeywordQuestion: "QUESTION",
    smsConfirmation: "Soterra: you'll get {items}, until {until}.",
    smsItemCalls: "calls about {topic} when officials post updates (a text if you miss one)",
    smsItemTexts: "texts about {topic} when officials post updates",
    smsItemScheduledCalls: "a call every {interval} about {topic}",
    smsItemScheduledTexts: "a text every {interval} about {topic}",
    smsFooter: "Reply STOP to stop all Soterra texts. In danger? Call 911.",
    smsFooterHotline: "Questions? Call {hotline}. Reply STOP to stop all Soterra texts. In danger? Call 911.",
    // Time-based updates (the same text is spoken on a scheduled call).
    scheduledNoChange: "No new official updates about {topic} since {since}. Latest from {source}, {time}: {title}.",
    scheduledNone: "There are no official updates about {topic} right now. I'll check again in {interval}.",
    topicQuestionText: "your question",
  },
  es: {
    welcome: "Habla Soterra, la línea de información sobre desastres.",
    emergencyLine: "¿En peligro? Cuelgue y marque 911.",
    transcriptionNotice: "Esta llamada se transcribe.",
    askQuestion: "¿En qué le puedo ayudar?",
    verifyAnnounce: "Por su privacidad, le devolveré la llamada a este número para confirmar que es usted. Por favor cuelgue y conteste cuando llame.",
    verifyHidden: "No puedo hacer eso porque su número está oculto. Por favor llame de nuevo sin ocultar su número.",
    verifyLimited: "Ya intenté devolverle la llamada varias veces. Por favor intente de nuevo en un rato.",
    verifyIntro: "Habla Soterra, le llamo para confirmar que es usted.",
    verifyAsk: "¿Qué le gustaría guardar o escuchar? Puede decir recuerda, y luego lo que necesita, o preguntar qué tengo guardado.",
    profileSaved: "De acuerdo, guardé esto: {need}. Pregunte qué tengo guardado cuando quiera, o diga olvídame para borrarlo.",
    profileRejected: "No puedo guardar direcciones ni números de teléfono. Puede decirme lo que necesita, como una silla de ruedas o mascotas.",
    profileFull: "Ya estoy guardando cinco cosas para usted. Diga olvídame para empezar de nuevo.",
    profileEmpty: "No tengo nada guardado para este número. Diga recuerda, y luego lo que necesita, por ejemplo uso silla de ruedas.",
    profileRecall: "Esto es lo que tengo guardado: {needs}. Diga olvídame para borrarlo.",
    recapNone: "No tengo un resumen de una llamada anterior.",
    recapSummary: "La última vez: {summary}",
    followupUnclear: "No he configurado nada. Para recibir una llamada cuando algo cambie, diga llámeme si cambia la evacuación, o llámeme si hay actualizaciones. Para saber qué tiene ya, diga qué actualizaciones tengo.",
    appVerifiedNote: "Llama desde la aplicación, así que ya está confirmado.",
    appCodeIntro: "Hola, habla Soterra. Su código para la aplicación es {code}. Otra vez, {code}. Si no lo pidió, simplemente cuelgue.",
    appCodeExpired: "Hola, habla Soterra. Ese código de la aplicación venció. Pida uno nuevo en la aplicación. Ya puede colgar.",
    verifiedAlready: "Ya está confirmado en esta llamada. Diga qué sabes de mí, o qué actualizaciones tengo, o dígame algo para recordar.",
    updatesList: "Estoy atento a: {topics}. Diga parar actualizaciones para cancelarlas.",
    updatesNone: "No tiene actualizaciones configuradas. Diga llámeme si cambia la evacuación, y la configuro.",
    forgetAsk: "Voy a borrar todo lo que guardé sobre este número y a detener las actualizaciones. Diga sí para confirmar.",
    forgetDone: "Listo. Borré lo que guardé sobre este número y detuve las actualizaciones. Las transcripciones de llamadas se eliminan en una semana.",
    forgetCancelled: "De acuerdo, conservé todo.",
    outboundIntro: "Hola, habla Soterra. Le llamo por la actualización que pidió.",
    outboundVoicemail: "Hola, habla Soterra, la línea de información sobre desastres, con la actualización que pidió sobre {topic}. Le enviaremos los detalles por mensaje de texto. Si está en peligro, llame al 911. Adiós.",
    outboundInvite: "¿Tiene alguna pregunta sobre esto?",
    stopUpdates: "Diga parar actualizaciones cuando quiera para cancelar estas llamadas.",
    safety:
      "Si está en peligro inmediato, cuelgue y marque 911 ahora. Yo no puedo enviar ayuda ni comunicarme con los servicios de emergencia por usted. Cuando esté a salvo, puede volver a llamar para información.",
    fallback: "Lo siento, no puedo encontrar esa respuesta en este momento. Si está en peligro inmediato, cuelgue y marque 911.",
    noInfo:
      "Eso todavía no lo sé, pero guardé su pregunta.",
    consentDeclined: "De acuerdo. Guardaré solo un resumen breve de esta llamada, no la transcripción.",
    followupCreated: "De acuerdo, le llamaré cuando haya novedades sobre {topic}.",
    followupCreatedSms: "De acuerdo, le enviaré un mensaje cuando haya novedades sobre {topic}.",
    followupScheduled: "De acuerdo, le llamaré cada {interval} con lo último sobre {topic}.",
    followupScheduledSms: "De acuerdo, le enviaré un mensaje cada {interval} con lo último sobre {topic}.",
    followupMissedCallNote: "Si no contesta una llamada, le enviaré la actualización por mensaje de texto.",
    stopTexts: "Para dejar de recibirlas, responda STOP a cualquier mensaje, o diga \"parar actualizaciones\" en una llamada a esta línea.",
    topicIncident: "este incidente",
    topicEvacuation: "las evacuaciones de este incidente",
    topicSeverity: "cambios en la gravedad de este incidente",
    topicQuestion: "su pregunta",
    topicArea: "{area}",
    callbackDeclined:
      "No puedo devolverle la llamada porque su número está oculto. Por favor, vuelva a llamar a esta línea para recibir novedades.",
    updatesStopped: "De acuerdo. Detuve las actualizaciones a este número. No recibirá más llamadas de actualización de Soterra.",
    goodbye: "Gracias por llamar a Soterra. Cuídese.",
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
    smsUpdateHeader: "Actualización sobre {topic} ({time}):",
    smsAsOf: "Aviso oficial de las {time}: {summary}",
    smsNoChange: "No hay nuevas actualizaciones oficiales desde {since}. Lo más reciente, de las {time}: {summary}",
    smsNoneYet: "Aún no hay actualizaciones oficiales. Volveremos a revisar en {interval}.",
    smsAnswer: "Usted preguntó: \"{question}\" Respuesta de las {time}: {answer}",
    smsMissedLead: "Intentamos llamarle.",
    smsEvery: "Esta es una actualización cada {interval}.",
    smsStopTopic: "Responda {keyword} para dejar de recibir actualizaciones sobre {topic}.",
    smsStopAll: "Responda STOP para no recibir más mensajes de Soterra.",
    smsHelp: "¿En peligro? Llame al 911.",
    smsHelpHotline: "¿Preguntas? Llame al {hotline}. ¿En peligro? Llame al 911.",
    smsStopDone: "Soterra: no recibirá más actualizaciones sobre {topics}. Responda STOP para no recibir más mensajes de Soterra.",
    smsStopNoMatch: "Soterra: ninguna actualización activa coincide con \"{text}\". Responda STOP para no recibir más mensajes de Soterra.",
    stopKeywordQuestion: "PREGUNTA",
    smsConfirmation: "Soterra: recibirá {items}, hasta {until}.",
    smsItemCalls: "llamadas sobre {topic} cuando haya actualizaciones oficiales (un mensaje si no contesta)",
    smsItemTexts: "mensajes sobre {topic} cuando haya actualizaciones oficiales",
    smsItemScheduledCalls: "una llamada cada {interval} sobre {topic}",
    smsItemScheduledTexts: "un mensaje cada {interval} sobre {topic}",
    smsFooter: "Responda STOP para no recibir más mensajes de Soterra. ¿En peligro? Llame al 911.",
    smsFooterHotline: "¿Preguntas? Llame al {hotline}. Responda STOP para no recibir más mensajes de Soterra. ¿En peligro? Llame al 911.",
    scheduledNoChange: "No hay nuevas actualizaciones oficiales sobre {topic} desde {since}. Lo más reciente de {source}, {time}: {title}.",
    scheduledNone: "No hay actualizaciones oficiales sobre {topic} en este momento. Volveré a revisar en {interval}.",
    topicQuestionText: "su pregunta",
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
