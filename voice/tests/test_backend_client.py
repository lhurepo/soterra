"""[V] HttpBackendClient against a stubbed transport (no network): headers, body, typed errors."""

import asyncio
import json
from pathlib import Path

import httpx
import pytest

from soterra_voice.backend_client import BackendError, HttpBackendClient
from soterra_voice.models import SessionEndRequest, SessionStartRequest, TurnRequest

CONTRACTS = Path(__file__).resolve().parents[2] / "fixtures" / "contracts"


def golden(name: str) -> dict:
    return json.loads((CONTRACTS / name).read_text())


def client(handler) -> HttpBackendClient:
    return HttpBackendClient("https://example.convex.site", "test-secret", timeout_s=1.0, transport=httpx.MockTransport(handler))


def run(coro):
    return asyncio.run(coro)


def test_requests_carry_auth_and_contract_version_and_parse_golden_responses():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        path = request.url.path
        body = {
            "/voice/session/start": golden("voice.session-start.response.json"),
            "/voice/turn": golden("voice.turn.response.answer.json"),
            "/voice/session/end": golden("voice.session-end.response.json"),
            "/health": golden("health.response.json"),
        }[path]
        return httpx.Response(200, json=body)

    c = client(handler)

    async def go():
        start = await c.start_session(SessionStartRequest.model_validate(golden("voice.session-start.request.json")))
        turn = await c.turn(TurnRequest.model_validate(golden("voice.turn.request.json")))
        end = await c.end_session(SessionEndRequest.model_validate(golden("voice.session-end.request.json")))
        health = await c.health()
        await c.aclose()
        return start, turn, end, health

    start, turn, end, health = run(go())
    assert start.greeting.startswith("This is Soterra")
    assert turn.kind == "answer" and turn.citations[0].source_name.endswith("(Demo)")
    assert end.ok and health.integrations["llm"] == "mock"
    for r in seen:
        assert r.headers["Authorization"] == "Bearer test-secret"
    posts = [json.loads(r.content) for r in seen if r.method == "POST"]
    assert all(p["contractVersion"] == "1" for p in posts)
    assert posts[1] == golden("voice.turn.request.json")


@pytest.mark.parametrize(
    "status,body,kind,code",
    [
        (401, {"error": {"code": "unauthorized", "message": "nope"}}, "unauthorized", "unauthorized"),
        (500, {"error": {"code": "internal", "message": "boom"}}, "http", "internal"),
        (502, "<html>bad gateway</html>", "http", None),
    ],
)
def test_error_statuses_map_to_typed_errors(status, body, kind, code):
    def handler(_):
        return httpx.Response(status, json=body) if isinstance(body, dict) else httpx.Response(status, text=body)

    with pytest.raises(BackendError) as e:
        run(client(handler).turn(TurnRequest.model_validate(golden("voice.turn.request.json"))))
    assert (e.value.kind, e.value.status, e.value.code) == (kind, status, code)


def test_malformed_json_and_wrong_shape_are_bad_response():
    for response in (httpx.Response(200, text="{not json"), httpx.Response(200, json={"hello": "world"})):
        with pytest.raises(BackendError) as e:
            run(client(lambda _r, resp=response: resp).turn(TurnRequest.model_validate(golden("voice.turn.request.json"))))
        assert e.value.kind == "bad_response"


def test_timeouts_and_network_errors_are_typed():
    def slow(request):
        raise httpx.ReadTimeout("slow", request=request)

    def down(request):
        raise httpx.ConnectError("refused", request=request)

    for handler, kind in ((slow, "timeout"), (down, "network")):
        with pytest.raises(BackendError) as e:
            run(client(handler).turn(TurnRequest.model_validate(golden("voice.turn.request.json"))))
        assert e.value.kind == kind
        assert "test-secret" not in str(e.value)


def test_a_new_event_loop_gets_a_fresh_connection_pool():
    """Regression: pre-call and the call websocket can run on different loops in some hosts (and in TestClient)."""
    c = client(lambda r: httpx.Response(200, json=golden("health.response.json")))
    assert run(c.health()).ok
    assert run(c.health()).ok  # second asyncio.run = new loop; must not reuse the first loop's client
