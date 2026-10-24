"""[V] Soterra custom Line agent. The agent does no reasoning: it forwards each finished caller turn to
the backend (`/voice/turn`) and speaks the reply. Any backend failure speaks a fixed fallback with the
911 line and keeps the call open.

Verified against cartesia-line 0.2.19 (see docs/DECISIONS.md): `process(env, event)` is an async
generator; default run filter = CallStarted, UserTurnEnded, CallEnded; UserTurnStarted cancels the
in-flight task (barge-in). The caller's words are in UserTurnEnded.content[*] of type UserTextSent.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any, AsyncIterator, Optional

from line.events import AgentEndCall, AgentSendText, AgentUpdateCall, CallEnded, CallStarted, UserTextSent, UserTurnEnded

from . import phrases
from .backend_client import BackendClient, BackendError, now_ms
from .models import SessionEndRequest, SessionStartRequest, TurnRequest

log = logging.getLogger("soterra.voice")

E164 = re.compile(r"^\+[1-9]\d{6,14}$")


@dataclass
class CallInfo:
    provider_call_id: str
    direction: str = "inbound"
    caller_phone: Optional[str] = None
    called_phone: Optional[str] = None
    notification_id: Optional[str] = None


def call_info_from_request(call_request: Any) -> CallInfo:
    """Builds CallInfo from a Line CallRequest. Outbound callbacks carry notification_id in metadata.

    TODO(V): confirm on a real outbound call that the API's `dynamic_variables` arrive in
    `call_request.metadata` (undocumented; the SDK's CallRequest has a `metadata` dict). For outbound
    calls, `from_`/`to` semantics are also unverified: log them on the first real call.
    """
    metadata = getattr(call_request, "metadata", None) or {}
    notification_id = metadata.get("notification_id") or metadata.get("notificationId")
    caller = getattr(call_request, "from_", None)
    called = getattr(call_request, "to", None)
    direction = "outbound" if notification_id else "inbound"
    if direction == "outbound":
        caller, called = called, caller  # we dialed them: the person is the "to" number
    return CallInfo(
        provider_call_id=call_request.call_id,
        direction=direction,
        caller_phone=caller if caller and E164.match(caller) else None,
        called_phone=called if called and E164.match(called) else None,
        notification_id=notification_id,
    )


def utterance_of(event: UserTurnEnded) -> str:
    return " ".join(c.content for c in event.content if isinstance(c, UserTextSent)).strip()


class SoterraAgent:
    def __init__(self, backend: BackendClient, call: CallInfo, default_language: str = "en"):
        self.backend = backend
        self.call = call
        self.language = default_language
        self.session_id: Optional[str] = None
        self.turn_index = 0
        self._interrupted = False
        self._ended = False

    async def process(self, env: Any, event: Any) -> AsyncIterator[Any]:
        if isinstance(event, CallStarted):
            async for out in self._on_call_started():
                yield out
        elif isinstance(event, UserTurnEnded):
            async for out in self._on_user_turn(utterance_of(event)):
                yield out
        elif isinstance(event, CallEnded):
            await self._end("caller_hangup")

    async def _on_call_started(self) -> AsyncIterator[Any]:
        try:
            res = await self.backend.start_session(
                SessionStartRequest(
                    provider_call_id=self.call.provider_call_id,
                    direction=self.call.direction,  # type: ignore[arg-type]
                    caller_phone=self.call.caller_phone,
                    called_phone=self.call.called_phone,
                    language_hint=self.language,
                    notification_id=self.call.notification_id,
                    started_at=now_ms(),
                )
            )
        except BackendError as e:
            log.error("session start failed: %s", e)
            # Turns will still reach the backend via provider_call_id (lazy session start).
            yield AgentSendText(text=phrases.greeting_fallback(self.language))
            return
        self.session_id = res.session_id
        if res.language != self.language:
            # TODO(V): also switch to a voice for this language (voice_id) once chosen.
            self.language = res.language
            yield AgentUpdateCall(language=res.language)
        yield AgentSendText(text=res.greeting)

    async def _on_user_turn(self, utterance: str) -> AsyncIterator[Any]:
        if not utterance:
            return
        index = self.turn_index
        self.turn_index += 1
        interrupted, self._interrupted = self._interrupted, False
        try:
            res = await self.backend.turn(
                TurnRequest(
                    session_id=self.session_id,
                    provider_call_id=None if self.session_id else self.call.provider_call_id,
                    turn_index=index,
                    utterance=utterance,
                    language=self.language,
                    interrupted_previous=interrupted or None,
                    received_at=now_ms(),
                )
            )
        except asyncio.CancelledError:
            # Barge-in: the caller spoke again. Tell the backend on the next turn.
            self._interrupted = True
            raise
        except BackendError as e:
            log.error("turn %s failed: %s", index, e)
            yield AgentSendText(text=phrases.fallback(self.language))
            return
        if self.session_id is None:
            self.session_id = res.session_id
        yield AgentSendText(text=res.reply)
        if res.end_call:
            await self._end("agent_end")
            yield AgentEndCall()

    async def _end(self, reason: str) -> None:
        if self._ended:
            return
        self._ended = True
        try:
            await self.backend.end_session(
                SessionEndRequest(
                    session_id=self.session_id,
                    provider_call_id=None if self.session_id else self.call.provider_call_id,
                    ended_at=now_ms(),
                    reason=reason,  # type: ignore[arg-type]
                )
            )
        except BackendError as e:
            # The backend's stale-session sweeper finalizes the call anyway.
            log.error("session end failed: %s", e)
