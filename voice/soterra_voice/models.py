"""[V] Pydantic mirror of the voice ⇄ backend contract (src/contracts/voice.ts is the source of truth).

Every model ignores unknown fields, so additive backend changes never break a live call. `kind` is a
plain string for the same reason: a new reply kind must not crash the agent.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, model_validator
from pydantic.alias_generators import to_camel

CONTRACT_VERSION = "1"

REPLY_KINDS = ("answer", "no_info", "clarify", "safety", "smalltalk", "followup", "goodbye")


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", alias_generator=to_camel, populate_by_name=True)

    def to_json(self) -> dict:
        return self.model_dump(by_alias=True, exclude_none=True)


class Citation(_Model):
    source_name: str
    url: str
    issued_at: int
    updated_at: Optional[int] = None


class SessionStartRequest(_Model):
    contract_version: str = CONTRACT_VERSION
    provider: Literal["cartesia"] = "cartesia"
    provider_call_id: str
    direction: Literal["inbound", "outbound"]
    caller_phone: Optional[str] = None
    called_phone: Optional[str] = None
    language_hint: Optional[str] = None
    notification_id: Optional[str] = None
    started_at: int


class SessionStartResponse(_Model):
    contract_version: str
    session_id: str
    language: str
    greeting: str


class _SessionRef(_Model):
    session_id: Optional[str] = None
    provider_call_id: Optional[str] = None

    @model_validator(mode="after")
    def _require_ref(self):
        if self.session_id is None and self.provider_call_id is None:
            raise ValueError("session_id or provider_call_id is required")
        return self


class TurnRequest(_SessionRef):
    contract_version: str = CONTRACT_VERSION
    turn_index: int
    utterance: str
    language: str
    interrupted_previous: Optional[bool] = None
    received_at: int


class TurnResponse(_Model):
    contract_version: str
    session_id: str
    turn_index: int
    reply: str
    language: str
    kind: str
    citations: list[Citation] = []
    end_call: bool = False
    unanswered_question_id: Optional[str] = None
    subscription_id: Optional[str] = None
    degraded: Optional[bool] = None
    timings_ms: Optional[dict[str, float]] = None


class SessionEndRequest(_SessionRef):
    contract_version: str = CONTRACT_VERSION
    ended_at: int
    reason: Literal["caller_hangup", "agent_end", "transfer", "error", "timeout"]


class SessionEndResponse(_Model):
    contract_version: str
    ok: bool
    call_id: str


class ErrorBody(_Model):
    code: str
    message: str


class ErrorResponse(_Model):
    error: ErrorBody


class HealthResponse(_Model):
    contract_version: str
    ok: bool
    integrations: dict[str, str]
    flags: Optional[dict[str, bool]] = None
    now: int


SCHEMAS: dict[str, type[_Model]] = {
    "SessionStartRequest": SessionStartRequest,
    "SessionStartResponse": SessionStartResponse,
    "TurnRequest": TurnRequest,
    "TurnResponse": TurnResponse,
    "SessionEndRequest": SessionEndRequest,
    "SessionEndResponse": SessionEndResponse,
    "ErrorResponse": ErrorResponse,
    "HealthResponse": HealthResponse,
}
