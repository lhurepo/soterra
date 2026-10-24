"""[V] Shared test helpers: drive SoterraAgent.process() with constructed line.events objects."""

import asyncio
from pathlib import Path

import pytest
from line.agent import AgentEnv, TurnEnv
from line.events import AgentEndCall, AgentSendText, UserDtmfSent, UserTextSent, UserTurnEnded

from soterra_voice.agent import CallInfo, SoterraAgent
from soterra_voice.backend_client import MockBackendClient
from soterra_voice.config import Settings

ENV = TurnEnv(AgentEnv())
FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


def collect(agent: SoterraAgent, event) -> list:
    async def go():
        return [out async for out in agent.process(ENV, event)]

    return asyncio.run(go())


def said(outputs) -> list[str]:
    return [o.text for o in outputs if isinstance(o, AgentSendText)]


def ended(outputs) -> bool:
    return any(isinstance(o, AgentEndCall) for o in outputs)


def user(*texts: str, dtmf: str | None = None) -> UserTurnEnded:
    content = [UserTextSent(content=t) for t in texts]
    if dtmf:
        content.append(UserDtmfSent(button=dtmf))
    return UserTurnEnded(content=content)


def settings(**overrides) -> Settings:
    base = dict(backend_mode="mock", filler_after_s=5.0, turn_timeout_s=5.0, end_session_timeout_s=1.0)
    base.update(overrides)
    return Settings(**base)


def make(backend: MockBackendClient | None = None, *, call: CallInfo | None = None, **settings_overrides):
    backend = backend or MockBackendClient()
    call = call or CallInfo(provider_call_id="call-1", caller_phone="+17075550123", called_phone="+17075550100")
    return SoterraAgent(backend, call, settings(**settings_overrides)), backend


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES
