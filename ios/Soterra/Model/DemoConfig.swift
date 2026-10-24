import Foundation

/// Settings for the mock build. Nothing here talks to the live backend.
enum DemoConfig {
    /// The live Soterra hotline (docs: CLAUDE.md, "Live resources").
    static let hotlineDisplay = "+1 804 606 6867"
    static let hotlineURL = URL(string: "tel:+18046066867")!

    /// Demo safety: every "Call 911" button opens the dialer with this number instead of 911, so testing the
    /// mock never reaches emergency services. iOS still asks before placing the call.
    /// Note: 119 is an emergency number in some countries (for example Japan and South Korea).
    static let emergencyDialNumber = "119"
    static var emergencyCallURL: URL { URL(string: "tel:\(emergencyDialNumber)")! }

    /// When the offline state says the shown information was saved.
    static let lastSyncTime = "2:35 PM"
}
