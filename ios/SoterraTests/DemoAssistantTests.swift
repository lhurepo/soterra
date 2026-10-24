import XCTest
@testable import Soterra

final class DemoAssistantTests: XCTestCase {
    func testDangerComesFirstEvenWithOtherTopics() {
        let reply = DemoAssistant.reply(to: "I'm trapped, the fire is at my house on Ridgeview Road",
                                        previous: nil, scenario: .crisis)
        XCTAssertEqual(reply, .danger)
    }

    func testRidgeviewQuestionGetsASourcedAnswer() {
        let reply = DemoAssistant.reply(to: "What's going on with the Ridgeview Fire?", previous: nil, scenario: .crisis)
        guard case .answer(let answer) = reply else { return XCTFail("Expected a sourced answer, got \(reply)") }
        XCTAssertEqual(answer.source.name, DemoData.fireInformation)
        XCTAssertTrue(answer.text.contains("1,200 acres"))
        XCTAssertFalse(answer.source.corroboratedBy.isEmpty)
    }

    func testEscalatedScenarioAnswersWithTheOrder() {
        let reply = DemoAssistant.reply(to: "What's going on with the Ridgeview Fire?", previous: nil, scenario: .escalated)
        XCTAssertEqual(reply, .answer(DemoAssistant.orderAnswer))
    }

    func testUnansweredQuestionIsIDontKnowYet() {
        let question = "Is Hillcrest Elementary open as a shelter?"
        XCTAssertEqual(DemoAssistant.reply(to: question, previous: nil, scenario: .crisis), .unknown(question: question))
    }

    func testAnythingWithoutAnOfficialSourceIsUnknown() {
        let reply = DemoAssistant.reply(to: "Will the schools open tomorrow?", previous: nil, scenario: .crisis)
        guard case .unknown = reply else { return XCTFail("Expected I don't know yet, got \(reply)") }
    }

    func testCallMeAfterAnUnknownSavesTheQuestion() {
        let previous = ChatMessage.Content.unknown(question: "Is Hillcrest Elementary open as a shelter?")
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
}
