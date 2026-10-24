"""[V] Text-mode end-to-end call without Cartesia: drives the real Line SDK app (pre-call + websocket runner)
in-process, exactly as Cartesia's harness would, against the backend in BACKEND_MODE (http or mock).

    uv run python scripts/harness_call.py [conversation.json]      # default: ridgeview-basic

Prints what the agent would speak and the time from end of caller turn to the first agent text (this excludes
speech recognition and TTS, which only a real phone call measures).
"""

import json
import statistics
import sys
import time
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from soterra_voice.app import build_app  # noqa: E402
from soterra_voice.config import Settings  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    conversation = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "fixtures" / "conversations" / "ridgeview-basic.json"
    script = json.loads(conversation.read_text())
    settings = Settings.from_env()
    session = script.get("session", {})
    caller = session.get("callerPhone", "+17075550188")
    call_id = f"harness-{uuid.uuid4().hex[:10]}"
    client = TestClient(build_app(settings).fastapi_app)
    print(f"backend={settings.backend_mode} {settings.backend_url or ''}  call={call_id}  scenario={script['name']}\n")

    chat = client.post("/chats", json={"call_id": call_id, "from_": caller, "to": "+14155550100", "agent_call_id": call_id, "agent": {}})
    chat.raise_for_status()
    latencies = []
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "start", "call_id": call_id, "from": caller, "to": "+14155550100", "agent_call_id": call_id, "agent": {"id": "harness"}, "metadata": chat.json().get("metadata", {})})
        print("SOTERRA", " ".join(m["content"] for m in read(ws) if m["type"] == "message"))
        for turn in script["turns"]:
            print(f"\nCALLER  {turn['utterance']}")
            ws.send_json({"type": "user_state", "value": "speaking"})
            ws.send_json({"type": "message", "content": turn["utterance"]})
            t0 = time.perf_counter()
            ws.send_json({"type": "user_state", "value": "idle"})
            first = None
            messages = []
            for m in read(ws):
                messages.append(m)
                if m["type"] == "message" and first is None:
                    first = (time.perf_counter() - t0) * 1000
            latencies.append(first or 0)
            for m in messages:
                if m["type"] == "message":
                    print(f"SOTERRA {m['content']}")
                elif m["type"] == "log_metric":
                    print(f"        · {m['name']}={m['value']}")
                elif m["type"] == "end_call":
                    print("        · end_call")
            print(f"        ⏱ first agent text after {first:.0f} ms" if first else "        ⏱ no text")
            if messages and messages[-1]["type"] == "end_call":
                break
    if latencies:
        print(f"\nfirst-text latency ms: median {statistics.median(latencies):.0f}, max {max(latencies):.0f}, n={len(latencies)}")
    return 0


def read(ws) -> list[dict]:
    out = []
    while True:
        m = ws.receive_json()
        out.append(m)
        if m["type"] in ("response_end", "end_call", "error"):
            return out


if __name__ == "__main__":
    raise SystemExit(main())
