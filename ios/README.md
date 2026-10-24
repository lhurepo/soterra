# Soterra iOS app (demo build)

SwiftUI app built from the Tide Table mockups (`docs/mockups/`, Figma "Soterra iOS – Tide Table"), the spec
(`docs/MOBILE_APP_SPEC.md`) and the product record (`PRODUCT.md`). It runs on fictional Ridgeview Fire data from
`fixtures/normalized/` and does **not** connect to the Convex backend yet. Light mode is the default.

## Run it on an iPhone

Requires Xcode 15.2 or newer and iOS 17 or newer on the phone. An iPhone on iOS 18 or later needs Xcode 16+
(macOS Sonoma 14.5+).

1. Open `ios/Soterra.xcodeproj` in Xcode.
2. Select the **Soterra** target → **Signing & Capabilities** → choose your **Team** (a free Apple ID works).
   If Xcode says the bundle identifier is taken, change `com.lhurepo.soterra` to something unique.
3. Plug in the iPhone, pick it as the run destination, press **Run** (⌘R).
4. First time only, on the phone: enable **Settings → Privacy & Security → Developer Mode**, and trust the
   developer under **Settings → General → VPN & Device Management**.

Simulator: pick any iPhone simulator and press Run. Tests: **Product → Test** (⌘U), or
`xcodebuild -project ios/Soterra.xcodeproj -scheme Soterra -destination 'platform=iOS Simulator,name=iPhone 15' test`.

## What to try

- **More → Demo controls:** switch Home between *Warning*, *Order* (just escalated, lit red edge) and
  *No alerts*, and turn **Offline** on.
- **More → Appearance:** Light (default), Dark or Match system.
- **911 pill** (every screen): opens the danger sheet. **Demo safety:** "Call 911" opens the dialer with
  **119**, not 911 (`DemoConfig.emergencyDialNumber`). iOS asks before calling. 119 is an emergency number in
  some countries, such as Japan and South Korea.
- **Call Soterra** really dials the live hotline, +1 804 606 6867.
- **Ask Soterra:** try "What's going on with the Ridgeview Fire?", "Where are the shelters?",
  "Is Hillcrest Elementary open as a shelter?" (I don't know yet), then "Call me when you know", or
  "I'm trapped" (danger sheet).

Debug builds also accept launch arguments (Edit Scheme → Run → Arguments), for screenshots:
`-SoterraTab map|alerts|household|more`, `-SoterraScenario crisis|escalated|calm`,
`-SoterraAppearance light|dark|system`, `-SoterraOffline YES`, `-SoterraScreen alert|assistant|danger|shelter`.

## Layout

| Folder | What |
| --- | --- |
| `Soterra/App` | App entry, `AppModel` (all state, `@Observable`), tabs and navigation |
| `Soterra/DesignSystem` | Palette (brand teal + light/dark tones), severity tints (high red, medium orange, low yellow), Outfit display font, shared components |
| `Soterra/Features` | Home, Alerts and Alert detail, Ask Soterra, Map, Household, More, the danger sheet |
| `Soterra/Model` | Value types mirroring the backend data, demo data, the demo assistant, `DemoConfig` |
| `Soterra/Resources` | Asset catalog (placeholder app icon from the current logo), Outfit SemiBold (SIL OFL) |
| `SoterraTests` | Unit tests for the assistant rules and app state |

Rules the UI keeps (from `PRODUCT.md`): 911 one tap away on every screen and never "help is on the way";
every fact shows its source and time; "I don't know yet" is a normal answer; no address-in-zone guessing;
severity is always color + label + icon.
