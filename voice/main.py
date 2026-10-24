"""[V] Entry point for `cartesia deploy`, `cartesia chat` and self-hosting (`cartesia connect`).

Reads settings once and fails fast with a clear message if BACKEND_MODE=http is missing its URL or secret.
Cartesia's hosted build looks for VoiceAgentApp and app.run() here, so the app is constructed in this file.
"""

import logging

from line.voice_agent_app import VoiceAgentApp

from soterra_voice.app import build_handlers
from soterra_voice.config import Settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

settings = Settings.from_env()
logging.getLogger("soterra.voice").info("backend mode=%s url=%s", settings.backend_mode, settings.backend_url or "-")
get_agent, pre_call_handler = build_handlers(settings)
app = VoiceAgentApp(get_agent=get_agent, pre_call_handler=pre_call_handler)

if __name__ == "__main__":
    app.run()
