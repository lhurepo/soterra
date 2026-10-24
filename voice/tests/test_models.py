"""[V] The pydantic mirror accepts the same golden fixtures as the TypeScript contracts."""

import json
from pathlib import Path

import pytest

from soterra_voice.models import SCHEMAS

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "contracts"
MANIFEST = json.loads((FIXTURES / "manifest.json").read_text())


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


@pytest.mark.parametrize("entry", [e for e in MANIFEST["valid"] if e["python"]], ids=lambda e: e["file"])
def test_valid_fixture_parses(entry):
    SCHEMAS[entry["schema"]].model_validate(_load(entry["file"]))


@pytest.mark.parametrize("entry", [e for e in MANIFEST["invalid"] if e["python"]], ids=lambda e: e["file"])
def test_invalid_fixture_rejected(entry):
    with pytest.raises(Exception):
        SCHEMAS[entry["schema"]].model_validate(_load(entry["file"]))


def test_unknown_fields_are_ignored():
    res = SCHEMAS["TurnResponse"].model_validate(_load("voice.turn.response.future-field.json"))
    assert res.end_call is True
    assert not hasattr(res, "someFutureOptionalField")


def test_requests_serialize_to_the_wire_shape():
    req = SCHEMAS["TurnRequest"].model_validate(_load("voice.turn.request.json"))
    assert req.to_json() == _load("voice.turn.request.json")
