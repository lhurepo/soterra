"""[V] The agent with MockBackendClient: greets, replies, ends the call, and speaks the fallback on errors."""

import asyncio

from line.agent import AgentEnv, TurnEnv
from line.events import AgentEndCall, AgentSendText, CallEnded, CallStarted, UserTextSent, UserTurnEnded

from soterra_voice.agent import CallInfo, SoterraAgent
from soterra_voice.backend_client import MockBackendClient
from soterra_voice.models import SessionEndRequest, TurnRequest

ENV = TurnEnv(AgentEnv())


def run(agent: SoterraAgent, event) -> list:
    async def collect():
        return [out async for out in agent.process(ENV, event)]

    return asyncio.run(collect())


def said(outputs) -> list[str]:
    return [o.text for o in outputs if isinstance(o, AgentSendText)]


def user(text: str) -> UserTurnEnded:
    return UserTurnEnded(content=[UserTextSent(content=text)])


def make(fail: bool = False) -> tuple[SoterraAgent, MockBackendClient]:
    backend = MockBackendClient(fail=fail)
    return SoterraAgent(backend, CallInfo(provider_call_id="call-1", caller_phone="+17075550123")), backend


def test_greets_on_call_start():
    agent, _ = make()
    out = said(run(agent, CallStarted()))
    assert len(out) == 1 and "911" in out[0]
    assert agent.session_id == "mock-session-call-1"


def test_replies_on_user_turn_with_increasing_turn_index():
    agent, backend = make()
    run(agent, CallStarted())
    assert said(run(agent, user("Where are the shelters?"))) == ["(mock) You said: Where are the shelters?"]
    run(agent, user("And the roads?"))
    turns = [r for r in backend.requests if isinstance(r, TurnRequest)]
    assert [t.turn_index for t in turns] == [0, 1]
    assert all(t.session_id == "mock-session-call-1" for t in turns)


def test_goodbye_ends_the_call_and_the_session():
    agent, backend = make()
    run(agent, CallStarted())
    out = run(agent, user("ok bye"))
    assert isinstance(out[-1], AgentEndCall)
    assert any(isinstance(r, SessionEndRequest) and r.reason == "agent_end" for r in backend.requests)


def test_speaks_fallback_with_911_when_backend_fails():
    agent, _ = make(fail=True)
    greeting = said(run(agent, CallStarted()))
    assert "911" in greeting[0]
    reply = said(run(agent, user("What's happening?")))
    assert len(reply) == 1 and "911" in reply[0]


def test_turn_before_session_uses_provider_call_id():
    agent, backend = make()
    run(agent, user("hello"))  # CallStarted never processed (e.g. caller spoke first)
    turn = next(r for r in backend.requests if isinstance(r, TurnRequest))
    assert turn.session_id is None and turn.provider_call_id == "call-1"


def test_call_ended_ends_session_once():
    agent, backend = make()
    run(agent, CallStarted())
    run(agent, CallEnded())
    run(agent, CallEnded())
    assert sum(isinstance(r, SessionEndRequest) for r in backend.requests) == 1
