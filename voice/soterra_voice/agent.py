"""[V] SoterraAgent: owns the phone call (lifecycle, language, turn-taking, interruptions, latency, safe
failure) and relays every caller utterance to the backend. It never decides what to say about a disaster:
replies are spoken exactly as the backend returns them, and every local phrase lives in phrases.py.

Line SDK 0.2.19 facts this relies on (docs/DECISIONS.md):
- `process(env, event)` is an async generator; the runner runs it on CallStarted, UserTurnEnded and
  CallEnded, and cancels the in-flight task on UserTurnStarted (barge-in) or when the next run event arrives.
- The caller's words are the UserTextSent items in UserTurnEnded.content; keypad presses arrive there as
  UserDtmfSent items.
- AgentUpdateCall(language=…) sets both the STT and TTS language (SDK maps it to stt + tts config).
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any, AsyncIterator, Optional

from line.events import (
    AgentEndCall,
    AgentSendText,
    AgentTurnEnded,
    AgentTurnStarted,
    AgentUpdateCall,
    CallEnded,
    CallStarted,
    LogMetric,
    UserDtmfSent,
    UserTextSent,
    UserTurnEnded,
    UserTurnStarted,
)

from . import phrases
from .backend_client import Backend, BackendError, now_ms
from .config import E164, Settings, mask_phone, normalize_language
from .models import SessionEndRequest, SessionStartRequest, TurnRequest, TurnResponse

log = logging.getLogger("soterra.voice")

# Metadata keys the pre-call handler uses to hand a started session to the agent.
META_SESSION_ID = "soterra_session_id"
META_LANGUAGE = "soterra_language"
META_GREETING = "soterra_greeting"

REPEAT = re.compile(
    r"^\s*(?:please\s+|can you\s+|could you\s+)?(?:repeat(?: that| it)?|say (?:that|it) again|"
    r"(?:¿\s*)?(?:me\s+)?(?:lo\s+)?(?:puede|podría)\s+repetir|rep[ií]te(?:lo)?|rep[ií]ta(?:lo)?)"
    r"(?:\s*,?\s*please)?\s*(?:por favor)?\s*[.?!]*\s*$",
    re.IGNORECASE,
)


def is_repeat_request(utterance: str) -> bool:
    return bool(REPEAT.match(utterance))


@dataclass
class CallInfo:
    provider_call_id: str
    direction: str = "inbound"
    caller_phone: Optional[str] = None
    called_phone: Optional[str] = None
    notification_id: Optional[str] = None
    language_hint: Optional[str] = None
    agent_call_id: Optional[str] = None


def _e164(value: Optional[str]) -> Optional[str]:
    return value if value and E164.match(value) else None


def _notification_id(metadata: dict) -> Optional[str]:
    """notificationId from metadata, or from a nested dynamic_variables object (the outbound API's field)."""
    sources = [metadata, metadata.get("dynamic_variables") if isinstance(metadata.get("dynamic_variables"), dict) else {}]
    for source in sources:
        value = source.get("notificationId") or source.get("notification_id")
        if value:
            return str(value)
    return None


def call_info_from_request(call_request: Any, settings: Settings) -> CallInfo:
    """CallInfo from a Line CallRequest.

    An outbound callback is recognised by a notification id in metadata, or by `from` being one of our own
    numbers (SOTERRA_PHONE_NUMBERS): verified 2026-10-24 that Cartesia outbound calls are from our number to
    the person. Cartesia's agent_call_id is sent as providerAgentCallId; the backend stored the same id when
    it placed the call, so the call is tied to its notification even if metadata never arrives.
    """
    metadata = getattr(call_request, "metadata", None) or {}
    notification_id = _notification_id(metadata) if isinstance(metadata, dict) else None
    from_ = _e164(getattr(call_request, "from_", None))
    to = _e164(getattr(call_request, "to", None))
    outbound = notification_id is not None or (from_ is not None and from_ in settings.own_numbers and to not in settings.own_numbers)
    # On a callback we dialed the person: their number is `to`, ours is `from_`.
    caller, called = (to, from_) if outbound else (from_, to)
    agent_call_id = getattr(call_request, "agent_call_id", None)
    return CallInfo(
        provider_call_id=str(call_request.call_id),
        direction="outbound" if outbound else "inbound",
        caller_phone=caller,
        called_phone=called,
        notification_id=notification_id,
        language_hint=settings.language_by_dialed_number.get(called or ""),
        agent_call_id=str(agent_call_id) if agent_call_id and agent_call_id != "unknown" else None,
    )


def split_greeting(greeting: str) -> list[tuple[str, bool]]:
    """Speak the transcription-notice sentence uninterruptibly; everything else stays interruptible."""
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", greeting.strip()) if s]
    if not any(re.search(r"transcri", s, re.IGNORECASE) for s in sentences):
        return [(greeting.strip(), True)]
    parts: list[tuple[str, bool]] = []
    for s in sentences:
        interruptible = not re.search(r"transcri", s, re.IGNORECASE)
        if parts and parts[-1][1] == interruptible:
            parts[-1] = (f"{parts[-1][0]} {s}", interruptible)
        else:
            parts.append((s, interruptible))
    return parts


def barged_in(event: Any) -> bool:
    """Best-effort signal from history: the caller started this turn while the agent was still speaking
    (an AgentTurnStarted with no AgentTurnEnded before this turn's UserTurnStarted). The SDK reports what
    was spoken as AgentTextSent but not how much of a reply was cut off."""
    history = getattr(event, "history", None) or []
    for i in range(len(history) - 1, -1, -1):
        if isinstance(history[i], UserTurnStarted):
            for prior in reversed(history[:i]):
                if isinstance(prior, AgentTurnEnded):
                    return False
                if isinstance(prior, AgentTurnStarted):
                    return True
            return False
    return False


class SoterraAgent:
    def __init__(self, backend: Backend, call: CallInfo, settings: Settings, prestarted: Optional[dict] = None):
        self.backend = backend
        self.call = call
        self.settings = settings
        prestarted = prestarted or {}
        self.session_id: Optional[str] = prestarted.get(META_SESSION_ID)
        self._prestart_greeting: Optional[str] = prestarted.get(META_GREETING)
        self.language = (
            normalize_language(prestarted.get(META_LANGUAGE)) or call.language_hint or settings.default_language
        )
        self.turn_index = 0
        self.consecutive_failures = 0
        self.last_reply: Optional[str] = None
        self._interrupted = False
        self._ended = False
        self._agent_ended = False

    # ───────────────────────── dispatch ─────────────────────────

    async def process(self, env: Any, event: Any) -> AsyncIterator[Any]:
        if isinstance(event, CallStarted):
            async for out in self._on_call_started():
                yield out
        elif isinstance(event, UserTurnEnded):
            async for out in self._on_user_turn(event):
                yield out
        elif isinstance(event, CallEnded):
            await self._end("agent_end" if self._agent_ended else "caller_hangup")

    # ───────────────────────── call start ─────────────────────────

    async def _on_call_started(self) -> AsyncIterator[Any]:
        log.info(
            "call %s %s from=%s to=%s", self.call.provider_call_id, self.call.direction,
            mask_phone(self.call.caller_phone), mask_phone(self.call.called_phone),
        )
        greeting = self._prestart_greeting
        if self.session_id is None or greeting is None:
            try:
                t0 = asyncio.get_running_loop().time()
                res = await asyncio.wait_for(
                    self.backend.start_session(
                        SessionStartRequest(
                            provider_call_id=self.call.provider_call_id,
                            direction=self.call.direction,  # type: ignore[arg-type]
                            caller_phone=self.call.caller_phone,
                            called_phone=self.call.called_phone,
                            language_hint=self.call.language_hint,
                            notification_id=self.call.notification_id,
                            provider_agent_call_id=self.call.agent_call_id,
                            started_at=now_ms(),
                        )
                    ),
                    timeout=self.settings.turn_timeout_s,
                )
                yield LogMetric(name="backend_start_ms", value=round((asyncio.get_running_loop().time() - t0) * 1000))
                self.session_id, greeting = res.session_id, res.greeting
                language = normalize_language(res.language)
                if language and language != self.language:
                    self.language = language
                    yield self._language_update()
            except (BackendError, asyncio.TimeoutError) as e:
                log.error("session start failed (%s); first turn will start it via providerCallId", _err(e))
                yield LogMetric(name="backend_start_failed", value=1)
                greeting = None
        for text, interruptible in split_greeting(greeting or phrases.greeting_fallback(self.language)):
            yield AgentSendText(text=text, interruptible=interruptible)
        if self.settings.offer_spanish_dtmf and self.call.direction == "inbound":
            yield AgentSendText(text=phrases.phrase("spanish_offer", self.language))

    def _language_update(self) -> AgentUpdateCall:
        return AgentUpdateCall(language=self.language, voice_id=self.settings.voice_for(self.language))

    # ───────────────────────── turns ─────────────────────────

    async def _on_user_turn(self, event: UserTurnEnded) -> AsyncIterator[Any]:
        texts = [c.content for c in event.content if isinstance(c, UserTextSent)]
        buttons = [c.button for c in event.content if isinstance(c, UserDtmfSent)]
        utterance = " ".join(t.strip() for t in texts if t.strip()).strip()

        if not utterance:
            switch_to = {"1": "en", "2": "es"}.get(buttons[-1]) if buttons else None
            if switch_to and switch_to != self.language:
                self.language = switch_to
                yield self._language_update()
                yield AgentSendText(text=phrases.phrase("switched", self.language))
            return

        if is_repeat_request(utterance):
            yield AgentSendText(text=self.last_reply or phrases.phrase("nothing_to_repeat", self.language))
            return

        index = self.turn_index
        self.turn_index += 1
        interrupted = self._interrupted or barged_in(event)
        self._interrupted = False
        request = TurnRequest(
            session_id=self.session_id,
            provider_call_id=None if self.session_id else self.call.provider_call_id,
            turn_index=index,
            utterance=utterance,
            language=self.language,
            interrupted_previous=interrupted or None,
            received_at=now_ms(),
        )

        loop = asyncio.get_running_loop()
        t0 = loop.time()
        task = asyncio.create_task(self.backend.turn(request))
        response: Optional[TurnResponse] = None
        error: Optional[str] = None
        try:
            done, _ = await asyncio.wait({task}, timeout=self.settings.filler_after_s)
            if not done:
                yield AgentSendText(text=phrases.phrase("filler", self.language))
                yield LogMetric(name="filler_used", value=1)
            remaining = max(0.0, self.settings.turn_timeout_s - (loop.time() - t0))
            response = await asyncio.wait_for(task, timeout=remaining)
        except (asyncio.CancelledError, GeneratorExit):
            # Barge-in (or the next event): stop the HTTP request and tell the backend on the next turn.
            self._interrupted = True
            raise
        except asyncio.TimeoutError:
            error = "timeout"
        except BackendError as e:
            error = _err(e)
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

        elapsed_ms = round((loop.time() - t0) * 1000)
        if response is None:
            async for out in self._on_failure(index, error or "unknown", elapsed_ms):
                yield out
            return

        self.consecutive_failures = 0
        if self.session_id is None:
            self.session_id = response.session_id
        yield LogMetric(name="backend_turn_ms", value=elapsed_ms)
        log.info("turn %s kind=%s degraded=%s %d ms", index, response.kind, bool(response.degraded), elapsed_ms)
        self.last_reply = response.reply
        yield AgentSendText(text=response.reply)
        if response.end_call:
            self._agent_ended = True
            await self._end("agent_end")
            yield AgentEndCall()

    async def _on_failure(self, index: int, error: str, elapsed_ms: int) -> AsyncIterator[Any]:
        self.consecutive_failures += 1
        log.error("turn %s failed after %d ms: %s (%d in a row)", index, elapsed_ms, error, self.consecutive_failures)
        yield LogMetric(name="backend_turn_failed", value=1)
        if self.consecutive_failures >= self.settings.max_consecutive_failures:
            yield AgentSendText(text=phrases.phrase("give_up", self.language))
            self._agent_ended = True
            await self._end("error")
            yield AgentEndCall()
            return
        yield AgentSendText(text=phrases.fallback(self.language))

    # ───────────────────────── call end ─────────────────────────

    async def _end(self, reason: str) -> None:
        """Runs once per call. Short timeout: the backend's sweeper finalizes anything missed."""
        if self._ended:
            return
        self._ended = True
        try:
            await asyncio.wait_for(
                self.backend.end_session(
                    SessionEndRequest(
                        session_id=self.session_id,
                        provider_call_id=None if self.session_id else self.call.provider_call_id,
                        ended_at=now_ms(),
                        reason=reason,  # type: ignore[arg-type]
                    )
                ),
                timeout=self.settings.end_session_timeout_s,
            )
        except (BackendError, asyncio.TimeoutError) as e:
            log.warning("session end failed (%s); the backend sweeper will finalize the call", _err(e))


def _err(e: BaseException) -> str:
    return "timeout" if isinstance(e, asyncio.TimeoutError) else str(e)
