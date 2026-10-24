"""[V] Make text safe to speak. Applied to everything the agent sends to text-to-speech, whether it
comes from the backend or from local phrases, so the rule lives in one place.

- "911" is read digit by digit ("nine one one"); the speech engine otherwise says "nine hundred eleven".
"""
import re

from line.events import AgentSendText

_EMERGENCY_NUMBER = re.compile(r"(?<![\d$.,-])911(?![\d])")


def speakable(text: str) -> str:
    return _EMERGENCY_NUMBER.sub("9 1 1", text)


def say(text: str, **kwargs) -> AgentSendText:
    """AgentSendText with the text made speakable (e.g. interruptible=False for the transcription notice)."""
    return AgentSendText(text=speakable(text), **kwargs)
