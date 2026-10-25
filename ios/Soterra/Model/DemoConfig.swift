import Foundation

/// Settings for the demo build. The backend URL is the dev deployment (CLAUDE.md, "Live resources").
enum DemoConfig {
    /// The live Soterra hotline (docs: CLAUDE.md, "Live resources").
    static let hotlineDisplay = "+1 712 600 3362"
    static let hotlineURL = URL(string: "tel:+17126003362")!

    /// The Convex HTTP site that serves `GET /app/state`.
    static let backendURL = URL(string: "https://brazen-perch-21.convex.site")!

    /// When the offline state says the shown information was saved.
    static let lastSyncTime = "2:35 PM"
}
