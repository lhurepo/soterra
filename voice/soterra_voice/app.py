"""[V] Builds the Line VoiceAgentApp: pre-call setup (session start + language/voice config) and get_agent."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from line.voice_agent_app import PreCallResult, VoiceAgentApp

from .agent import META_GREETING, META_LANGUAGE, META_SESSION_ID, SoterraAgent, call_info_from_request
from .backend_client import Backend, BackendError, backend_from_settings, now_ms
from .config import Settings, mask_phone, normalize_language
from .models import SessionStartRequest

log = logging.getLogger("soterra.voice")

PRE_CALL_TIMEOUT_S = 3.0


def call_config(settings: Settings, language: str) -> dict[str, Any]:
    """PreCallResult config: TTS voice/model/language and STT language (keys verified in SDK 0.2.19)."""
    tts: dict[str, Any] = {"voice_id": settings.voice_for(language), "model": settings.tts_model, "language": language}
    if settings.pronunciation_dict_id:
        tts["pronunciation_dict_id"] = settings.pronunciation_dict_id
    return {"tts": tts, "stt": {"language": language}}


def build_handlers(settings: Settings, backend: Optional[Backend] = None):
    """(get_agent, pre_call_handler) for VoiceAgentApp. main.py constructs VoiceAgentApp itself, because
    Cartesia's hosted build looks for `VoiceAgentApp` and `app.run()` in main.py."""
    backend = backend or backend_from_settings(settings)

    async def pre_call_handler(call_request: Any) -> PreCallResult:
        """Never rejects a call. Starts the session early only when the request clearly identifies the call,
        so a session can't be created under a placeholder id or without a caller number that does exist."""
        info = call_info_from_request(call_request, settings)
        language = info.language_hint or settings.default_language
        metadata: dict[str, Any] = {}
        has_real_id = info.provider_call_id not in ("", "unknown")
        if has_real_id and (info.caller_phone or info.direction == "outbound"):
            try:
                # The harness is waiting on this request: keep it short; the agent retries if it fails.
                res = await asyncio.wait_for(backend.start_session(
                    SessionStartRequest(
                        provider_call_id=info.provider_call_id,
                        direction=info.direction,  # type: ignore[arg-type]
                        caller_phone=info.caller_phone,
                        called_phone=info.called_phone,
                        language_hint=info.language_hint,
                        notification_id=info.notification_id,
                        provider_agent_call_id=info.agent_call_id,
                        started_at=now_ms(),
                    )
                ), timeout=min(settings.turn_timeout_s, PRE_CALL_TIMEOUT_S))
                language = normalize_language(res.language) or language
                metadata = {META_SESSION_ID: res.session_id, META_LANGUAGE: language, META_GREETING: res.greeting}
            except (BackendError, asyncio.TimeoutError) as e:
                log.warning("pre-call session start failed (%s); the agent will retry", e or "timeout")
        log.info("pre-call %s from=%s language=%s", info.provider_call_id, mask_phone(info.caller_phone), language)
        return PreCallResult(metadata=metadata, config=call_config(settings, language))

    async def get_agent(env: Any, call_request: Any) -> SoterraAgent:
        # Default filters: run on CallStarted/UserTurnEnded/CallEnded, cancel on UserTurnStarted (barge-in).
        metadata = getattr(call_request, "metadata", None) or {}
        info = call_info_from_request(call_request, settings)
        # Masked: enough to confirm on real calls what Cartesia sends (ids, direction, which metadata keys).
        log.info(
            "call_request call_id=%s agent_call_id=%s from=%s to=%s direction=%s notification=%s metadata_keys=%s",
            info.provider_call_id, info.agent_call_id, mask_phone(getattr(call_request, "from_", None)),
            mask_phone(getattr(call_request, "to", None)), info.direction, info.notification_id, sorted(metadata.keys()),
        )
        return SoterraAgent(backend, info, settings, prestarted=metadata)

    return get_agent, pre_call_handler


def build_app(settings: Settings, backend: Optional[Backend] = None) -> VoiceAgentApp:
    get_agent, pre_call_handler = build_handlers(settings, backend)
    return VoiceAgentApp(get_agent=get_agent, pre_call_handler=pre_call_handler)
