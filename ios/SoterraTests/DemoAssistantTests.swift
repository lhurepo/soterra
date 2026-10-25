import XCTest
@testable import Soterra

final class DemoAssistantTests: XCTestCase {
    func testDangerComesFirstEvenWithOtherTopics() {
        let reply = DemoAssistant.reply(to: "I'm trapped, the building is on fire and I'm bleeding",
                                        previous: nil, scenario: .crisis)
        XCTAssertEqual(reply, .danger)
    }

    func testEarthquakeQuestionGetsASourcedAnswer() {
        let reply = DemoAssistant.reply(to: "What happened in the Marina?", previous: nil, scenario: .crisis)
        guard case .answer(let answer) = reply else { return XCTFail("Expected a sourced answer, got \(reply)") }
        XCTAssertEqual(answer.source.name, DemoData.usgs)
        XCTAssertTrue(answer.text.contains("6.4"))
        XCTAssertFalse(answer.source.corroboratedBy.isEmpty)
    }

    func testEscalatedScenarioAnswersWithTheOrder() {
        let reply = DemoAssistant.reply(to: "Am I in an evacuation zone?", previous: nil, scenario: .escalated)
        XCTAssertEqual(reply, .answer(DemoAssistant.orderAnswer))
    }

    func testUnansweredQuestionIsIDontKnowYet() {
        let question = "Is the Marina Branch Library damaged?"
        XCTAssertEqual(DemoAssistant.reply(to: question, previous: nil, scenario: .crisis), .unknown(question: question))
    }

    func testAnythingWithoutAnOfficialSourceIsUnknown() {
        let reply = DemoAssistant.reply(to: "Will the schools open tomorrow?", previous: nil, scenario: .crisis)
        guard case .unknown = reply else { return XCTFail("Expected I don't know yet, got \(reply)") }
    }

    func testCallMeAfterAnUnknownSavesTheQuestion() {
        let previous = ChatMessage.Content.unknown(question: "Is the Marina Branch Library damaged?")
        let reply = DemoAssistant.reply(to: "Call me when you know.", previous: previous, scenario: .crisis)
        guard case .confirmation(let text) = reply else { return XCTFail("Expected a confirmation, got \(reply)") }
        XCTAssertTrue(text.hasPrefix("Saved."))
    }

    func testSheltersAndRoads() {
        XCTAssertEqual(DemoAssistant.reply(to: "Where are the shelters?", previous: nil, scenario: .crisis),
                       .answer(DemoAssistant.shelterAnswer))
        XCTAssertEqual(DemoAssistant.reply(to: "Which roads are closed?", previous: nil, scenario: .crisis),
                       .answer(DemoAssistant.roadAnswer))
    }

    func testPalaceQuestionIsAnsweredByTheFireDepartment() {
        let reply = DemoAssistant.reply(to: "Is everyone at the Palace of Fine Arts OK?", previous: nil, scenario: .escalated)
        XCTAssertEqual(reply, .answer(DemoAssistant.palaceAnswer))
    }
}
