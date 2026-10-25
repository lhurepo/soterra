import Foundation

/// A sourced answer, shaped like the backend's grounded reply: text plus where and when it came from.
struct SourcedAnswer: Hashable {
    /// Markdown (bold only), for example "about **1,200 acres**".
    let text: String
    let timeLabel: String
    let time: String
    let source: SourceInfo
    var note: String?
}

struct ChatMessage: Identifiable, Hashable {
    enum Content: Hashable {
        case userText(String)
        case text(String)
        case answer(SourcedAnswer)
        /// "I don't know yet": the question was saved for officials.
        case unknown(question: String)
        case danger
        case confirmation(String)
    }

    let id = UUID()
    let content: Content
}

/// The demo's stand-in for the backend assistant. It answers only from DemoData and says "I don't know yet"
/// otherwise, the same rules the real orchestrator follows.
enum DemoAssistant {
    static let greeting = "Ask about the Marina Earthquake. I answer only from official sources, and I say when I don't know yet."

    static let suggestions = [
        "What happened in the Marina?",
        "Am I in an evacuation zone?",
        "Where is the nearest shelter?",
        "Is everyone at the Palace of Fine Arts OK?",
        "Is the Marina Branch Library damaged?",
    ]

    private static let dangerPhrases = [
        "trapped", "danger", "can't get out", "cant get out", "help me", "hurt", "injured", "bleeding",
        "fire is at my", "smell gas", "flames", "smoke in my", "can't breathe", "cant breathe",
    ]
    private static let followUpPhrases = ["call me", "tell me when", "let me know", "notify me", "when you know"]

    /// The reply to `text`. `previous` is Soterra's last message, so "call me when you know" can follow an
    /// unanswered question.
    static func reply(to text: String, previous: ChatMessage.Content?, scenario: HomeScenario) -> ChatMessage.Content {
        let question = text.lowercased()

        // Danger always comes first, whatever else the message says.
        if dangerPhrases.contains(where: { question.contains($0) }) { return .danger }

        if question.contains("stop updates") || question.contains("stop calling") {
            return .confirmation("Updates stopped. You can follow topics again any time.")
        }
        if followUpPhrases.contains(where: { question.contains($0) }) {
            if case .unknown = previous {
                return .confirmation("Saved. We'll tell you here when officials answer. Say \"stop updates\" any time.")
            }
            return .confirmation("You're following the Marina District evacuations. We'll call you if they change.")
        }
        if question.contains("library") && question.contains("damage") { return .unknown(question: text) }
        if question.contains("palace") || question.contains("cal hacks") || question.contains("everyone") {
            return .answer(palaceAnswer)
        }
        if question.contains("shelter") { return .answer(shelterAnswer) }
        if question.contains("road") || question.contains("closed") || question.contains("closure") {
            return .answer(roadAnswer)
        }
        if question.contains("evacuat") || question.contains("zone") {
            return .answer(scenario == .escalated ? orderAnswer : quakeAnswer)
        }
        if question.contains("earthquake") || question.contains("quake") || question.contains("happen")
            || question.contains("going on") || question.contains("marina") {
            return .answer(scenario == .escalated ? orderAnswer : quakeAnswer)
        }
        return .unknown(question: text)
    }

    static let quakeAnswer = SourcedAnswer(
        text: "A **magnitude 6.4 earthquake** struck at 3:41 PM, centered at the Palace of Fine Arts in the Marina District. "
            + "Aftershocks are likely. No evacuation order has been issued yet.",
        timeLabel: "Issued", time: "3:43 PM",
        source: SourceInfo(name: DemoData.usgs, corroboratedBy: [DemoData.fireDepartment])
    )

    static let orderAnswer = SourcedAnswer(
        text: "An **Evacuation Order: leave now** is in effect for the Marina District, north of Lombard Street, "
            + "from Van Ness Avenue to Lyon Street. That includes the Marina Branch Library. "
            + "Go to Hamilton Recreation Center, 1900 Geary Boulevard.",
        timeLabel: "Issued", time: "3:43 PM",
        source: SourceInfo(name: DemoData.emergencyManagement, corroboratedBy: [DemoData.fireDepartment])
    )

    static let palaceAnswer = SourcedAnswer(
        text: "The Palace of Fine Arts **partly collapsed**. **All Cal Hacks attendees and staff are accounted for.** "
            + "Fourteen people had minor injuries and were treated on scene.",
        timeLabel: "Issued", time: "3:43 PM",
        source: SourceInfo(name: DemoData.fireDepartment, corroboratedBy: [DemoData.emergencyManagement])
    )

    static let shelterAnswer = SourcedAnswer(
        text: "Two shelters are open: **Hamilton Recreation Center**, 1900 Geary Boulevard (180 of 250 spaces, pets in crates), "
            + "and **Kezar Pavilion**, 755 Stanyan Street (390 of 400 spaces, service animals only). "
            + "Moscone Center West opens at 6:00 PM.",
        timeLabel: "Checked", time: "3:45 PM",
        source: SourceInfo(name: DemoData.emergencyManagement),
        note: "Space was checked at 3:45 PM and may have changed."
    )

    static let roadAnswer = SourcedAnswer(
        text: "**Marina Boulevard is closed** both ways from Lyon Street to Laguna Street, and Lombard Street is closed "
            + "from Van Ness Avenue to Broderick Street. The Golden Gate Bridge is closed and BART is suspended.",
        timeLabel: "Issued", time: "3:44 PM",
        source: SourceInfo(name: DemoData.sfmta)
    )
}
