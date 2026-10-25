"""[V] Every phrase the voice agent speaks on its own, in English and Spanish. Plain language.

None of these states a disaster fact: facts only ever come from the backend. Safety-relevant lines
always include the 911 instruction. Keep `FALLBACK` in step with `fallback` in src/orchestration/phrases.ts.
"""

from __future__ import annotations

PHRASES: dict[str, dict[str, str]] = {
    # The backend could not be reached for a turn (timeout, network, non-200, invalid body).
    "fallback": {
        "en": "Sorry, I'm having trouble reaching the information service. If you are in danger, hang up and dial 911 now.",
        "es": "Lo siento, tengo problemas para comunicarme con el servicio de información. Si está en peligro, cuelgue y marque 911 ahora.",
    },
    # After too many consecutive failures; the call ends after this.
    "give_up": {
        "en": "I'm sorry, I still can't reach the information service. If you are in danger, hang up and dial 911 now. Please call back in a few minutes. Goodbye.",
        "es": "Lo siento, todavía no puedo comunicarme con el servicio de información. Si está en peligro, cuelgue y marque 911 ahora. Por favor, vuelva a llamar en unos minutos. Adiós.",
    },
    # Session start failed: the call continues and the first turn starts the session lazily.
    "greeting_fallback": {
        "en": "This is Soterra, the disaster information line. If you are in immediate danger, hang up and dial 911. This call is transcribed. What would you like to know?",
        "es": "Habla Soterra, la línea de información sobre desastres. Si está en peligro inmediato, cuelgue y marque 911. Esta llamada se transcribe. ¿Qué le gustaría saber?",
    },
    # Spoken once per turn when the backend has not answered within FILLER_AFTER_S. Neutral on purpose: it plays
    # whatever was asked (a news question, a question about the caller's own saved details, small talk).
    "filler": {
        "en": "One moment.",
        "es": "Un momento.",
    },
    # Optional (OFFER_SPANISH_DTMF=true), after the greeting. Always said in Spanish.
    "spanish_offer": {
        "en": "Para español, oprima dos.",
        "es": "For English, press one.",
    },
    "switched": {
        "en": "Okay, continuing in English. What would you like to know?",
        "es": "De acuerdo, seguimos en español. ¿Qué le gustaría saber?",
    },
    # An update call reached voicemail and the backend could not be reached for the short message; the call ends.
    "voicemail": {
        "en": "Hi, this is Soterra, the disaster information line, with the update you asked for. We'll text you the details. If you are in danger, call 911. Goodbye.",
        "es": "Hola, habla Soterra, la línea de información sobre desastres, con la actualización que pidió. Le enviaremos los detalles por mensaje de texto. Si está en peligro, llame al 911. Adiós.",
    },
    # Caller asked to repeat but nothing has been said yet.
    "nothing_to_repeat": {
        "en": "I haven't given you any information yet. What would you like to know?",
        "es": "Todavía no le he dado información. ¿Qué le gustaría saber?",
    },
}


def _lang(language: str) -> str:
    return "es" if language.lower().startswith("es") else "en"


def phrase(key: str, language: str) -> str:
    return PHRASES[key][_lang(language)]


# Used in turn, so back-to-back waits do not sound identical. The first one is PHRASES["filler"].
FILLER_VARIANTS: dict[str, tuple[str, ...]] = {
    "en": ("One moment.", "Let me check on that.", "Okay, one second.", "Give me just a moment."),
    "es": ("Un momento.", "Déjeme revisar eso.", "Un segundo, por favor.", "Permítame un momento."),
}


def filler(language: str, used_before: int) -> str:
    variants = FILLER_VARIANTS[_lang(language)]
    return variants[used_before % len(variants)]


def fallback(language: str) -> str:
    return phrase("fallback", language)


def greeting_fallback(language: str) -> str:
    return phrase("greeting_fallback", language)
