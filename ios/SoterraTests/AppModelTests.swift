import XCTest
@testable import Soterra

final class AppModelTests: XCTestCase {
    func testLightModeIsTheDefault() {
        XCTAssertEqual(AppModel().appearance, .light)
    }

    func testEmergencyButtonNeverDials911InTheDemoBuild() {
        XCTAssertEqual(DemoConfig.emergencyCallURL.absoluteString, "tel:119")
        XCTAssertFalse(DemoConfig.emergencyCallURL.absoluteString.contains("911"))
        XCTAssertEqual(DemoConfig.hotlineURL.absoluteString, "tel:+17126003362")
    }

    func testSeverityLevels() {
        XCTAssertEqual(Severity.extreme.level, .high)
        XCTAssertEqual(Severity.severe.level, .medium)
        XCTAssertEqual(Severity.moderate.level, .low)
        XCTAssertEqual(Severity.minor.level, .low)
    }

    func testScenariosDriveTheTopAlert() {
        let model = AppModel()
        XCTAssertEqual(model.topAlert?.id, DemoData.warningID)
        model.scenario = .escalated
        XCTAssertEqual(model.topAlert?.id, DemoData.orderID)
        XCTAssertNotNil(model.topAlert?.changeNote)
        model.scenario = .calm
        XCTAssertNil(model.topAlert)
        XCTAssertEqual(model.homeTitle, "Home")
    }

    func testOfflineReplacesNowWithTheSavedTime() {
        let model = AppModel()
        model.isOffline = true
        let times = model.displayTimes(for: DemoData.evacuationWarning)
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

    func testForgetMeClearsNeedsAndStopsUpdates() {
        let model = AppModel()
        model.forgetMe()
        XCTAssertTrue(model.savedNeeds.isEmpty)
        XCTAssertTrue(model.followedAlertIDs.isEmpty)
        XCTAssertFalse(model.followedTopics.contains(where: \.isActive))
        XCTAssertNotNil(model.toast)
    }

    func testShowSheltersOpensTheMapOnTheMeetingPoint() {
        let model = AppModel()
        model.showShelters()
        XCTAssertEqual(model.selectedTab, .map)
        XCTAssertEqual(model.selectedShelterID, model.meetingPointID)
    }

    func testFollowToggles() {
        let model = AppModel()
        let alert = DemoData.fireUpdate
        XCTAssertFalse(model.isFollowing(alert))
        model.toggleFollow(alert)
        XCTAssertTrue(model.isFollowing(alert))
        model.toggleFollow(alert)
        XCTAssertFalse(model.isFollowing(alert))
    }
}
