import XCTest

/// UI checks for the alerts bell, the map, Simple mode and the Area setting. They run on demo
/// data (`-SoterraLive NO`), and the large-text test keeps screenshots of the screens whose text wraps the most.
final class SoterraUITests: XCTestCase {
    private let launchTimeout: TimeInterval = 60

    override func setUp() {
        continueAfterFailure = false
    }

    // MARK: Alerts bell

    func testAlertsBellIsTheSameOnEveryScreen() {
        let app = launch()
        let reference = visibleBell(in: app).frame
        assertBellFits(reference, in: app)

        for tab in ["Chat", "Map", "Household", "More"] {
            app.tabBars.buttons[tab].tap()
            let frame = visibleBell(in: app).frame
            XCTAssertEqual(frame.width, reference.width, accuracy: 0.5, "bell width on \(tab)")
            XCTAssertEqual(frame.height, reference.height, accuracy: 0.5, "bell height on \(tab)")
            assertBellFits(frame, in: app)
        }
        XCTAssertFalse(app.tabBars.buttons["Alerts"].exists, "Alerts is no longer a tab")
    }

    func testBellOpensTheAlertsList() {
        let app = launch()
        visibleBell(in: app).tap()
        XCTAssertTrue(app.navigationBars["Alerts"].waitForExistence(timeout: 30))
        app.buttons.matching(NSPredicate(format: "label CONTAINS 'Be ready to leave'")).firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Evacuation Warning"].waitForExistence(timeout: 30))
    }

    func testTheAppHasNoWayToDial911() {
        let app = launch()
        XCTAssertFalse(app.buttons["Call 911"].exists)
        app.terminate()
        let simple = launch(simpleMode: true)
        XCTAssertTrue(simple.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Call Soterra'")).firstMatch
            .waitForExistence(timeout: launchTimeout))
        XCTAssertFalse(simple.buttons["Call 911"].exists)
    }

    func testHomeKeepsOnlyTheCallSoterraCard() {
        let app = launch()
        let calls = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Call Soterra'"))
        XCTAssertTrue(calls.firstMatch.waitForExistence(timeout: launchTimeout))
        XCTAssertEqual(calls.count, 1, "no fixed Call Soterra bar above the tabs")
        XCTAssertFalse(app.buttons["Ask Soterra"].exists)
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
        XCTAssertTrue(visibleBell(in: app).exists, "the bell stays while the search is hidden")

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
        XCTAssertTrue(waitForDisappearance(of: app.tabBars.firstMatch), "the tab bar fades out while the panel is open")
        XCTAssertGreaterThanOrEqual(app.buttons["Close"].frame.minY, app.windows.firstMatch.frame.height * 0.45,
                                    "the panel fills the bottom half")
        app.buttons["Close"].tap()
        XCTAssertTrue(waitForDisappearance(of: directions))
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 30), "the tab bar returns")

        app.buttons["Zone SON-3A"].tap()
        let seeAlert = app.buttons["See alert"]
        XCTAssertTrue(seeAlert.waitForExistence(timeout: 30))
        seeAlert.tap()
        XCTAssertTrue(app.navigationBars["Evacuation Warning"].waitForExistence(timeout: 30))
    }

    // MARK: Simple mode

    func testSimpleModeShowsTheEssentialsAndSwitchesBack() {
        let app = launch(simpleMode: true)
        let call = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Call Soterra'")).firstMatch
        XCTAssertTrue(call.waitForExistence(timeout: launchTimeout))
        XCTAssertFalse(app.tabBars.firstMatch.exists, "Simple mode is one screen")
        XCTAssertGreaterThanOrEqual(call.frame.height, 76)

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
        let bell = visibleBell(in: app)
        assertBellFits(bell.frame, in: app)
        keepScreenshot(of: app, named: "Alert detail, top")

        let source = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sonoma County Emergency Management'")).firstMatch
        for _ in 0..<12 where !source.isHittable { app.swipeUp() }
        XCTAssertTrue(source.isHittable)
        assertInsideWindow(source, in: app)
        keepScreenshot(of: app, named: "Alert detail, source")

        app.terminate()
        let simple = launch(simpleMode: true, textSize: "UICTContentSizeCategoryAccessibilityXXXL")
        let simpleCall = simple.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Call Soterra'")).firstMatch
        XCTAssertTrue(simpleCall.waitForExistence(timeout: launchTimeout))
        assertInsideWindow(simpleCall, in: simple)
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

    /// The alerts bell on the screen in front (other tabs keep theirs in the hierarchy, off screen).
    private func visibleBell(in app: XCUIApplication) -> XCUIElement {
        let bells = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Alerts, '"))
        XCTAssertTrue(bells.firstMatch.waitForExistence(timeout: launchTimeout))
        let deadline = Date.now.addingTimeInterval(10)
        repeat {
            if let bell = bells.allElementsBoundByIndex.first(where: \.isHittable) { return bell }
        } while Date.now < deadline
        XCTFail("No visible alerts bell")
        return bells.firstMatch
    }

    private func assertBellFits(_ frame: CGRect, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let window = app.windows.firstMatch.frame
        XCTAssertGreaterThanOrEqual(frame.height, 30, file: file, line: line)
        XCTAssertLessThanOrEqual(frame.height, 44.5, "bell fits the bar", file: file, line: line)
        XCTAssertGreaterThanOrEqual(frame.minX, window.minX, file: file, line: line)
        XCTAssertLessThanOrEqual(frame.maxX, window.maxX - 8, "bell keeps a margin from the screen edge", file: file, line: line)
        XCTAssertGreaterThan(frame.minY, 40, "bell sits below the status bar", file: file, line: line)
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
