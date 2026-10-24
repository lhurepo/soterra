"""[V] SoterraAgent behaviour with MockBackendClient: greeting, turns, filler, barge-in, failures, end, outbound,
language selection, repeat, logging hygiene."""

import asyncio
import logging
from types import SimpleNamespace

from line.events import AgentEndCall, AgentSendText, AgentTurnStarted, AgentUpdateCall, CallEnded, CallStarted, LogMetric, UserTurnStarted

from soterra_voice import phrases
from soterra_voice.agent import CallInfo, SoterraAgent, barged_in, call_info_from_request, is_repeat_request, split_greeting
from soterra_voice.backend_client import Fault, MockBackendClient, MockTurn
from soterra_voice.models import SessionEndRequest, SessionStartRequest, TurnRequest

from conftest import ENV, collect, ended, make, said, settings, user


def turns(backend) -> list[TurnRequest]:
    return [r for r in backend.requests if isinstance(r, TurnRequest)]


def ends(backend) -> list[SessionEndRequest]:
    return [r for r in backend.requests if isinstance(r, SessionEndRequest)]


# 3. call start


def test_call_started_speaks_the_backend_greeting_with_the_notice_uninterruptible():
    agent, _ = make()
    out = collect(agent, CallStarted())
    texts = [o for o in out if isinstance(o, AgentSendText)]
    assert " ".join(t.text for t in texts) == MockBackendClient().greeting
    notice = [t for t in texts if "transcribed" in t.text]
    assert len(notice) == 1 and notice[0].interruptible is False
    assert all(t.interruptible for t in texts if t is not notice[0])
    assert agent.session_id == "mock-session-call-1"


def test_failed_start_speaks_local_greeting_and_first_turn_uses_provider_call_id():
    agent, backend = make(MockBackendClient(start_fault=Fault.HTTP_500))
    greeting = " ".join(said(collect(agent, CallStarted())))
    assert greeting == phrases.greeting_fallback("en")
    collect(agent, user("hello"))
    first = turns(backend)[0]
    assert first.session_id is None and first.provider_call_id == "call-1"
    assert agent.session_id == "mock-session-call-1"  # learned from the reply


def test_prestarted_session_from_pre_call_metadata_skips_a_second_start():
    backend = MockBackendClient()
    agent = SoterraAgent(backend, CallInfo(provider_call_id="c9"), settings(), prestarted={"soterra_session_id": "s9", "soterra_language": "es", "soterra_greeting": "Hola. Esta llamada se transcribe."})
    out = collect(agent, CallStarted())
    assert said(out) == ["Hola.", "Esta llamada se transcribe."]
    assert not any(isinstance(r, SessionStartRequest) for r in backend.requests)
    assert agent.language == "es"


def test_greeting_split():
    assert split_greeting("Hi. Short.") == [("Hi. Short.", True)]
    assert split_greeting("A. B. This call is transcribed. C?") == [("A. B.", True), ("This call is transcribed.", False), ("C?", True)]


# 4. turns


def test_turn_joins_text_increments_index_and_speaks_reply_verbatim():
    reply = "An Evacuation Warning is in effect. That's from Sonoma County (Demo), issued October 24 at 1:45 PM Pacific."
    agent, backend = make(MockBackendClient(script=[MockTurn(reply=reply), MockTurn(reply="Second.")]))
    collect(agent, CallStarted())
    assert said(collect(agent, user("What's going on", " with the  fire?"))) == [reply]
    collect(agent, user("and roads?"))
    sent = turns(backend)
    assert [t.turn_index for t in sent] == [0, 1]
    assert sent[0].utterance == "What's going on with the  fire?"
    assert all(t.language == "en" and t.session_id == "mock-session-call-1" for t in sent)


def test_empty_turn_is_skipped():
    agent, backend = make()
    collect(agent, CallStarted())
    assert collect(agent, user("   ")) == []
    assert turns(backend) == [] and agent.turn_index == 0


def test_degraded_reply_is_spoken_normally():
    agent, _ = make(MockBackendClient(script=[MockTurn(reply="Safe fallback from backend. Dial 911 if in danger.", kind="no_info", degraded=True)]))
    collect(agent, CallStarted())
    assert said(collect(agent, user("hi"))) == ["Safe fallback from backend. Dial 911 if in danger."]
    assert agent.consecutive_failures == 0


# 5. filler


def test_slow_backend_gets_exactly_one_filler_then_the_reply():
    agent, _ = make(MockBackendClient(script=[MockTurn(reply="Answer.", delay_s=0.3)]), filler_after_s=0.05)
    collect(agent, CallStarted())
    out = collect(agent, user("question"))
    assert said(out) == [phrases.phrase("filler", "en"), "Answer."]
    assert any(isinstance(o, LogMetric) and o.name == "filler_used" for o in out)


def test_fast_backend_gets_no_filler():
    agent, _ = make(filler_after_s=0.5)
    collect(agent, CallStarted())
    assert said(collect(agent, user("question"))) == ["(mock) You said: question"]


# 6. endCall


def test_end_call_speaks_reply_then_ends_and_closes_session_once():
    agent, backend = make(MockBackendClient(script=[MockTurn(reply="Goodbye.", kind="goodbye", end_call=True)]))
    collect(agent, CallStarted())
    out = collect(agent, user("bye"))
    assert said(out) == ["Goodbye."]
    assert isinstance(out[-1], AgentEndCall)
    collect(agent, CallEnded())
    assert [e.reason for e in ends(backend)] == ["agent_end"]


# 7. barge-in


def test_cancellation_mid_request_cancels_the_http_task_and_flags_the_next_turn():
    backend = MockBackendClient(script=[MockTurn(reply="never spoken", delay_s=5), MockTurn(reply="Second.")])
    agent, _ = make(backend, filler_after_s=10)

    async def go():
        async for _ in agent.process(ENV, CallStarted()):
            pass

        async def consume():
            return [o async for o in agent.process(ENV, user("first question"))]

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.05)
        task.cancel()  # what the runner does on UserTurnStarted
        try:
            await task
        except asyncio.CancelledError:
            pass
        assert backend.cancelled_turns == 1
        assert {t for t in asyncio.all_tasks() if t is not asyncio.current_task()} == set()
        return [o async for o in agent.process(ENV, user("second question"))]

    out = asyncio.run(go())
    assert said(out) == ["Second."]
    first, second = turns(backend)
    assert first.interrupted_previous is None
    assert (second.turn_index, second.interrupted_previous) == (1, True)


def test_barge_in_detected_from_history():
    speaking = user("q")
    speaking.history = [AgentTurnStarted(), UserTurnStarted()]
    assert barged_in(speaking)
    assert not barged_in(user("q"))


# 8. failures


def test_errors_speak_fallback_with_911_and_keep_turn_indexes_consistent():
    backend = MockBackendClient(script=[Fault.TIMEOUT, Fault.MALFORMED, MockTurn(reply="Back."), Fault.HTTP_500])
    agent, _ = make(backend)
    collect(agent, CallStarted())
    for _ in range(2):
        out = collect(agent, user("q"))
        assert said(out) == [phrases.fallback("en")] and "911" in said(out)[0] and not ended(out)
    assert said(collect(agent, user("q"))) == ["Back."]
    assert agent.consecutive_failures == 0
    assert said(collect(agent, user("q"))) == [phrases.fallback("en")]
    assert [t.turn_index for t in turns(backend)] == [0, 1, 2, 3]


def test_turn_timeout_uses_fallback():
    agent, _ = make(MockBackendClient(script=[MockTurn(reply="late", delay_s=1.0)]), filler_after_s=0.05, turn_timeout_s=0.2)
    collect(agent, CallStarted())
    out = said(collect(agent, user("q")))
    assert out == [phrases.phrase("filler", "en"), phrases.fallback("en")]


def test_three_failures_in_a_row_end_the_call_with_reason_error():
    agent, backend = make(MockBackendClient(script=[Fault.NETWORK, Fault.NETWORK, Fault.UNAUTHORIZED]))
    collect(agent, CallStarted())
    collect(agent, user("1"))
    collect(agent, user("2"))
    out = collect(agent, user("3"))
    assert said(out) == [phrases.phrase("give_up", "en")] and ended(out)
    collect(agent, CallEnded())
    assert [e.reason for e in ends(backend)] == ["error"]


# 9. outbound


def test_outbound_metadata_starts_an_outbound_session_with_the_notification():
    request = SimpleNamespace(call_id="out-1", from_="+17075550100", to="+17075550123", metadata={"notificationId": "n123"})
    info = call_info_from_request(request, settings())
    assert (info.direction, info.notification_id, info.caller_phone, info.called_phone) == ("outbound", "n123", "+17075550123", "+17075550100")
    agent, backend = make(call=info)
    collect(agent, CallStarted())
    start = next(r for r in backend.requests if isinstance(r, SessionStartRequest))
    assert (start.direction, start.notification_id) == ("outbound", "n123")
    assert collect(agent, user("what changed?"))  # the conversation continues normally


def test_withheld_caller_id_is_omitted():
    info = call_info_from_request(SimpleNamespace(call_id="c", from_="anonymous", to="+17075550100", metadata=None), settings())
    assert info.caller_phone is None and info.direction == "inbound"


# 10. call end


def test_call_ended_closes_the_session_exactly_once_as_caller_hangup():
    agent, backend = make()
    collect(agent, CallStarted())
    collect(agent, CallEnded())
    collect(agent, CallEnded())
    assert [e.reason for e in ends(backend)] == ["caller_hangup"]


def test_end_session_failure_is_swallowed():
    agent, backend = make(MockBackendClient(end_fault=Fault.TIMEOUT))
    collect(agent, CallStarted())
    assert collect(agent, CallEnded()) == []


# 11. language


def test_language_priority_saved_language_from_backend_wins_over_default():
    agent, _ = make(MockBackendClient(language="es"))
    out = collect(agent, CallStarted())
    update = next(o for o in out if isinstance(o, AgentUpdateCall))
    assert (update.language, agent.language) == ("es", "es")
    agent.backend.script.append(Fault.NETWORK)
    assert said(collect(agent, user("¿qué pasa?"))) == [phrases.fallback("es")]


def test_dialed_number_map_sets_the_language_hint():
    s = settings(language_by_dialed_number={"+14155550100": "es"})
    info = call_info_from_request(SimpleNamespace(call_id="c", from_="+17075550123", to="+14155550100", metadata={}), s)
    assert info.language_hint == "es"
    backend = MockBackendClient()
    agent = SoterraAgent(backend, info, s)
    collect(agent, CallStarted())
    assert next(r for r in backend.requests if isinstance(r, SessionStartRequest)).language_hint == "es"
    assert agent.language == "es"
    collect(agent, user("hola"))
    assert turns(backend)[0].language == "es"


def test_spanish_session_uses_spanish_voice_and_phrases():
    agent, _ = make(MockBackendClient(language="es", start_fault=None), voice_ids={"en": "voice-en", "es": "voice-es"})
    out = collect(agent, CallStarted())
    assert next(o for o in out if isinstance(o, AgentUpdateCall)).voice_id == "voice-es"


def test_dtmf_two_switches_to_spanish_and_one_back():
    agent, backend = make(voice_ids={"en": "voice-en", "es": "voice-es"})
    collect(agent, CallStarted())
    out = collect(agent, user(dtmf="2"))
    assert isinstance(out[0], AgentUpdateCall) and (out[0].language, out[0].voice_id) == ("es", "voice-es")
    assert said(out) == [phrases.phrase("switched", "es")]
    collect(agent, user("hola"))
    assert turns(backend)[-1].language == "es"
    assert said(collect(agent, user(dtmf="1"))) == [phrases.phrase("switched", "en")]
    assert collect(agent, user(dtmf="1")) == []  # already English


def test_spanish_offer_is_optional():
    agent, _ = make(offer_spanish_dtmf=True)
    assert said(collect(agent, CallStarted()))[-1] == "Para español, oprima dos."


# repeat


def test_repeat_replays_the_last_reply_without_a_backend_call():
    agent, backend = make(MockBackendClient(script=[MockTurn(reply="The answer.")]))
    collect(agent, CallStarted())
    assert said(collect(agent, user("can you repeat that"))) == [phrases.phrase("nothing_to_repeat", "en")]
    collect(agent, user("question"))
    assert said(collect(agent, user("Say that again, please."))) == ["The answer."]
    assert len(turns(backend)) == 1


def test_repeat_phrase_list_is_tight():
    for yes in ("repeat that", "Repeat.", "please repeat", "say it again", "¿Puede repetir?", "repítelo", "repite por favor"):
        assert is_repeat_request(yes), yes
    for no in ("repeat the evacuation order for zone 3", "can you say again where the shelter is", "I need to repeat my question about pets"):
        assert not is_repeat_request(no), no


# 12. logging


def test_phone_numbers_are_masked_in_logs(caplog):
    caplog.set_level(logging.INFO, logger="soterra.voice")
    agent, _ = make(MockBackendClient(start_fault=Fault.NETWORK))
    collect(agent, CallStarted())
    collect(agent, user("hi"))
    text = caplog.text
    assert "+17075550123" not in text and "+1707***0123" in text


def test_outbound_recognised_by_our_own_number_and_tied_by_agent_call_id():
    s = settings(own_numbers=frozenset({"+17126003362"}))
    request = SimpleNamespace(call_id="c-out", agent_call_id="ac_live_1", from_="+17126003362", to="+17075550123", metadata={})
    info = call_info_from_request(request, s)
    assert (info.direction, info.caller_phone, info.called_phone, info.notification_id, info.agent_call_id) == (
        "outbound", "+17075550123", "+17126003362", None, "ac_live_1")
    backend = MockBackendClient()
    collect(SoterraAgent(backend, info, s), CallStarted())
    start = next(r for r in backend.requests if isinstance(r, SessionStartRequest))
    assert (start.direction, start.provider_agent_call_id, start.caller_phone) == ("outbound", "ac_live_1", "+17075550123")


def test_inbound_to_our_number_stays_inbound():
    s = settings(own_numbers=frozenset({"+17126003362"}))
    info = call_info_from_request(SimpleNamespace(call_id="c", agent_call_id="ac_2", from_="+17075550123", to="+17126003362", metadata=None), s)
    assert (info.direction, info.caller_phone) == ("inbound", "+17075550123")


def test_notification_id_from_nested_dynamic_variables():
    request = SimpleNamespace(call_id="c", from_="+17126003362", to="+17075550123", metadata={"dynamic_variables": {"notification_id": "n9"}})
    assert call_info_from_request(request, settings()).notification_id == "n9"
