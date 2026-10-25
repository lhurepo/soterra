import CoreLocation
import Foundation

// Value types for the demo app. They mirror the backend's data (convex/schema.ts, src/contracts) closely
// enough that a later Convex client can fill them in without changing the views.

/// The data's five severities collapse to three visible levels: high (red), medium and low (both yellow), and info.
enum Severity: String, CaseIterable, Hashable {
    case extreme, severe, moderate, minor, unknown

    var label: String {
        switch self {
        case .extreme: "Extreme"
        case .severe: "Severe"
        case .moderate: "Moderate"
        case .minor: "Minor"
        case .unknown: "Info"
        }
    }

    var level: SeverityLevel {
        switch self {
        case .extreme, .severe: .high
        case .moderate: .medium
        case .minor: .low
        case .unknown: .unknown
        }
    }
}

enum SeverityLevel: String, CaseIterable, Hashable {
    case high, medium, low, unknown

    /// Short label used next to list markers ("High", "Med", "Low").
    var shortLabel: String {
        switch self {
        case .high: "High"
        case .medium: "Med"
        case .low: "Low"
        case .unknown: "Info"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .high: "High severity"
        case .medium: "Medium severity"
        case .low: "Low severity"
        case .unknown: "Information"
        }
    }
}

enum AlertKind: String, Hashable {
    case warning, order, advisory, update, closure, info

    var label: String {
        switch self {
        case .warning: "Warning"
        case .order: "Order"
        case .advisory: "Advisory"
        case .update: "Update"
        case .closure: "Closure"
        case .info: "Info"
        }
    }
}

enum HazardType: String, Hashable {
    case wildfire, evacuation, shelter, roadClosure
    case flood, hurricane, tornado, earthquake, tsunami, winterStorm, extremeHeat, other

    /// The backend's `hazardType` strings (snake_case) map onto these cases.
    init(backend: String) {
        switch backend {
        case "wildfire": self = .wildfire
        case "evacuation": self = .evacuation
        case "shelter": self = .shelter
        case "road_closure": self = .roadClosure
        case "flood": self = .flood
        case "hurricane": self = .hurricane
        case "tornado": self = .tornado
        case "earthquake": self = .earthquake
        case "tsunami": self = .tsunami
        case "winter_storm": self = .winterStorm
        case "extreme_heat": self = .extremeHeat
        default: self = .other
        }
    }

    var systemImage: String {
        switch self {
        case .wildfire: "flame"
        case .evacuation: "figure.walk"
        case .shelter: "house"
        case .roadClosure: "road.lanes"
        case .flood: "water.waves"
        case .hurricane: "hurricane"
        case .tornado: "tornado"
        case .earthquake: "waveform.path.ecg"
        case .tsunami: "water.waves.and.arrow.up"
        case .winterStorm: "snowflake"
        case .extremeHeat: "thermometer.sun"
        case .other: "exclamationmark.triangle"
        }
    }
}

/// One labelled time in a card's time strip, for example "Issued 1:45 PM".
struct TimeMark: Identifiable, Hashable {
    let label: String
    let value: String
    var isHighlighted = false

    var id: String { label }
}

/// Where a piece of information came from. Every disaster fact in the app carries one.
struct SourceInfo: Hashable {
    let name: String
    var isOfficial = true
    /// Other independent sources reporting the same incident ("Also reported by …").
    var corroboratedBy: [String] = []
    var sourcesDiffer = false
}

struct ActionStep: Identifiable, Hashable {
    let id: String
    let text: String
    let systemImage: String
}

struct HazardAlert: Identifiable, Hashable {
    let id: String
    let severity: Severity
    let kind: AlertKind
    let hazard: HazardType
    /// Short name used as a screen title, for example "Evacuation Warning".
    let title: String
    /// The card headline: what it is and what to do.
    let headline: String
    /// The instruction alone, for the detail screen ("Be ready to leave.").
    let instruction: String
    let area: String
    let details: String
    let times: [TimeMark]
    let source: SourceInfo
    var changeNote: String?
    var steps: [ActionStep] = []

    var chipText: String { "\(severity.label) · \(kind.label)" }
}

/// Which group a timeline row is listed under on Home.
enum TimelineDay: CaseIterable, Hashable {
    case today, yesterday, earlier

    var title: String {
        switch self {
        case .today: "Today"
        case .yesterday: "Yesterday"
        case .earlier: "Earlier"
        }
    }
}

/// A row in Home's update list: one official update on the time column. `time` is the clock time for today and
/// yesterday, and the date alone for earlier days.
struct TimelineItem: Identifiable, Hashable {
    let id: String
    let time: String
    let text: String
    let source: String
    let severity: Severity
    var alertID: HazardAlert.ID?
    var day: TimelineDay = .today
}

struct Shelter: Identifiable, Hashable {
    let id: String
    let name: String
    let address: String
    let latitude: Double
    let longitude: Double
    let capacity: Int
    let spacesAvailable: Int
    let animalPolicy: String
    let takesPets: Bool
    let checkedAt: String
    /// Capacity was checked long enough ago that it should be confirmed before relying on it.
    let needsReconfirming: Bool
    /// Shelters that have not opened yet say when, instead of "Open".
    var isOpen = true
    var statusText = "Open"

    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
}

enum MemberStatus: String, CaseIterable, Hashable, Identifiable {
    case onMyWay, atMeetingPoint, safe, checkingIn, awaiting

    var id: String { rawValue }

    var label: String {
        switch self {
        case .onMyWay: "On my way"
        case .atMeetingPoint: "At meeting point"
        case .safe: "Safe where I am"
        case .checkingIn: "Checking in"
        case .awaiting: "Awaiting"
        }
    }

    var isCheckedIn: Bool {
        switch self {
        case .onMyWay, .atMeetingPoint, .safe: true
        case .checkingIn, .awaiting: false
        }
    }

    /// The statuses a person can pick for themselves.
    static let selectable: [MemberStatus] = [.onMyWay, .atMeetingPoint, .safe]
}

struct HouseholdMember: Identifiable, Hashable {
    let id: String
    let name: String
    let role: String
    var status: MemberStatus
    var lastUpdate: String?
    var isYou = false
}

struct FollowedTopic: Identifiable, Hashable {
    let id: String
    let title: String
    let trigger: String
    let channel: String
    var isActive = true
}

struct CallRecord: Identifiable, Hashable {
    let id: String
    let topic: String
    let date: String
    let duration: String
    let language: String
    let summary: String
}

struct ActivityItem: Identifiable, Hashable {
    let id: String
    let title: String
    let detail: String
    let time: String
    let systemImage: String
}

struct ChecklistItem: Identifiable, Hashable {
    let id: String
    let title: String
    var isDone: Bool
}

enum AppLanguage: String, CaseIterable, Identifiable {
    case english, spanish

    var id: String { rawValue }

    var label: String {
        switch self {
        case .english: "English"
        case .spanish: "Español"
        }
    }
}
