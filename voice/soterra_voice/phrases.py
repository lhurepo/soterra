"""[V] Fixed fallback phrases spoken when the backend fails or times out. Always include the 911 line.

Keep the wording in sync with `fallback` in src/orchestration/phrases.ts.
"""

FALLBACK = {
    "en": "Sorry, I'm having trouble right now. If you are in immediate danger, hang up and dial 911.",
    "es": "Lo siento, tengo problemas en este momento. Si está en peligro inmediato, cuelgue y marque 911.",
}

GREETING_FALLBACK = {
    "en": "This is Soterra. I'm having trouble reaching my information right now. If you are in immediate danger, hang up and dial 911.",
    "es": "Habla Soterra. Tengo problemas para consultar la información en este momento. Si está en peligro inmediato, cuelgue y marque 911.",
}


def _lang(language: str) -> str:
    return "es" if language.lower().startswith("es") else "en"


def fallback(language: str) -> str:
    return FALLBACK[_lang(language)]


def greeting_fallback(language: str) -> str:
    return GREETING_FALLBACK[_lang(language)]
