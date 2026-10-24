from line.events import AgentSendText

from soterra_voice.speech import say, speakable


def test_911_is_spoken_digit_by_digit():
    assert speakable("hang up and dial 911.") == "hang up and dial 9 1 1."
    assert speakable("marque 911 ahora") == "marque 9 1 1 ahora"
    assert speakable("911") == "9 1 1"


def test_other_numbers_are_untouched():
    assert speakable("Call 1-800-911-0000 or 9112 Elm Street or $911") == "Call 1-800-911-0000 or 9112 Elm Street or $911"
    assert speakable("412 Oak Lane, 1,911 acres, 1911") == "412 Oak Lane, 1,911 acres, 1911"


def test_say_keeps_other_fields():
    out = say("dial 911", interruptible=False)
    assert isinstance(out, AgentSendText)
    assert out.text == "dial 9 1 1"
    assert out.interruptible is False
