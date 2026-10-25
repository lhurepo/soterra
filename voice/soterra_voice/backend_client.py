"""[V] The Backend protocol and its two implementations: HttpBackendClient (Convex HTTP actions) and
MockBackendClient (no network). Every response is validated with pydantic; every failure becomes a typed
BackendError, so the agent never sees a raw exception.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Literal, Optional, Protocol, TypeVar, Union

import httpx
from pydantic import BaseModel, ValidationError

from .config import Settings
from .models import (
    CONTRACT_VERSION,
    ErrorResponse,
    HealthResponse,
    SessionEndRequest,
    SessionEndResponse,
    SessionStartRequest,
    SessionStartResponse,
    TurnRequest,
    TurnResponse,
)

ErrorKind = Literal["timeout", "network", "unauthorized", "http", "bad_response"]


class BackendError(Exception):
    """Any failure talking to the backend. The agent speaks the fallback line."""

    def __init__(self, kind: ErrorKind, message: str, status: Optional[int] = None, code: Optional[str] = None):
        super().__init__(f"{kind}: {message}")
        self.kind = kind
        self.status = status
        self.code = code


class Backend(Protocol):
    async def start_session(self, req: SessionStartRequest) -> SessionStartResponse: ...
    async def turn(self, req: TurnRequest) -> TurnResponse: ...
    async def end_session(self, req: SessionEndRequest) -> SessionEndResponse: ...
    async def health(self) -> HealthResponse: ...
    async def aclose(self) -> None: ...


def now_ms() -> int:
    return int(time.time() * 1000)


M = TypeVar("M", bound=BaseModel)


class HttpBackendClient:
    """One shared httpx.AsyncClient (keep-alive), created lazily inside the running event loop. Connections are
    bound to a loop, so a different running loop (e.g. a test harness's per-request loop) gets its own client."""

    def __init__(
        self,
        base_url: str,
        secret: str,
        timeout_s: float = 8.0,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._timeout = httpx.Timeout(timeout_s, connect=min(timeout_s, 3.0))
        self._transport = transport
        self._client: Optional[httpx.AsyncClient] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def _http(self) -> httpx.AsyncClient:
        loop = asyncio.get_running_loop()
        if self._client is None or self._client.is_closed or self._loop is not loop:
            self._loop = loop
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout,
                transport=self._transport,
                headers={"Authorization": f"Bearer {self._secret}", "Content-Type": "application/json"},
                limits=httpx.Limits(max_keepalive_connections=20, keepalive_expiry=60),
            )
        return self._client

    async def _send(self, method: str, path: str, model: type[M], body: Optional[dict] = None) -> M:
        try:
            res = await self._http().request(method, path, json=body)
        except httpx.TimeoutException as e:
            raise BackendError("timeout", f"{path} timed out") from e
        except httpx.HTTPError as e:
            raise BackendError("network", f"{path}: {type(e).__name__}") from e
        if res.status_code != 200:
            code = None
            try:
                code = ErrorResponse.model_validate(res.json()).error.code
            except (ValueError, ValidationError):
                pass
            kind: ErrorKind = "unauthorized" if res.status_code == 401 else "http"
            raise BackendError(kind, f"{path} returned HTTP {res.status_code}", status=res.status_code, code=code)
        try:
            return model.model_validate(res.json())
        except (ValueError, ValidationError) as e:
            raise BackendError("bad_response", f"{path} returned an invalid body") from e

    async def start_session(self, req: SessionStartRequest) -> SessionStartResponse:
        return await self._send("POST", "/voice/session/start", SessionStartResponse, req.to_json())

    async def turn(self, req: TurnRequest) -> TurnResponse:
        return await self._send("POST", "/voice/turn", TurnResponse, req.to_json())

    async def end_session(self, req: SessionEndRequest) -> SessionEndResponse:
        return await self._send("POST", "/voice/session/end", SessionEndResponse, req.to_json())

    async def health(self) -> HealthResponse:
        return await self._send("GET", "/health", HealthResponse)

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()


# ─────────────────────────────── Mock ───────────────────────────────


class Fault(str, Enum):
    """Failures MockBackendClient can inject; each maps to the BackendError the HTTP client would raise."""

    TIMEOUT = "timeout"
    NETWORK = "network"
    HTTP_500 = "http_500"
    UNAUTHORIZED = "unauthorized"
    MALFORMED = "malformed"


def _raise(fault: Fault) -> None:
    if fault is Fault.TIMEOUT:
        raise BackendError("timeout", "mock timeout")
    if fault is Fault.NETWORK:
        raise BackendError("network", "mock network error")
    if fault is Fault.HTTP_500:
        raise BackendError("http", "mock HTTP 500", status=500, code="internal")
    if fault is Fault.UNAUTHORIZED:
        raise BackendError("unauthorized", "mock HTTP 401", status=401, code="unauthorized")
    raise BackendError("bad_response", "mock malformed JSON")


@dataclass
class MockTurn:
    """One scripted backend reply (or fault) for the next /voice/turn call."""

    reply: str = ""
    kind: str = "answer"
    end_call: bool = False
    degraded: Optional[bool] = None
    fault: Optional[Fault] = None
    delay_s: float = 0.0


ScriptItem = Union[MockTurn, Fault]

# Golden replies (fixtures/contracts) used when replaying scripted conversations.
_FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


def _golden_reply(kind: str) -> str:
    names = {"answer": "voice.turn.response.answer.json", "no_info": "voice.turn.response.no_info.json", "safety": "voice.turn.response.safety.json"}
    path = _FIXTURES / "contracts" / names.get(kind, "")
    if kind in names and path.is_file():
        return json.loads(path.read_text())["reply"]
    return {
        "followup": "Okay. I'll call this number if official information about this changes, for up to seven days.",
        "goodbye": "Thank you for calling Soterra. Stay safe. If you are in immediate danger, dial 911.",
        "smalltalk": "Okay.",
        "clarify": "Which area are you asking about?",
    }.get(kind, "(mock reply)")


@dataclass
class MockBackendClient:
    """Backend stand-in for local runs and tests. With no script it echoes; with a script it replays it.

    `start_fault`/`end_fault` make session start/end fail; `delay_s` delays every turn.
    """

    script: list[ScriptItem] = field(default_factory=list)
    start_fault: Optional[Fault] = None
    end_fault: Optional[Fault] = None
    delay_s: float = 0.0
    language: Optional[str] = None
    greeting: str = "This is Soterra (mock backend). In danger? Hang up and dial 911. This call is transcribed. How can I help?"
    requests: list[object] = field(default_factory=list)
    cancelled_turns: int = 0

    @classmethod
    def from_conversation(cls, path: Union[str, Path], **kwargs) -> "MockBackendClient":
        """Replay fixtures/conversations/<name>.json: one reply per turn with the expected kind."""
        data = json.loads(Path(path).read_text())
        script: list[ScriptItem] = [
            MockTurn(reply=_golden_reply(t.get("expectKind", "answer")), kind=t.get("expectKind", "answer"), end_call=bool(t.get("expectEndCall", False)))
            for t in data["turns"]
        ]
        return cls(script=script, language=data.get("session", {}).get("languageHint"), **kwargs)

    async def start_session(self, req: SessionStartRequest) -> SessionStartResponse:
        self.requests.append(req)
        if self.start_fault:
            _raise(self.start_fault)
        return SessionStartResponse(
            contract_version=CONTRACT_VERSION,
            session_id=f"mock-session-{req.provider_call_id}",
            language=self.language or req.language_hint or "en",
            greeting=self.greeting,
        )

    async def turn(self, req: TurnRequest) -> TurnResponse:
        self.requests.append(req)
        item: ScriptItem = self.script.pop(0) if self.script else MockTurn(
            reply=f"(mock) You said: {req.utterance}", kind="goodbye" if "bye" in req.utterance.lower() else "smalltalk", end_call="bye" in req.utterance.lower()
        )
        if isinstance(item, Fault):
            item = MockTurn(fault=item)
        try:
            if item.delay_s or self.delay_s:
                await asyncio.sleep(item.delay_s or self.delay_s)
        except asyncio.CancelledError:
            self.cancelled_turns += 1
            raise
        if item.fault:
            _raise(item.fault)
        return TurnResponse(
            contract_version=CONTRACT_VERSION,
            session_id=req.session_id or f"mock-session-{req.provider_call_id}",
            turn_index=req.turn_index,
            reply=item.reply,
            language=req.language,
            kind=item.kind,
            citations=[],
            end_call=item.end_call,
            degraded=item.degraded,
        )

    async def end_session(self, req: SessionEndRequest) -> SessionEndResponse:
        self.requests.append(req)
        if self.end_fault:
            _raise(self.end_fault)
        return SessionEndResponse(contract_version=CONTRACT_VERSION, ok=True, call_id=req.session_id or "mock")

    async def health(self) -> HealthResponse:
        return HealthResponse(contract_version=CONTRACT_VERSION, ok=True, integrations={"backend": "mock"}, now=now_ms())

    async def aclose(self) -> None:
        return None


def backend_from_settings(settings: Settings) -> Backend:
    if settings.backend_mode == "mock":
        if settings.mock_conversation and Path(settings.mock_conversation).is_file():
            return MockBackendClient.from_conversation(settings.mock_conversation)
        return MockBackendClient()
    return HttpBackendClient(settings.backend_url, settings.voice_api_secret, settings.turn_timeout_s)
