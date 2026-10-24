"""[V] Settings fail fast, language map parsing, phone masking."""

import pytest

from soterra_voice.config import DEFAULT_VOICE_ID, ConfigError, Settings, mask_phone, normalize_language


def test_http_mode_requires_url_and_secret():
    with pytest.raises(ConfigError, match="SOTERRA_BACKEND_URL, VOICE_API_SECRET"):
        Settings.from_env({"BACKEND_MODE": "http"})
    with pytest.raises(ConfigError, match="convex.site"):
        Settings.from_env({"BACKEND_MODE": "http", "SOTERRA_BACKEND_URL": "http://example.com", "VOICE_API_SECRET": "s"})


def test_mock_mode_needs_nothing_and_defaults_are_sane():
    s = Settings.from_env({"BACKEND_MODE": "mock"})
    assert (s.default_language, s.turn_timeout_s, s.filler_after_s, s.max_consecutive_failures) == ("en", 8.0, 1.6, 3)
    assert s.voice_for("es") == DEFAULT_VOICE_ID
    assert "secret" not in repr(Settings.from_env({"BACKEND_MODE": "http", "SOTERRA_BACKEND_URL": "https://x.convex.site", "VOICE_API_SECRET": "secret"}))


def test_full_settings():
    s = Settings.from_env(
        {
            "BACKEND_MODE": "http",
            "SOTERRA_BACKEND_URL": "https://brazen-perch-21.convex.site/",
            "VOICE_API_SECRET": "s",
            "DEFAULT_LANGUAGE": "es-US",
            "TURN_TIMEOUT_S": "6.5",
            "FILLER_AFTER_S": "1",
            "VOICE_ID_EN": "en-voice",
            "VOICE_ID_ES": "es-voice",
            "LANGUAGE_BY_DIALED_NUMBER": "+14155550100:es, +14155550101:EN",
        }
    )
    assert s.backend_url == "https://brazen-perch-21.convex.site"
    assert s.default_language == "es"
    assert s.turn_timeout_s == 6.5
    assert s.voice_ids == {"en": "en-voice", "es": "es-voice"}
    assert s.language_by_dialed_number == {"+14155550100": "es", "+14155550101": "en"}


@pytest.mark.parametrize(
    "env",
    [{"LANGUAGE_BY_DIALED_NUMBER": "4155550100:es"}, {"LANGUAGE_BY_DIALED_NUMBER": "+14155550100:fr"}, {"TURN_TIMEOUT_S": "soon"}, {"DEFAULT_LANGUAGE": "zh"}, {"BACKEND_MODE": "grpc"}],
)
def test_bad_values_fail_fast(env):
    with pytest.raises(ConfigError):
        Settings.from_env({"BACKEND_MODE": "mock", **env})


def test_mask_phone():
    assert mask_phone("+14155559876") == "+1415***9876"
    assert mask_phone(None) == "-"
    assert mask_phone("+1234") == "***"


def test_normalize_language():
    assert normalize_language("es-MX") == "es"
    assert normalize_language("fr") is None


def test_own_numbers():
    assert Settings.from_env({"BACKEND_MODE": "mock", "SOTERRA_PHONE_NUMBERS": "+17126003362, +14155550100"}).own_numbers == {"+17126003362", "+14155550100"}
    with pytest.raises(ConfigError):
        Settings.from_env({"BACKEND_MODE": "mock", "SOTERRA_PHONE_NUMBERS": "7126003362"})
