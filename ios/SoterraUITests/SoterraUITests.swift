import XCTest

/// UI checks for the 911 pill, the call confirmation, the map, Simple mode and the Area setting. They run on demo
/// data (`-SoterraLive NO`), and the large-text test keeps screenshots of the screens whose text wraps the most.
final class SoterraUITests: XCTestCase {
    private let launchTimeout: TimeInterval = 60

    override func setUp() {
        continueAfterFailure = false
    }

    // MARK: 911

    func testEmergencyPillIsTheSameOnEveryScreen() {
        let app = launch()
        let reference = visiblePill(in: app).frame
        assertPillFits(reference, in: app)

        for tab in ["Alerts", "Map", "Household", "More"] {
            app.tabBars.buttons[tab].tap()
            let frame = visiblePill(in: app).frame
            XCTAssertEqual(frame.width, reference.width, accuracy: 0.5, "911 pill width on \(tab)")
            XCTAssertEqual(frame.height, reference.height, accuracy: 0.5, "911 pill height on \(tab)")
            assertPillFits(frame, in: app)
        }

        app.tabBars.buttons["Alerts"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS 'Be ready to leave'")).firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Evacuation Warning"].waitForExistence(timeout: 30))
        let pushed = visiblePill(in: app).frame
        XCTAssertEqual(pushed.width, reference.width, accuracy: 0.5, "911 pill width on a pushed screen")
        XCTAssertEqual(pushed.height, reference.height, accuracy: 0.5, "911 pill height on a pushed screen")
        assertPillFits(pushed, in: app)
    }

    func testCalling911AsksToConfirmBeforeTheCallPrompt() {
        let app = launch()
        visiblePill(in: app).tap()
        let call = app.buttons["Call 911"]
        XCTAssertTrue(call.waitForExistence(timeout: 30))

        call.tap()
        let confirm = app.alerts["Call 911 now?"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 30))
        XCTAssertTrue(confirm.buttons["Call 911"].exists)
        confirm.buttons["Cancel"].tap()

        XCTAssertTrue(waitForDisappearance(of: confirm))
        XCTAssertTrue(call.exists, "Cancel leaves the danger sheet open")
    }

    // MARK: Top bar and settings

    func testAreaLivesInMoreInsteadOfTheTopBar() {
        let app = launch(["-SoterraTab", "more"])
        XCTAssertFalse(app.navigationBars.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Area'")).firstMatch.exists)
        XCTAssertTrue(app.navigationBars.images["Soterra"].waitForExistence(timeout: 30), "wordmark in the corner")

        let area = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Area'")).firstMatch
        XCTAssertTrue(area.waitForExistence(timeout: 30))
        area.tap()
        XCTAssertTrue(app.navigationBars["Area"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts["Sonoma County, CA"].exists)
    }

    // MARK: Map

    func testMapSearchFadesWhileMovingAndReturnsOnTap() {
        let app = launch(["-SoterraTab", "map"])
        let search = app.textFields["Search shelters"]
        XCTAssertTrue(search.waitForExistence(timeout: launchTimeout))

        let map = app.maps.firstMatch
        map.swipeDown()
        XCTAssertTrue(waitForDisappearance(of: search), "search fades while the map moves")
        XCTAssertTrue(visiblePill(in: app).exists, "911 stays while the search is hidden")

        // North of the zones, after moving the map down, is empty map.
        map.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3)).tap()
        XCTAssertTrue(search.waitForExistence(timeout: 30), "tapping empty map brings the search back")
    }

    func testTappingPlacesSlidesUpTheirPanel() {
        let app = launch(["-SoterraTab", "map"])
        let pin = app.buttons["Ridgeview Community Center"]
        XCTAssertTrue(pin.waitForExistence(timeout: launchTimeout))

        pin.tap()
        let directions = app.buttons["Directions"]
        XCTAssertTrue(directions.waitForExistence(timeout: 30))
        assertInsideWindow(directions, in: app)
        app.buttons["Close"].tap()
        XCTAssertTrue(waitForDisappearance(of: directions))

        app.buttons["Zone SON-3A"].tap()
        let seeAlert = app.buttons["See alert"]
        XCTAssertTrue(seeAlert.waitForExistence(timeout: 30))
        seeAlert.tap()
        XCTAssertTrue(app.navigationBars["Evacuation Warning"].waitForExistence(timeout: 30))
    }

    // MARK: Simple mode

    func testSimpleModeShowsTheEssentialsAndSwitchesBack() {
        let app = launch(simpleMode: true)
        let call = app.buttons["Call 911"]
        XCTAssertTrue(call.waitForExistence(timeout: launchTimeout))
        XCTAssertFalse(app.tabBars.firstMatch.exists, "Simple mode is one screen")
        XCTAssertGreaterThanOrEqual(call.frame.height, 76)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Call Soterra'")).firstMatch.exists)

        call.tap()
        let confirm = app.alerts["Call 911 now?"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 30))
        confirm.buttons["Cancel"].tap()
        XCTAssertTrue(waitForDisappearance(of: confirm))

        let switchBack = app.buttons["Switch to the full app"].firstMatch
        for _ in 0..<6 where !switchBack.isHittable { app.swipeUp() }
        // Tap by coordinate: the scroll view's "scroll to visible" action can fail on a button already in view.
        switchBack.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        // The confirmation dialog adds a second button with the same name.
        let confirmSwitch = app.buttons.matching(identifier: "Switch to the full app")
        XCTAssertTrue(confirmSwitch.element(boundBy: 1).waitForExistence(timeout: 30))
        confirmSwitch.element(boundBy: 1).tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 30))
    }

    // MARK: Large text

    /// The largest accessibility text size wraps the longest strings (source names, alert headlines, button labels).
    /// Checks that the controls stay on screen and keeps screenshots for review.
    func testLayoutAtTheLargestTextSize() {
        let app = launch(["-SoterraScreen", "alert"], textSize: "UICTContentSizeCategoryAccessibilityXXXL")
        let pill = visiblePill(in: app)
        assertPillFits(pill.frame, in: app)
        keepScreenshot(of: app, named: "Alert detail, top")

        let source = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sonoma County Emergency Management'")).firstMatch
        for _ in 0..<12 where !source.isHittable { app.swipeUp() }
        XCTAssertTrue(source.isHittable)
        assertInsideWindow(source, in: app)
        keepScreenshot(of: app, named: "Alert detail, source")

        app.terminate()
        let simple = launch(simpleMode: true, textSize: "UICTContentSizeCategoryAccessibilityXXXL")
        XCTAssertTrue(simple.buttons["Call 911"].waitForExistence(timeout: launchTimeout))
        assertInsideWindow(simple.buttons["Call 911"], in: simple)
        keepScreenshot(of: simple, named: "Simple mode")

        simple.terminate()
        let map = launch(["-SoterraScreen", "shelter"], textSize: "UICTContentSizeCategoryAccessibilityXXXL")
        let directions = map.buttons["Directions"]
        XCTAssertTrue(directions.waitForExistence(timeout: launchTimeout))
        keepScreenshot(of: map, named: "Map shelter panel")
    }

    // MARK: Helpers

    private func launch(_ arguments: [String] = [], simpleMode: Bool = false, textSize: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-SoterraLive", "NO", "-SoterraSimpleMode", simpleMode ? "YES" : "NO"] + arguments
        if let textSize { app.launchArguments += ["-UIPreferredContentSizeCategoryName", textSize] }
        app.launch()
        return app
    }

    /// The 911 pill on the screen in front (other tabs keep theirs in the hierarchy, off screen).
    private func visiblePill(in app: XCUIApplication) -> XCUIElement {
        let pills = app.buttons.matching(identifier: "Emergency, 911")
        XCTAssertTrue(pills.firstMatch.waitForExistence(timeout: launchTimeout))
        let deadline = Date.now.addingTimeInterval(10)
        repeat {
            if let pill = pills.allElementsBoundByIndex.first(where: \.isHittable) { return pill }
        } while Date.now < deadline
        XCTFail("No visible 911 pill")
        return pills.firstMatch
    }

    private func assertPillFits(_ frame: CGRect, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let window = app.windows.firstMatch.frame
        XCTAssertGreaterThanOrEqual(frame.height, 30, file: file, line: line)
        // The button's frame is its 44 pt tap area; the visible pill inside it is 34 pt.
        XCTAssertLessThanOrEqual(frame.height, 44.5, "pill fits the bar", file: file, line: line)
        XCTAssertGreaterThanOrEqual(frame.minX, window.minX, file: file, line: line)
        XCTAssertLessThanOrEqual(frame.maxX, window.maxX - 8, "pill keeps a margin from the screen edge", file: file, line: line)
        XCTAssertGreaterThan(frame.minY, 40, "pill sits below the status bar", file: file, line: line)
    }

    private func assertInsideWindow(_ element: XCUIElement, in app: XCUIApplication,
                                    file: StaticString = #filePath, line: UInt = #line) {
        let window = app.windows.firstMatch.frame
        XCTAssertGreaterThanOrEqual(element.frame.minX, window.minX, file: file, line: line)
        XCTAssertLessThanOrEqual(element.frame.maxX, window.maxX, file: file, line: line)
    }

    private func waitForDisappearance(of element: XCUIElement, timeout: TimeInterval = 30) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter.wait(for: [gone], timeout: timeout) == .completed
    }

    private func keepScreenshot(of app: XCUIApplication, named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
