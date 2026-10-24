"""[V] The pydantic mirror accepts, round-trips and tolerates the same golden fixtures as the TS contracts."""

import json
from pathlib import Path

import pytest

from soterra_voice.models import CONTRACT_VERSION, SCHEMAS

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "contracts"
MANIFEST = json.loads((FIXTURES / "manifest.json").read_text())
PYTHON_VALID = [e for e in MANIFEST["valid"] if e["python"]]


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


@pytest.mark.parametrize("entry", PYTHON_VALID, ids=lambda e: e["file"])
def test_valid_fixture_round_trips(entry):
    raw = _load(entry["file"])
    model = SCHEMAS[entry["schema"]].model_validate(raw)
    known = {k: v for k, v in raw.items() if k != "someFutureOptionalField"}
    assert model.to_json() == known


@pytest.mark.parametrize("entry", [e for e in MANIFEST["invalid"] if e["python"]], ids=lambda e: e["file"])
def test_invalid_fixture_rejected(entry):
    with pytest.raises(Exception):
        SCHEMAS[entry["schema"]].model_validate(_load(entry["file"]))


@pytest.mark.parametrize("entry", [e for e in PYTHON_VALID if "response" in e["file"] or e["file"] == "error.json"], ids=lambda e: e["file"])
def test_responses_with_unknown_fields_still_parse(entry):
    raw = _load(entry["file"]) | {"addedByBackendLater": {"x": 1}}
    SCHEMAS[entry["schema"]].model_validate(raw)


def test_every_voice_schema_is_covered_by_a_fixture():
    covered = {e["schema"] for e in PYTHON_VALID}
    assert covered == set(SCHEMAS)


def test_contract_version_matches_typescript():
    ts = (Path(__file__).resolve().parents[2] / "src" / "contracts" / "version.ts").read_text()
    assert f'CONTRACT_VERSION = "{CONTRACT_VERSION}"' in ts


def test_unknown_reply_kind_does_not_break_the_call():
    raw = _load("voice.turn.response.answer.json") | {"kind": "brand_new_kind"}
    assert SCHEMAS["TurnResponse"].model_validate(raw).kind == "brand_new_kind"
