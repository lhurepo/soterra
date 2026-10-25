import Observation
import SwiftUI

enum AppTab: Hashable {
    case home, alerts, map, household, more
}

/// Screens pushed onto a tab's navigation stack.
enum Route: Hashable {
    case alert(HazardAlert.ID)
    case assistant(topic: String?)
    case activity, callHistory, following, checklist, area, language, privacy, settings, about
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

/// Something tapped on the map, shown in the slide-up panel.
enum MapPlace: Hashable {
    case shelter(Shelter.ID)
    case zone(String)
    case fire
    case roadClosure
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
    var mapPath: [Route] = []
    var morePath: [Route] = []
    var isShowingDanger = false
    var toast: Toast?

    // Live data (GET /app/state). The demo scenarios below are used until a fetch succeeds, or when live is off.
    var useLiveData = true
    private(set) var liveState: AppStateResponse?
    private(set) var isRefreshing = false
    @ObservationIgnored var client: AppStateFetching = BackendClient()

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
    var mapSelection: MapPlace?

    // Household
    var members: [HouseholdMember] = DemoData.members
    var meetingPointID: Shelter.ID = DemoData.ridgeviewCenterID

    // Settings
    var language: AppLanguage = .english
    var savesTranscripts = false
    var savedNeeds: [String] = DemoData.savedNeeds
    var checklist: [ChecklistItem] = DemoData.checklist
    /// One screen with bigger text and only the essentials (More → Simple mode). Kept across launches.
    var isSimpleMode = UserDefaults.standard.bool(forKey: AppModel.simpleModeKey) {
        didSet { UserDefaults.standard.set(isSimpleMode, forKey: AppModel.simpleModeKey) }
    }

    static let simpleModeKey = "SoterraSimpleMode"

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
        if defaults.object(forKey: "SoterraLive") != nil { useLiveData = defaults.bool(forKey: "SoterraLive") }
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

    /// True when Home, Alerts and Today show the backend's bulletins instead of the demo scenarios.
    var isShowingLive: Bool { useLiveData && liveState != nil }
    var alerts: [HazardAlert] {
        if isShowingLive, let liveState { return LiveAlerts.alerts(from: liveState) }
        return DemoData.alerts(for: scenario)
    }
    var topAlert: HazardAlert? { alerts.first }
    var todayItems: [TimelineItem] {
        if isShowingLive, let liveState { return LiveAlerts.timeline(from: liveState) }
        return DemoData.today(for: scenario)
    }
    var homeTitle: String { isShowingLive || scenario == .calm ? "Home" : "Ridgeview Fire" }
    var newUpdateCount: Int {
        if isShowingLive, let liveState { return liveState.alerts.filter { $0.updatedAt != nil }.count }
        return scenario == .escalated ? 3 : 2
    }

    func alert(id: HazardAlert.ID) -> HazardAlert? {
        alerts.first { $0.id == id } ?? DemoData.alert(id: id)
    }

    var visibleAlerts: [HazardAlert] {
        switch alertsFilter {
        case .all: alerts
        case .following: alerts.filter { followedAlertIDs.contains($0.id) }
        }
    }

    var meetingPoint: Shelter {
        DemoData.shelters.first { $0.id == meetingPointID } ?? DemoData.shelters[0]
    }

    var selectedShelterID: Shelter.ID? {
        if case .shelter(let id) = mapSelection { id } else { nil }
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
        case .map: mapPath.append(route)
        }
    }

    func showShelters() {
        mapFilters.showsShelters = true
        mapSelection = .shelter(meetingPointID)
        mapPath = []
        selectedTab = .map
    }

    func showZonesOnMap() {
        mapFilters.showsZones = true
        mapSelection = nil
        mapPath = []
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

    /// Fetches the latest alerts and crisis state. On failure it keeps whatever was shown before.
    func refresh() async {
        guard useLiveData, !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            liveState = try await client.fetchAppState()
        } catch {
            if liveState == nil { show("Can't reach Soterra. Showing demo information.") }
        }
    }

    func show(_ message: String) {
        toast = Toast(message: message)
    }
}
