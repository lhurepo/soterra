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
    static let greeting = "Ask about the emergency. I answer only from official sources, and I say when I don't know yet."

    static let suggestions = [
        "What's going on with the Ridgeview Fire?",
        "Where are the shelters?",
        "Which roads are closed?",
        "Is Hillcrest Elementary open as a shelter?",
    ]

    private static let dangerPhrases = [
        "trapped", "danger", "can't get out", "cant get out", "help me", "hurt", "injured", "bleeding",
        "fire is at my", "flames", "smoke in my", "can't breathe", "cant breathe",
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
            return .confirmation("You're following the Ridgeview Fire evacuations. We'll call you if they change.")
        }
        if question.contains("hillcrest") { return .unknown(question: text) }
        if question.contains("shelter") { return .answer(shelterAnswer) }
        if question.contains("road") || question.contains("closed") || question.contains("closure") {
            return .answer(roadAnswer)
        }
        if question.contains("ridgeview") || question.contains("fire") || question.contains("going on")
            || question.contains("evacuat") || question.contains("zone") {
            return .answer(scenario == .escalated ? orderAnswer : fireAnswer)
        }
        return .unknown(question: text)
    }

    static let fireAnswer = SourcedAnswer(
        text: "The Ridgeview Fire is about **1,200 acres** and **10% contained**. Zones SON-3A and SON-3B are under an "
            + "Evacuation Warning: be ready to leave.",
        timeLabel: "Updated", time: "2:10 PM",
        source: SourceInfo(name: DemoData.fireInformation, corroboratedBy: [DemoData.emergencyManagement])
    )

    static let orderAnswer = SourcedAnswer(
        text: "Zone SON-3A is now under an **Evacuation Order: leave now**. Zone SON-3B is still under a Warning. "
            + "The fire is about 1,200 acres and 10% contained.",
        timeLabel: "Changed", time: "6:20 PM",
        source: SourceInfo(name: DemoData.emergencyManagement, corroboratedBy: [DemoData.fireInformation])
    )

    static let shelterAnswer = SourcedAnswer(
        text: "Two shelters are open: **Ridgeview Community Center**, 500 Elm Street (120 of 200 spaces, pets in crates), "
            + "and **Santa Rosa Veterans Building** (210 of 300 spaces, service animals only).",
        timeLabel: "Checked", time: "2:30 PM",
        source: SourceInfo(name: DemoData.emergencyManagement),
        note: "Space was checked at 2:30 PM and may have changed."
    )

    static let roadAnswer = SourcedAnswer(
        text: "**Ridgeview Road is closed** both ways between Highway 12 and Bennett Valley Road. "
            + "Use Highway 12 or Bennett Valley Road instead.",
        timeLabel: "Issued", time: "1:15 PM",
        source: SourceInfo(name: DemoData.caltrans)
    )
}
