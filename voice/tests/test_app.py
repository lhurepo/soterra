"""[V] The real Line SDK harness (VoiceAgentApp: POST /chats → pre_call_handler, then the /ws websocket loop)
driven in-process with the SDK's own wire messages. Proves our agent works inside the SDK's runner, not
only when process() is called directly. The Cartesia side of the wire is simulated here."""

import time

from fastapi.testclient import TestClient

from soterra_voice.app import build_app
from soterra_voice.backend_client import MockBackendClient, MockTurn
from soterra_voice.models import SessionEndRequest, SessionStartRequest, TurnRequest

from conftest import settings


def read_until_response_end(ws) -> list[dict]:
    messages = []
    while True:
        msg = ws.receive_json()
        messages.append(msg)
        if msg["type"] in ("response_end", "end_call", "error"):
            return messages


def spoken(messages) -> list[str]:
    return [m["content"] for m in messages if m["type"] == "message"]


def wait_for(predicate, timeout=3.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return predicate()


def test_full_call_through_the_sdk_runner():
    backend = MockBackendClient(script=[MockTurn(reply="Answer one."), MockTurn(reply="Goodbye.", kind="goodbye", end_call=True)])
    s = settings(language_by_dialed_number={"+14155550100": "es"}, voice_ids={"en": "voice-en", "es": "voice-es"})
    client = TestClient(build_app(s, backend).fastapi_app)

    chat = client.post("/chats", json={"call_id": "cart-1", "from_": "+17075550123", "to": "+14155550100", "agent_call_id": "ac-1", "agent": {}})
    assert chat.status_code == 200
    body = chat.json()
    assert body["config"] == {"tts": {"voice_id": "voice-es", "model": "sonic-3.6", "language": "es"}, "stt": {"language": "es"}}
    assert body["metadata"]["soterra_session_id"] == "mock-session-cart-1"

    with client.websocket_connect("/ws") as ws:
        # Assumption (unverified with Cartesia): the harness forwards /chats metadata in the start message.
        ws.send_json({"type": "start", "call_id": "cart-1", "from": "+17075550123", "to": "+14155550100", "agent_call_id": "ac-1", "agent": {"id": "agent_test"}, "metadata": body["metadata"]})
        greeting = read_until_response_end(ws)
        assert "9 1 1" in " ".join(spoken(greeting))
        assert any(m["type"] == "message" and m["interruptible"] is False for m in greeting)

        ws.send_json({"type": "user_state", "value": "speaking"})
        ws.send_json({"type": "message", "content": "What's happening"})
        ws.send_json({"type": "message", "content": "near Santa Rosa?"})
        ws.send_json({"type": "user_state", "value": "idle"})
        assert spoken(read_until_response_end(ws)) == ["Answer one."]

        ws.send_json({"type": "user_state", "value": "speaking"})
        ws.send_json({"type": "message", "content": "thanks bye"})
        ws.send_json({"type": "user_state", "value": "idle"})
        last = read_until_response_end(ws)
        assert spoken(last) == ["Goodbye."] and last[-1]["type"] == "end_call"

    starts = [r for r in backend.requests if isinstance(r, SessionStartRequest)]
    assert len(starts) == 1  # pre-call started it; the agent reused it
    sent = [r for r in backend.requests if isinstance(r, TurnRequest)]
    assert [(t.turn_index, t.utterance, t.language) for t in sent] == [(0, "What's happening near Santa Rosa?", "es"), (1, "thanks bye", "es")]
    assert wait_for(lambda: [r.reason for r in backend.requests if isinstance(r, SessionEndRequest)] == ["agent_end"])


def test_pre_call_without_caller_number_defers_session_start_to_the_agent():
    backend = MockBackendClient()
    client = TestClient(build_app(settings(), backend).fastapi_app)
    chat = client.post("/chats", json={"call_id": "cart-2", "to": "+14155550199", "agent": {}})
    assert chat.json()["metadata"] == {}
    assert backend.requests == []
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "start", "call_id": "cart-2", "from": "anonymous", "to": "+14155550199", "agent": {"id": "a"}})
        read_until_response_end(ws)
    start = next(r for r in backend.requests if isinstance(r, SessionStartRequest))
    assert start.caller_phone is None and start.provider_call_id == "cart-2"
    assert wait_for(lambda: [r.reason for r in backend.requests if isinstance(r, SessionEndRequest)] == ["caller_hangup"])


def test_barge_in_through_the_runner_flags_the_next_turn():
    backend = MockBackendClient(script=[MockTurn(reply="slow", delay_s=2.0), MockTurn(reply="Fast.")])
    client = TestClient(build_app(settings(filler_after_s=5.0), backend).fastapi_app)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "start", "call_id": "cart-3", "from": "+17075550123", "to": "+14155550199", "agent": {"id": "a"}})
        read_until_response_end(ws)
        ws.send_json({"type": "user_state", "value": "speaking"})
        ws.send_json({"type": "message", "content": "first"})
        ws.send_json({"type": "user_state", "value": "idle"})
        time.sleep(0.2)
        ws.send_json({"type": "user_state", "value": "speaking"})  # caller talks over the pending reply
        assert read_until_response_end(ws)[-1]["type"] == "response_end"  # cancelled task still closes its response
        ws.send_json({"type": "message", "content": "second"})
        ws.send_json({"type": "user_state", "value": "idle"})
        assert spoken(read_until_response_end(ws)) == ["Fast."]
    assert backend.cancelled_turns == 1
    second = [r for r in backend.requests if isinstance(r, TurnRequest)][1]
    assert (second.turn_index, second.interrupted_previous) == (1, True)


def test_keypad_two_switches_stt_and_tts_to_spanish_through_the_runner():
    client = TestClient(build_app(settings(voice_ids={"en": "voice-en", "es": "voice-es"}), MockBackendClient()).fastapi_app)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "start", "call_id": "cart-4", "from": "+17075550123", "to": "+14155550199", "agent": {"id": "a"}})
        read_until_response_end(ws)
        ws.send_json({"type": "user_state", "value": "speaking"})
        ws.send_json({"type": "dtmf", "button": "2"})
        ws.send_json({"type": "user_state", "value": "idle"})
        out = read_until_response_end(ws)
    config = next(m for m in out if m["type"] == "config")
    assert config["stt"] == {"language": "es"} and config["tts"]["voice_id"] == "voice-es" and config["tts"]["language"] == "es"
    assert spoken(out) == ["De acuerdo, seguimos en español. ¿Qué le gustaría saber?"]
