"""[V] Scripted demo calls from fixtures/conversations replayed through MockBackendClient: the agent speaks the
greeting, then exactly one backend reply per turn, and hangs up when the backend says endCall."""

import json

import pytest
from line.events import CallEnded, CallStarted

from soterra_voice.backend_client import MockBackendClient, _golden_reply
from soterra_voice.models import SessionEndRequest, TurnRequest

from conftest import FIXTURES, collect, ended, make, said, user


@pytest.mark.parametrize("name", ["ridgeview-basic", "danger", "no-fixtures"])
def test_scripted_conversation(name):
    path = FIXTURES / "conversations" / f"{name}.json"
    script = json.loads(path.read_text())
    backend = MockBackendClient.from_conversation(path)
    agent, _ = make(backend)
    spoken = said(collect(agent, CallStarted()))
    assert "911" in " ".join(spoken)
    hung_up = False
    for turn in script["turns"]:
        out = collect(agent, user(turn["utterance"]))
        assert said(out) == [_golden_reply(turn["expectKind"])]
        hung_up = ended(out)
    assert hung_up == bool(script["turns"][-1].get("expectEndCall"))
    collect(agent, CallEnded())
    sent = [r for r in backend.requests if isinstance(r, TurnRequest)]
    assert [t.utterance for t in sent] == [t["utterance"] for t in script["turns"]]
    assert [r.reason for r in backend.requests if isinstance(r, SessionEndRequest)] == ["agent_end" if hung_up else "caller_hangup"]


def test_safety_replies_lead_with_911():
    assert _golden_reply("safety").startswith("If you are in immediate danger, hang up and dial 911 now.")
