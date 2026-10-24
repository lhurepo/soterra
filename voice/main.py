"""[V] Entry point for `cartesia deploy`, `cartesia chat` and self-hosting (`cartesia connect`).

Reads settings once and fails fast with a clear message if BACKEND_MODE=http is missing its URL or secret.
"""

import logging

from soterra_voice.app import build_app
from soterra_voice.config import Settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

settings = Settings.from_env()
logging.getLogger("soterra.voice").info("backend mode=%s url=%s", settings.backend_mode, settings.backend_url or "-")
app = build_app(settings)

if __name__ == "__main__":
    app.run()
