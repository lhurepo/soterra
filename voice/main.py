"""[V] Entry point for `cartesia deploy` / `cartesia chat` / self-hosting (`cartesia connect`)."""

import logging
import os

from line import CallRequest
from line.voice_agent_app import AgentEnv, VoiceAgentApp

from soterra_voice.agent import SoterraAgent, call_info_from_request
from soterra_voice.backend_client import backend_from_env

logging.basicConfig(level=logging.INFO)


async def get_agent(env: AgentEnv, call_request: CallRequest):
    logging.getLogger("soterra.voice").info(
        "call %s from=%s to=%s metadata=%s", call_request.call_id, call_request.from_, call_request.to, call_request.metadata
    )
    # Default filters: run on CallStarted/UserTurnEnded/CallEnded, cancel on UserTurnStarted (barge-in).
    return SoterraAgent(backend_from_env(), call_info_from_request(call_request), os.getenv("DEFAULT_LANGUAGE", "en"))


app = VoiceAgentApp(get_agent=get_agent)

if __name__ == "__main__":
    app.run()
