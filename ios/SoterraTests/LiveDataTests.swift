import XCTest
@testable import Soterra

final class LiveDataTests: XCTestCase {
    private let json = """
    {"contractVersion":"1","now":1792000000000,"mode":"crisis","crisisReason":"Evacuation Warning",
     "alerts":[
      {"id":"a1","sourceName":"Sonoma County Emergency Management (Demo)","url":"https://example.org/a1",
       "title":"Evacuation Warning","body":"Be ready to leave. Zones SON-3A and SON-3B.","hazardType":"evacuation",
       "severity":"severe","issuedAt":1791999000000,"updatedAt":1791999900000,"version":2,
       "areaLabels":["Zone SON-3A","Zone SON-3B"],"isFixture":true},
      {"id":"a2","sourceName":"Caltrans District 4 (Demo)","url":"https://example.org/a2",
       "title":"Road closure","body":"Ridgeview Road is closed.","hazardType":"road_closure",
       "severity":"moderate","issuedAt":1791998000000,"version":1,"areaLabels":[],"isFixture":true}
     ]}
    """

    private func state() throws -> AppStateResponse { try BackendClient.decode(Data(json.utf8)) }

    func testDecodesBackendFeed() throws {
        let s = try state()
        XCTAssertTrue(s.isCrisis)
        XCTAssertEqual(s.alerts.count, 2)
        XCTAssertNil(s.alerts[1].updatedAt)
    }

    func testRejectsOtherContractMajor() {
        let data = Data(json.replacingOccurrences(of: "\"contractVersion\":\"1\"", with: "\"contractVersion\":\"2\"").utf8)
        XCTAssertThrowsError(try BackendClient.decode(data)) {
            XCTAssertEqual($0 as? BackendError, .incompatibleContract("2"))
        }
    }

    func testMapsBulletinsToAlerts() throws {
        let alerts = LiveAlerts.alerts(from: try state())
        XCTAssertEqual(alerts[0].kind, .warning)
        XCTAssertEqual(alerts[0].hazard, .evacuation)
        XCTAssertEqual(alerts[0].severity, .severe)
        XCTAssertEqual(alerts[0].area, "Zone SON-3A, Zone SON-3B")
        XCTAssertEqual(alerts[0].instruction, "Be ready to leave")
        XCTAssertNotNil(alerts[0].changeNote)
        XCTAssertEqual(alerts[1].kind, .closure)
        XCTAssertEqual(alerts[1].hazard, .roadClosure)
        XCTAssertEqual(alerts[1].area, "Area not listed")
        XCTAssertNil(alerts[1].changeNote)
    }

    func testTimelineIsNewestFirst() throws {
        let items = LiveAlerts.timeline(from: try state())
        XCTAssertEqual(items.map(\.alertID), ["a1", "a2"])
    }

    // MARK: AppModel

    private struct Stub: AppStateFetching {
        var result: Result<AppStateResponse, Error>
        func fetchAppState() async throws -> AppStateResponse { try result.get() }
    }

    func testRefreshSwitchesToLiveData() async throws {
        let model = AppModel()
        model.useLiveData = true
        model.client = Stub(result: .success(try state()))
        await model.refresh()
        XCTAssertTrue(model.isShowingLive)
        XCTAssertEqual(model.alerts.map(\.id), ["a1", "a2"])
        XCTAssertEqual(model.alert(id: "a2")?.title, "Road closure")
    }

    func testFailedRefreshKeepsDemoData() async {
        let model = AppModel()
        model.useLiveData = true
        model.client = Stub(result: .failure(URLError(.notConnectedToInternet)))
        await model.refresh()
        XCTAssertFalse(model.isShowingLive)
        XCTAssertEqual(model.alerts, DemoData.alerts(for: model.scenario))
        XCTAssertNotNil(model.toast)
    }

    func testFailedRefreshKeepsLastLiveData() async throws {
        let model = AppModel()
        model.useLiveData = true
        model.client = Stub(result: .success(try state()))
        await model.refresh()
        model.client = Stub(result: .failure(URLError(.timedOut)))
        await model.refresh()
        XCTAssertTrue(model.isShowingLive)
    }

    func testLiveOffUsesDemo() async throws {
        let model = AppModel()
        model.useLiveData = false
        model.client = Stub(result: .success(try state()))
        await model.refresh()
        XCTAssertFalse(model.isShowingLive)
    }
}
