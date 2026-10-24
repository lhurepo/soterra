"""[V] Backend clients behind one interface: HttpBackendClient (real) and MockBackendClient (canned)."""

from __future__ import annotations

import os
import time
from typing import Optional, Protocol

import httpx

from .models import (
    CONTRACT_VERSION,
    HealthResponse,
    SessionEndRequest,
    SessionEndResponse,
    SessionStartRequest,
    SessionStartResponse,
    TurnRequest,
    TurnResponse,
)


class BackendError(Exception):
    """Any non-200 response, timeout, or unparseable body. The agent speaks the fallback line."""


class BackendClient(Protocol):
    async def start_session(self, req: SessionStartRequest) -> SessionStartResponse: ...
    async def turn(self, req: TurnRequest) -> TurnResponse: ...
    async def end_session(self, req: SessionEndRequest) -> SessionEndResponse: ...
    async def health(self) -> HealthResponse: ...


class HttpBackendClient:
    def __init__(self, base_url: str, secret: str, timeout_seconds: float = 8.0):
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=timeout_seconds,
            headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json"},
        )

    async def _post(self, path: str, body: dict, model):
        try:
            res = await self._client.post(path, json=body)
        except httpx.HTTPError as e:
            raise BackendError(f"{path}: {e!r}") from e
        if res.status_code != 200:
            raise BackendError(f"{path}: HTTP {res.status_code}: {res.text[:300]}")
        try:
            return model.model_validate(res.json())
        except Exception as e:  # noqa: BLE001 - any parse problem is a backend failure
            raise BackendError(f"{path}: bad response: {e}") from e

    async def start_session(self, req: SessionStartRequest) -> SessionStartResponse:
        return await self._post("/voice/session/start", req.to_json(), SessionStartResponse)

    async def turn(self, req: TurnRequest) -> TurnResponse:
        return await self._post("/voice/turn", req.to_json(), TurnResponse)

    async def end_session(self, req: SessionEndRequest) -> SessionEndResponse:
        return await self._post("/voice/session/end", req.to_json(), SessionEndResponse)

    async def health(self) -> HealthResponse:
        try:
            res = await self._client.get("/health")
            res.raise_for_status()
            return HealthResponse.model_validate(res.json())
        except Exception as e:  # noqa: BLE001
            raise BackendError(f"/health: {e!r}") from e


class MockBackendClient:
    """Canned backend for local testing without Convex. Set `fail=True` to exercise the fallback path."""

    def __init__(self, fail: bool = False, replies: Optional[dict[str, TurnResponse]] = None):
        self.fail = fail
        self.replies = replies or {}
        self.requests: list[object] = []

    def _check(self, req: object) -> None:
        self.requests.append(req)
        if self.fail:
            raise BackendError("mock backend configured to fail")

    async def start_session(self, req: SessionStartRequest) -> SessionStartResponse:
        self._check(req)
        return SessionStartResponse(
            contract_version=CONTRACT_VERSION,
            session_id=f"mock-session-{req.provider_call_id}",
            language=req.language_hint or "en",
            greeting="This is Soterra (mock backend). If you are in immediate danger, hang up and dial 911. What would you like to know?",
        )

    async def turn(self, req: TurnRequest) -> TurnResponse:
        self._check(req)
        if req.utterance in self.replies:
            return self.replies[req.utterance]
        is_bye = "bye" in req.utterance.lower()
        return TurnResponse(
            contract_version=CONTRACT_VERSION,
            session_id=req.session_id or f"mock-session-{req.provider_call_id}",
            turn_index=req.turn_index,
            reply="Thank you for calling Soterra." if is_bye else f"(mock) You said: {req.utterance}",
            language=req.language,
            kind="goodbye" if is_bye else "smalltalk",
            citations=[],
            end_call=is_bye,
        )

    async def end_session(self, req: SessionEndRequest) -> SessionEndResponse:
        self._check(req)
        return SessionEndResponse(contract_version=CONTRACT_VERSION, ok=True, call_id=req.session_id or "mock")

    async def health(self) -> HealthResponse:
        return HealthResponse(contract_version=CONTRACT_VERSION, ok=True, integrations={"backend": "mock"}, now=now_ms())


def now_ms() -> int:
    return int(time.time() * 1000)


def backend_from_env() -> BackendClient:
    mode = os.getenv("BACKEND_MODE", "http").lower()
    if mode == "mock":
        return MockBackendClient()
    url = os.getenv("SOTERRA_BACKEND_URL")
    secret = os.getenv("VOICE_API_SECRET")
    if not url or not secret:
        raise RuntimeError("Set SOTERRA_BACKEND_URL and VOICE_API_SECRET (or BACKEND_MODE=mock)")
    return HttpBackendClient(url, secret, float(os.getenv("BACKEND_TIMEOUT_SECONDS", "8")))
