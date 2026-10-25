import XCTest
@testable import Soterra

final class AppModelTests: XCTestCase {
    func testLightModeIsTheDefault() {
        XCTAssertEqual(AppModel().appearance, .light)
    }

    func testTheHotlineIsTheOnlyNumberTheAppDials() {
        XCTAssertEqual(DemoConfig.hotlineURL.absoluteString, "tel:+17126003362")
    }

    func testSeverityLevels() {
        XCTAssertEqual(Severity.extreme.level, .high)
        XCTAssertEqual(Severity.severe.level, .high)
        XCTAssertEqual(Severity.moderate.level, .medium)
        XCTAssertEqual(Severity.minor.level, .low)
        XCTAssertEqual(Severity.unknown.level, .unknown)
        XCTAssertEqual(Severity.unknown.label, "Info")
    }

    func testTheBellIsUrgentUnlessEveryAlertIsInfo() {
        let model = AppModel()
        XCTAssertTrue(model.hasUrgentAlert)
        model.scenario = .calm
        XCTAssertTrue(model.alerts.isEmpty)
        XCTAssertFalse(model.hasUrgentAlert)
    }

    func testShowFollowingOpensTheAlertsList() {
        let model = AppModel()
        model.showFollowing()
        XCTAssertTrue(model.isShowingAlerts)
        XCTAssertEqual(model.alertsFilter, .following)
        model.showZonesOnMap()
        XCTAssertFalse(model.isShowingAlerts)
    }

    func testScenariosDriveTheTopAlert() {
        let model = AppModel()
        XCTAssertEqual(model.topAlert?.id, DemoData.orderID)
        model.scenario = .crisis
        XCTAssertEqual(model.topAlert?.id, DemoData.quakeID)
        model.scenario = .escalated
        XCTAssertEqual(model.topAlert?.id, DemoData.orderID)
        XCTAssertNotNil(model.topAlert?.changeNote)
        model.scenario = .calm
        XCTAssertNil(model.topAlert)
        XCTAssertEqual(model.homeTitle, "Home")
    }

    func testAlertsAreOrderedBySeverity() {
        let model = AppModel()
        model.scenario = .escalated
        let priorities = model.alerts.map(\.severity.priority)
        XCTAssertEqual(priorities, priorities.sorted())
        XCTAssertEqual(model.alerts.first?.severity, .extreme)
        XCTAssertEqual(model.alerts.first?.id, DemoData.orderID)
    }

    func testOfflineReplacesNowWithTheSavedTime() {
        let model = AppModel()
        model.isOffline = true
        let times = model.displayTimes(for: DemoData.evacuationOrder)
        XCTAssertFalse(times.contains { $0.label == "Now" })
        XCTAssertTrue(times.contains { $0.label == "Saved" && $0.value == DemoConfig.lastSyncTime })
    }

    func testHouseholdSummaryAndStatus() {
        let model = AppModel()
        XCTAssertEqual(model.checkedInCount, 2)
        XCTAssertTrue(model.householdSummary.needsAttention)
        XCTAssertTrue(model.householdMessage.contains("Leo"))
        model.setMyStatus(.atMeetingPoint)
        XCTAssertEqual(model.members.first(where: \.isYou)?.status, .atMeetingPoint)
    }

    func testToggleSafeUndoesToPreviousStatus() {
        let model = AppModel()
        let before = model.members.first(where: \.isYou)?.status
        model.toggleSafe()
        XCTAssertEqual(model.members.first(where: \.isYou)?.status, .safe)
        model.toggleSafe()
        XCTAssertEqual(model.members.first(where: \.isYou)?.status, before)
    }

    func testForgetMeClearsNeedsAndStopsUpdates() {
        let model = AppModel()
        model.forgetMe()
        XCTAssertTrue(model.savedNeeds.isEmpty)
        XCTAssertTrue(model.followedAlertIDs.isEmpty)
        XCTAssertFalse(model.followedTopics.contains(where: \.isActive))
    }

    func testShowSheltersOpensTheMapOnTheMeetingPoint() {
        let model = AppModel()
        model.showShelters()
        XCTAssertEqual(model.selectedTab, .map)
        XCTAssertEqual(model.selectedShelterID, model.meetingPointID)
    }

    func testShowZonesOnMapClosesThePanelAndReturnsToTheMap() {
        let model = AppModel()
        model.mapSelection = .epicenter
        model.mapPath = [.alert(DemoData.collapseID)]
        model.showZonesOnMap()
        XCTAssertEqual(model.selectedTab, .map)
        XCTAssertNil(model.mapSelection)
        XCTAssertTrue(model.mapPath.isEmpty)
        XCTAssertTrue(model.mapFilters.showsZones)
    }

    func testOnlyShelterSelectionsHaveAShelterID() {
        let model = AppModel()
        model.mapSelection = .zone("SF-1")
        XCTAssertNil(model.selectedShelterID)
        model.mapSelection = .shelter(DemoData.hamiltonID)
        XCTAssertEqual(model.selectedShelterID, DemoData.hamiltonID)
    }

    func testSimpleModeIsRememberedAcrossLaunches() {
        let defaults = UserDefaults.standard
        let saved = defaults.object(forKey: AppModel.simpleModeKey)
        defer { defaults.set(saved, forKey: AppModel.simpleModeKey) }

        AppModel().isSimpleMode = true
        XCTAssertTrue(AppModel().isSimpleMode)
        AppModel().isSimpleMode = false
        XCTAssertFalse(AppModel().isSimpleMode)
    }

    func testFollowToggles() {
        let model = AppModel()
        let alert = DemoData.palaceCollapse
        XCTAssertFalse(model.isFollowing(alert))
        model.toggleFollow(alert)
        XCTAssertTrue(model.isFollowing(alert))
        model.toggleFollow(alert)
        XCTAssertFalse(model.isFollowing(alert))
    }
}
