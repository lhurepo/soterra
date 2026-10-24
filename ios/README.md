# Soterra iOS app (demo build)

SwiftUI app built from the Tide Table mockups (`docs/mockups/`, Figma "Soterra iOS – Tide Table"), the spec
(`docs/MOBILE_APP_SPEC.md`) and the product record (`PRODUCT.md`). It loads alerts and crisis mode from the Convex backend (`GET /app/state`, `convex/app.ts`) and falls back to
fictional Ridgeview Fire demo data when the backend is unreachable or **More → Demo controls → Use live backend
data** is off (launch argument `-SoterraLive NO`). Shelters, household and the typed assistant are still demo-only. Light mode is the default.

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
- **Profile sign-in** (backend ready, screen not built): ask for the phone number, call `accounts:requestPhoneCode` (Soterra phones it and reads a 6-digit code), let the user type the code into `accounts:verifyPhoneCode`, keep the returned token in the Keychain, and pass it to `accounts:getMyProfile` / `accounts:saveMyProfile`. To get verified access on a call, the app can also call `accounts:requestVerifiedCall` with the token ("Call me"): Soterra rings the number, and that call is verified (the user can then say "what do you know about me", "forget me"). For **Call Soterra**, call `accounts:armAppCall` with the token just before opening the `tel:` link: the next call from that number within two minutes is verified (once). A call the user makes without that, even from a linked number, is not verified; update callbacks from Soterra are. See docs/backend.md ("App sign-in and profile"). There is no way to read or save a profile with only a phone number.
- **Call Soterra** really dials the live hotline, +1 712 600 3362.
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
