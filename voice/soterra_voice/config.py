"""[V] Voice service configuration, read once from the environment. Fails fast with a clear message.

Voice IDs, languages and the dialed-number map live here (env), never in code paths.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Literal, Mapping, Optional

SUPPORTED_LANGUAGES = ("en", "es")

# Sonic 3.6 "Jacqueline" (en-US, female), listed by Cartesia among its stable voices (verified 2026-10-24).
# Cartesia: "Every voice can speak every language the model supports", so one voice can serve en and es.
DEFAULT_VOICE_ID = "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
DEFAULT_TTS_MODEL = "sonic-3.6"

E164 = re.compile(r"^\+[1-9]\d{6,14}$")


class ConfigError(ValueError):
    """Raised at startup when required settings are missing or malformed."""


def normalize_language(value: Optional[str]) -> Optional[str]:
    """BCP-47 → primary subtag if we support it ("es-US" → "es"), else None."""
    if not value:
        return None
    primary = value.strip().lower().split("-")[0]
    return primary if primary in SUPPORTED_LANGUAGES else None


def parse_language_map(raw: str) -> dict[str, str]:
    """`+14155550100:es,+14155550101:en` → {"+14155550100": "es", ...}."""
    result: dict[str, str] = {}
    for entry in filter(None, (e.strip() for e in raw.split(","))):
        number, _, lang = entry.partition(":")
        number, language = number.strip(), normalize_language(lang)
        if not E164.match(number) or language is None:
            raise ConfigError(f"LANGUAGE_BY_DIALED_NUMBER entry {entry!r} must look like +14155550100:es (en or es)")
        result[number] = language
    return result


def parse_numbers(raw: str) -> frozenset[str]:
    """`+17126003362,+14155550100` → frozenset of E.164 numbers."""
    numbers = [n.strip() for n in raw.split(",") if n.strip()]
    bad = [n for n in numbers if not E164.match(n)]
    if bad:
        raise ConfigError(f"SOTERRA_PHONE_NUMBERS must be E.164 numbers, got {bad[0]!r}")
    return frozenset(numbers)


def _float(env: Mapping[str, str], name: str, default: float) -> float:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError as e:
        raise ConfigError(f"{name} must be a number of seconds, got {raw!r}") from e
    if value <= 0:
        raise ConfigError(f"{name} must be positive")
    return value


def _bool(env: Mapping[str, str], name: str) -> bool:
    return env.get(name, "").strip().lower() in ("1", "true", "yes")


@dataclass(frozen=True)
class Settings:
    backend_mode: Literal["http", "mock"] = "mock"
    backend_url: Optional[str] = None
    voice_api_secret: Optional[str] = field(default=None, repr=False)
    default_language: str = "en"
    turn_timeout_s: float = 8.0
    filler_after_s: float = 1.6
    end_session_timeout_s: float = 2.0
    max_consecutive_failures: int = 3
    voice_ids: dict[str, str] = field(default_factory=lambda: {"en": DEFAULT_VOICE_ID, "es": DEFAULT_VOICE_ID})
    tts_model: str = DEFAULT_TTS_MODEL
    pronunciation_dict_id: Optional[str] = None
    language_by_dialed_number: dict[str, str] = field(default_factory=dict)
    # Our own Cartesia numbers: a call whose `from` is one of these is an outbound callback.
    own_numbers: frozenset[str] = frozenset()
    offer_spanish_dtmf: bool = False
    # Outbound callbacks: wait this long for whoever answers to speak before greeting, so an answering machine's
    # prompt is heard first (then the backend leaves a short voicemail) instead of the greeting being recorded.
    outbound_greeting_wait_s: float = 2.0
    mock_conversation: Optional[str] = None

    def voice_for(self, language: str) -> str:
        return self.voice_ids.get(language) or self.voice_ids["en"]

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        env = os.environ if env is None else env
        mode = env.get("BACKEND_MODE", "http").strip().lower() or "http"
        if mode not in ("http", "mock"):
            raise ConfigError(f"BACKEND_MODE must be http or mock, got {mode!r}")
        url = env.get("SOTERRA_BACKEND_URL", "").strip() or None
        secret = env.get("VOICE_API_SECRET", "").strip() or None
        if mode == "http":
            missing = [n for n, v in (("SOTERRA_BACKEND_URL", url), ("VOICE_API_SECRET", secret)) if not v]
            if missing:
                raise ConfigError(f"BACKEND_MODE=http needs {', '.join(missing)} (or set BACKEND_MODE=mock)")
            if not url.startswith("https://") and not url.startswith("http://localhost") and not url.startswith("http://127.0.0.1"):
                raise ConfigError("SOTERRA_BACKEND_URL must be the https://<deployment>.convex.site URL")
        default_language = normalize_language(env.get("DEFAULT_LANGUAGE", "en"))
        if default_language is None:
            raise ConfigError("DEFAULT_LANGUAGE must be en or es")
        voice_en = env.get("VOICE_ID_EN", "").strip() or DEFAULT_VOICE_ID
        voice_es = env.get("VOICE_ID_ES", "").strip() or voice_en
        max_failures = env.get("MAX_CONSECUTIVE_FAILURES", "3").strip() or "3"
        if not max_failures.isdigit() or int(max_failures) < 1:
            raise ConfigError("MAX_CONSECUTIVE_FAILURES must be a positive integer")
        return cls(
            backend_mode=mode,  # type: ignore[arg-type]
            backend_url=url.rstrip("/") if url else None,
            voice_api_secret=secret,
            default_language=default_language,
            turn_timeout_s=_float(env, "TURN_TIMEOUT_S", 8.0),
            filler_after_s=_float(env, "FILLER_AFTER_S", 1.6),
            end_session_timeout_s=_float(env, "END_SESSION_TIMEOUT_S", 2.0),
            max_consecutive_failures=int(max_failures),
            voice_ids={"en": voice_en, "es": voice_es},
            tts_model=env.get("TTS_MODEL", "").strip() or DEFAULT_TTS_MODEL,
            pronunciation_dict_id=env.get("PRONUNCIATION_DICT_ID", "").strip() or None,
            language_by_dialed_number=parse_language_map(env.get("LANGUAGE_BY_DIALED_NUMBER", "")),
            own_numbers=parse_numbers(env.get("SOTERRA_PHONE_NUMBERS", "")),
            offer_spanish_dtmf=_bool(env, "OFFER_SPANISH_DTMF"),
            outbound_greeting_wait_s=_float(env, "OUTBOUND_GREETING_WAIT_S", 2.0),
            mock_conversation=env.get("MOCK_CONVERSATION", "").strip() or None,
        )


def mask_phone(number: Optional[str]) -> str:
    """`+14155559876` → `+1415***9876`. Never log a full caller number."""
    if not number:
        return "-"
    if len(number) <= 8:
        return "***"
    return f"{number[:5]}***{number[-4:]}"
