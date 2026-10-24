import Observation
import SwiftUI

enum AppTab: Hashable {
    case home, alerts, map, household, more
}

/// Screens pushed onto a tab's navigation stack.
enum Route: Hashable {
    case alert(HazardAlert.ID)
    case assistant(topic: String?)
    case activity, callHistory, following, checklist, language, privacy, settings, about
}

/// Which Home the demo shows. Switch it in More → Demo controls.
enum HomeScenario: String, CaseIterable, Identifiable {
    case crisis, escalated, calm

    var id: String { rawValue }

    var label: String {
        switch self {
        case .crisis: "Warning"
        case .escalated: "Order"
        case .calm: "No alerts"
        }
    }
}

enum Appearance: String, CaseIterable, Identifiable {
    case light, dark, system

    var id: String { rawValue }

    var label: String {
        switch self {
        case .light: "Light"
        case .dark: "Dark"
        case .system: "Match system"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .light: .light
        case .dark: .dark
        case .system: nil
        }
    }
}

enum AlertsFilter: String, CaseIterable, Identifiable {
    case following, all

    var id: String { rawValue }
    var label: String { self == .following ? "Following" : "All" }
}

struct MapFilters: Equatable {
    var showsShelters = true
    var petFriendlyOnly = false
    var showsZones = true
    var showsRoads = true
}

struct Toast: Identifiable, Equatable {
    let id = UUID()
    let message: String
}

/// App-wide state for the mock. Light mode is the default appearance.
@Observable
final class AppModel {
    // Navigation
    var selectedTab: AppTab = .home
    var homePath: [Route] = []
    var alertsPath: [Route] = []
    var householdPath: [Route] = []
    var morePath: [Route] = []
    var isShowingDanger = false
    var toast: Toast?

    // Demo controls
    var scenario: HomeScenario = .crisis
    var isOffline = false
    var appearance: Appearance = .light

    // Alerts and following
    var alertsFilter: AlertsFilter = .all
    var followedAlertIDs: Set<HazardAlert.ID> = [DemoData.warningID, DemoData.orderID]
    var followedTopics: [FollowedTopic] = DemoData.followedTopics

    // Map
    var mapFilters = MapFilters()
    var selectedShelterID: Shelter.ID?

    // Household
    var members: [HouseholdMember] = DemoData.members
    var meetingPointID: Shelter.ID = DemoData.ridgeviewCenterID

    // Settings
    var language: AppLanguage = .english
    var savesTranscripts = false
    var savedNeeds: [String] = DemoData.savedNeeds
    var checklist: [ChecklistItem] = DemoData.checklist

    init() {
        #if DEBUG
        applyLaunchArguments()
        #endif
    }

    #if DEBUG
    /// Debug builds accept launch arguments for screenshots and UI checks, for example
    /// `-SoterraTab map -SoterraScenario escalated -SoterraAppearance dark -SoterraOffline YES`.
    private func applyLaunchArguments() {
        let defaults = UserDefaults.standard
        let tabs: [String: AppTab] = ["home": .home, "alerts": .alerts, "map": .map, "household": .household, "more": .more]
        if let tab = defaults.string(forKey: "SoterraTab").flatMap({ tabs[$0] }) { selectedTab = tab }
        if let scenario = defaults.string(forKey: "SoterraScenario").flatMap(HomeScenario.init(rawValue:)) {
            self.scenario = scenario
        }
        if let appearance = defaults.string(forKey: "SoterraAppearance").flatMap(Appearance.init(rawValue:)) {
            self.appearance = appearance
        }
        isOffline = defaults.bool(forKey: "SoterraOffline")
        switch defaults.string(forKey: "SoterraScreen") {
        case "alert": homePath = [.alert(topAlert?.id ?? DemoData.warningID)]
        case "assistant": homePath = [.assistant(topic: "Evacuation Warning")]
        case "danger": isShowingDanger = true
        case "shelter": showShelters()
        default: break
        }
    }
    #endif

    // MARK: Derived

    var alerts: [HazardAlert] { DemoData.alerts(for: scenario) }
    var topAlert: HazardAlert? { alerts.first }
    var todayItems: [TimelineItem] { DemoData.today(for: scenario) }
    var homeTitle: String { scenario == .calm ? "Home" : "Ridgeview Fire" }
    var newUpdateCount: Int { scenario == .escalated ? 3 : 2 }

    var visibleAlerts: [HazardAlert] {
        switch alertsFilter {
        case .all: alerts
        case .following: alerts.filter { followedAlertIDs.contains($0.id) }
        }
    }

    var meetingPoint: Shelter {
        DemoData.shelters.first { $0.id == meetingPointID } ?? DemoData.shelters[0]
    }

    var checkedInCount: Int { members.filter(\.status.isCheckedIn).count }

    /// One line for the Household tile and summary.
    var householdSummary: (text: String, needsAttention: Bool) {
        if let waiting = members.first(where: { $0.status == .awaiting }) {
            let since = waiting.lastUpdate.map { " · \($0)" } ?? ""
            return ("\(waiting.name) hasn't checked in\(since)", true)
        }
        return ("\(checkedInCount) of \(members.count) checked in", false)
    }

    var householdMessage: String {
        let you = members.first(where: \.isYou)
        var parts: [String] = []
        if let you {
            switch you.status {
            case .onMyWay: parts.append("\(you.name) is on the way to \(meetingPoint.name), \(meetingPoint.address).")
            case .atMeetingPoint: parts.append("\(you.name) is at \(meetingPoint.name), \(meetingPoint.address).")
            default: parts.append("\(you.name) is safe. Meeting point: \(meetingPoint.name), \(meetingPoint.address).")
            }
        }
        let waiting = members.filter { !$0.status.isCheckedIn }.map(\.name)
        if !waiting.isEmpty {
            parts.append("\(ListFormatter.localizedString(byJoining: waiting)), please check in.")
        }
        return parts.joined(separator: " ")
    }

    /// The times shown on an alert card; offline, "Now" becomes the time the data was saved.
    func displayTimes(for alert: HazardAlert) -> [TimeMark] {
        guard isOffline else { return alert.times }
        return alert.times.map { $0.label == "Now" ? TimeMark(label: "Saved", value: DemoConfig.lastSyncTime) : $0 }
    }

    // MARK: Actions

    func push(_ route: Route, on tab: AppTab) {
        selectedTab = tab
        switch tab {
        case .home: homePath.append(route)
        case .alerts: alertsPath.append(route)
        case .household: householdPath.append(route)
        case .more: morePath.append(route)
        case .map: break
        }
    }

    func showShelters() {
        mapFilters.showsShelters = true
        selectedShelterID = meetingPointID
        selectedTab = .map
    }

    func showZonesOnMap() {
        mapFilters.showsZones = true
        selectedShelterID = nil
        selectedTab = .map
    }

    func showFollowing() {
        alertsFilter = .following
        selectedTab = .alerts
    }

    func isFollowing(_ alert: HazardAlert) -> Bool { followedAlertIDs.contains(alert.id) }

    func toggleFollow(_ alert: HazardAlert) {
        if followedAlertIDs.remove(alert.id) == nil {
            followedAlertIDs.insert(alert.id)
            show("Now following \(alert.title.lowercased()) updates")
        } else {
            show("Stopped following \(alert.title.lowercased())")
        }
    }

    func setMyStatus(_ status: MemberStatus) {
        guard let index = members.firstIndex(where: \.isYou) else { return }
        members[index].status = status
        members[index].lastUpdate = "Just now"
        show("Your status: \(status.label)")
    }

    func setMeetingPoint(_ shelter: Shelter) {
        meetingPointID = shelter.id
        show("Meeting point set to \(shelter.name)")
    }

    func stopAllUpdates() {
        for index in followedTopics.indices { followedTopics[index].isActive = false }
        followedAlertIDs.removeAll()
        show("All updates stopped")
    }

    /// "Forget me": deletes saved needs and stops every update, like the voice command.
    func forgetMe() {
        savedNeeds.removeAll()
        for index in followedTopics.indices { followedTopics[index].isActive = false }
        followedAlertIDs.removeAll()
        show("Deleted what Soterra saved and stopped updates")
    }

    func show(_ message: String) {
        toast = Toast(message: message)
    }
}
