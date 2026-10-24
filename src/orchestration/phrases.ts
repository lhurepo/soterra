// [B] Fixed, reviewed spoken phrases (en, es). Safety wording lives here, never in model output.
// Keep in sync with voice/soterra_voice/phrases.py for the fallback line.

export type PhraseLanguage = "en" | "es";

export function phraseLanguage(language: string): PhraseLanguage {
  return language.toLowerCase().startsWith("es") ? "es" : "en";
}

const PHRASES = {
  en: {
    greeting:
      "This is Soterra, the disaster information line. If you are in immediate danger, hang up and dial 911. " +
      "This call is transcribed to help answer you; say \"summary only\" if you'd rather we keep just a short summary. " +
      "What would you like to know?",
    outboundIntro: "This is Soterra calling with the update you asked for.",
    outboundOutro: "If you are in immediate danger, hang up and dial 911. You can ask me a question now, or hang up.",
    safety:
      "If you are in immediate danger, hang up and dial 911 now. I can't send help. Once you are safe, you can call back for information.",
    noInfo:
      "I don't know yet. I don't have verified official information about that, so I've saved your question. If you are in immediate danger, dial 911.",
    fallback: "Sorry, I'm having trouble right now. If you are in immediate danger, hang up and dial 911.",
    consentDeclined: "Okay. I'll keep only a short summary of this call, not the transcript.",
    followupCreated: "Okay. I'll call this number if official information about this changes, for up to seven days.",
    followupNoPhone:
      "I can't call you back because your number is hidden. Please call this line again for updates.",
    goodbye: "Thank you for calling Soterra. Stay safe. If you are in immediate danger, dial 911.",
    sourcePrefix: "That's from",
    issued: "issued",
    updated: "updated",
  },
  es: {
    greeting:
      "Habla Soterra, la línea de información sobre desastres. Si está en peligro inmediato, cuelgue y marque 911. " +
      "Esta llamada se transcribe para poder ayudarle; diga \"solo resumen\" si prefiere que guardemos solo un resumen breve. " +
      "¿Qué le gustaría saber?",
    outboundIntro: "Habla Soterra con la actualización que usted pidió.",
    outboundOutro: "Si está en peligro inmediato, cuelgue y marque 911. Puede hacerme una pregunta ahora o colgar.",
    safety:
      "Si está en peligro inmediato, cuelgue y marque 911 ahora. Yo no puedo enviar ayuda. Cuando esté a salvo, puede volver a llamar para información.",
    noInfo:
      "Todavía no lo sé. No tengo información oficial verificada sobre eso, así que guardé su pregunta. Si está en peligro inmediato, marque 911.",
    fallback: "Lo siento, tengo problemas en este momento. Si está en peligro inmediato, cuelgue y marque 911.",
    consentDeclined: "De acuerdo. Guardaré solo un resumen breve de esta llamada, no la transcripción.",
    followupCreated: "De acuerdo. Llamaré a este número si cambia la información oficial sobre esto, durante un máximo de siete días.",
    followupNoPhone:
      "No puedo devolverle la llamada porque su número está oculto. Por favor, vuelva a llamar a esta línea para recibir novedades.",
    goodbye: "Gracias por llamar a Soterra. Cuídese. Si está en peligro inmediato, marque 911.",
    sourcePrefix: "Fuente:",
    issued: "emitido el",
    updated: "actualizado el",
  },
} as const;

export type PhraseKey = keyof (typeof PHRASES)["en"];

export function phrase(key: PhraseKey, language: string): string {
  return PHRASES[phraseLanguage(language)][key];
}
