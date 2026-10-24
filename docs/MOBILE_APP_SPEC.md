# Soterra mobile app: feature and screen spec for mockups

This brief is for a wireframe or mockup tool, such as Claude with the Figma plugin. It lists every screen, button,
state and flow the Soterra iOS app needs, with real sample content. Design every screen listed here. Show
every state named under **States**.

Sources: `docs/SYSTEM_OVERVIEW.md` (feature inventory), `TEAM_PLAN.md` (rules and status), and
`convex/schema.ts`, `src/config/strings.ts` and `fixtures/normalized/` (real data fields, wording and sample
content). Updated 2026-10-24.

---

## 1. What Soterra is

Soterra is an emergency information service for disasters such as wildfires, floods and hurricanes. People
ask questions, and Soterra answers **only from official, timestamped bulletins**. Every answer names its source
and time. When Soterra does not know something, it says "I don't know yet" and saves the question. It also
calls people back when the news changes.

There are four ways in. All of them use one shared backend (Convex):

1. **Phone hotline.** This is the main product: anyone can call **+1 804 606 6867** from any phone and talk to a
   voice AI, with no app needed. It is already live.
2. **Mobile app (iOS).** This is what we are designing. It adds visual alerts, a map, household check-ins and
   call history on top of the hotline.
3. Web companion. It uses the same features in a browser and copies the mobile look.
4. Responder console. Officials use it to publish bulletins and answer saved questions. It is out of scope
   here; see Appendix B for what the app must reflect from it.

**Who uses the app:** residents in or near a disaster area, possibly stressed, outdoors, on a weak connection,
with a low battery, one-handed, or older or less tech-comfortable. They may speak Spanish. Design for
seconds-long glances, not exploration.

---

## 2. Rules the design must follow

These rules are enforced in the product, and the UI must never contradict them.

1. **Danger first.** A **911 / emergency** action is reachable from every screen in one tap. Any "I'm in
   danger" path shows "If you are in immediate danger, call 911 now" before anything else. **Soterra never
   sends help**, and the UI must never imply it does: no "Help is on the way" or "SOS sent".
2. **Grounded or silent.** Every piece of disaster information shows its **source name and time**, for
   example "Sonoma County Emergency Management (Demo) · updated Oct 24, 2:10 PM". There is no unsourced
   disaster text anywhere.
3. **"I don't know yet" is a first-class state.** It is not an error. It appears as a calm card: "I don't know
   yet — I've saved your question. We'll update you when officials answer."
4. **No address guessing.** The app never says "your address is (not) in the zone". It lists the official
   zones and links to the official zone lookup. The zone check is available only against official map shapes.
5. **Freshness is visible.** Show how old information is ("Updated 12 min ago"). When information is old, show
   "Needs reconfirming", for example a shelter capacity checked more than a few hours ago.
6. **Untrusted is labeled.** Official bulletins carry an **Official source** badge. Official social posts
   carry a lighter "Official social media" badge. Unverified content is never shown as information.
7. **Privacy by default.** There is no tracking. Location is used only with explicit consent, and a manually
   chosen area is the default. Call transcripts are kept only if the user allows it. "Delete my data" is
   always available.
8. **The app is optional.** Everything important is also reachable by calling the hotline. "Call Soterra" is
   always one tap away.
9. **Footer disclaimer:** "Soterra shares official information. It does not replace emergency services."

---

## 3. Design constraints

- **Platform:** iOS, iPhone first (390×844 frames). Large-title navigation and SF Symbols-style icons.
- **Touch targets:** 44×44 pt or larger. Body text 17 pt. Support **Larger text**, which makes everything 25%
  bigger; show one screen at large text.
- **Themes:** light (the default and main use), dark and system. Severity colors must stay distinguishable in
  both themes and must not rely on color alone. Always pair color with a label and an icon.
- **Severity scale** (from the data), three visible levels: **High** = Extreme (red), **Medium** = Severe
  (orange), **Low** = Moderate and Minor (yellow); **Unknown** is grey. Alert cards are tinted with their
  level's color in both themes (a light tint in light mode, a dark tint in dark mode), never an inverted card. Alert-type labels: Warning, Advisory, Watch, Order (an Evacuation
  Order is stronger than a Warning).
- **Hazard types** (icons needed): wildfire, flood, hurricane, tornado, earthquake, tsunami, winter storm,
  extreme heat, evacuation, shelter, road closure, other.
- **Languages:** English and Spanish now. French, Mandarin and Punjabi are planned. Spanish text runs about
  30% longer, so leave room for it.
- **Reduce animations** setting: no pulsing markers or animated transitions.
- **Offline:** show the last synced data with an "Offline — showing info from 2:14 PM" bar. The Call button
  still works offline, because it uses the phone dialer.
- **Tone:** calm, plain and short. Use no exclamation marks, no gamification and no playful empty states.

---

## 4. Navigation map

Bottom tab bar with five tabs: **Home · Alerts · Map · Household · More**

A persistent **Emergency / 911** pill sits in the top-right of every screen's navigation bar.

On screens with an active in-app assistant session, a **mini call bar** sits above the tab bar: "Soterra ·
02:14 · Checking…", with Return and End.

```
Onboarding (first launch)
  Welcome → Language → Your area → Notifications permission → Transcript consent → (optional) Link your phone → Home

Home
  ├─ Top alert card → Alert detail
  ├─ Hotline card → native dialer (+1 804 606 6867)
  ├─ Ask Soterra → Assistant (in-app)
  ├─ Your next step → Map / Household
  ├─ Following list → Following feed (per topic)
  └─ Recent calls → Call detail

Alerts
  ├─ Tabs: Following | All
  ├─ Alert card → Alert detail
  │     ├─ Ask about this alert → Assistant (scoped)
  │     ├─ Follow updates → Follow sheet
  │     └─ Source card → official page (in-app browser)
  └─ My questions (information requests) → Question detail

Map
  ├─ Search + filter chips
  ├─ Map / Offline diagram / List toggle
  ├─ Place pin → Place detail → Preview walk / Save / Compare shelters
  └─ Zone check (only official shapes)

Household
  ├─ Summary + Shared meeting point
  ├─ Member row → Member detail / Change status
  ├─ Add member
  └─ Message preview

More
  ├─ Activity centre (notifications inbox)
  ├─ Call history → Call detail
  ├─ Updates I'm following (subscriptions manager)
  ├─ Preparedness checklist
  ├─ Settings (Language, Display, Voice, Privacy, Hotline, Account & phone link)
  └─ About / Privacy notice

Global overlays: Danger sheet (911), Crisis-mode banner, Offline bar, Toast banners, Confirm dialogs
```

---

## 5. Global components

| Component | Contents | Notes |
| --- | --- | --- |
| **Emergency pill** (nav bar, every screen) | Red "911" pill with a phone icon | Opens the Danger sheet; never hidden |
| **Danger sheet** | Title "If you are in immediate danger, call 911 now." Big **Call 911** button. Text: "Soterra can't send help or contact emergency services for you." Secondary: "I'm safe — get information" | Shown from the pill, and automatically when the assistant detects danger |
| **Crisis-mode banner** | "Active emergency in your area: Ridgeview Fire" + severity chip + "View" | Shown when the backend is in crisis mode (`systemState.mode = crisis`). Sticky at the top of Home and Alerts |
| **Source line** | Issuer name · verb (issued/updated/checked/as of) · time · Official badge; when another independent source reports the same incident, a second line "Also reported by CAL FIRE"; when they disagree, "Sources differ on the figures" | Reused under every piece of disaster info |
| **Freshness chip** | "Updated 12 min ago" / "Checked 3 h ago — needs reconfirming" (amber) | Three time bases: *issued*, *page updated*, *observed/checked* |
| **Severity chip** | Icon + label (Extreme / Severe / Moderate / Minor) | Color and text together |
| **Alert card** | Hazard icon, title, area, two-line summary, severity chip, freshness, "New" dot if unread | Tap → Alert detail |
| **Mini call bar** | Soterra avatar, timer, status (Ready / Listening / Checking / Speaking), Return, End | Persists while the assistant is minimized |
| **Offline bar** | "Offline — showing info from 2:14 PM" + Retry | Top of screen |
| **Toast banner** | "Now following Ridgeview Fire evacuations" + Undo | Auto-dismiss |
| **Trust footer** | "Soterra shares official information. It does not replace emergency services." | Bottom of Home, Alert detail, About |
| **Demo data label** | Small "Demo" tag on fictional fixture content | Bulletins whose source name ends "(Demo)" |

---

## 6. Screens

For each screen: **Purpose · Elements and buttons · Data · States**.

### 6.1 Onboarding (first launch, 5 or 6 steps, skippable after the language step)

1. **Welcome.** Logo, one line ("Official disaster information, in plain words, with sources."), then
   **Get started** and **Call the hotline instead**. Trust footer.
2. **Language.** Large list: English, Español, with "More coming soon" greyed. It sets the language for app text
   and for calls.
3. **Your area.** Search field "City, county or ZIP". Optional **Use my location** button, with a consent
   explanation first: "Only used to pick your area. Never shared." Result: "Sonoma County, CA". Buttons:
   **Continue** and **Skip**.
4. **Notifications.** Explains the value ("Get told when an alert you follow changes"), then **Allow** and
   **Not now**. Show the system permission prompt as a follow-on frame.
5. **Call transcripts.** Switch: "Save transcripts of my calls (otherwise only a short summary)". Short privacy
   note and **Continue**.
6. **Link your phone (optional).** "Link the phone you call from so your calls and updates show up here." Phone
   field, then **Send code**, a 6-digit code entry, and **Verify**. States: sending, wrong code, verified ✓.
   Copy: "Calling from this number without linking only remembers your language and area."

### 6.2 Home

- **Purpose:** in one glance, what is happening near me, what to do next, and how to reach Soterra.
- **Elements, top to bottom:**
  - Location line: "Sonoma County, CA ▾". Tap to change the area.
  - Crisis-mode banner, if active.
  - **Top alert card**, large: hazard icon, "Evacuation Warning for the Ridgeview Fire", severity
    *Severe*, "Zones SON-3A and SON-3B, east of Santa Rosa", freshness, source line. Buttons: **View
    details**, **Ask Soterra**.
  - **Hotline card:** "Talk to Soterra by phone — +1 804 606 6867", with **Call** (opens the dialer) and a
    note "English · Español · 24/7".
  - **Ask Soterra** button, which starts or returns to the in-app assistant (it reads "Return to Soterra"
    while a session is active).
  - **Your next step:** two tiles, "Find a shelter" (→ Map, shelters filter) and "Check in with your household"
    (→ Household).
  - **Following:** a list of followed topics with the last-checked time and a "2 new" badge. Each row →
    Following feed. Link "Manage".
  - **Recent calls:** the two latest (topic, date, length, language) → Call detail. Link "See all".
  - Trust footer.
- **States:** normal; **crisis** (banner + red top card); **calm/no alerts** ("No active official alerts for
  Sonoma County. Last checked 2:14 PM." + Call card still shown); offline; loading skeleton; area not set
  (prompt card "Choose your area to see alerts").

### 6.3 Alerts

- **Segmented control:** **Following | All**.
- **List:** alert cards sorted by severity, then by recency. Filter chips: hazard type, and severity of
  Moderate and above.
- **Section "My questions"** (information requests): questions Soterra could not answer, with status chips
  **Waiting for officials** / **Answered** / **Closed**. Tap → Question detail.
- **States:** empty Following ("You're not following anything yet. Open an alert and tap Follow."); empty All
  (calm state); a cancelled alert (struck through, "Cancelled by issuer · 3:05 PM"); a test or exercise
  bulletin (it never appears for residents, so there is nothing to design).

### 6.4 Alert detail

- **Header:** hazard icon, title, severity chip, **Official source** badge, freshness.
- **What we know:** the official bulletin text, with "Read full notice" expanding it.
- **What officials advise:** recommended actions as a list, always ending "If you are in immediate danger,
  call 911."
- **Affected areas:** zone names (SON-3A, SON-3B) and the area list. A note reads "Soterra can't confirm
  whether a specific address is in a zone." Button: **Check official zone lookup** (external), plus **Show on
  map**.
- **Updates timeline:** versions newest first, e.g. "v2 · 4:40 PM · Evacuation Order for zone SON-3A" and
  "v1 · 2:10 PM · Evacuation Warning". Show a changed-field highlight ("Warning → Order").
- **Source card:** issuer, issued time, updated time, expires time, and **Open official page**.
- **Primary actions (sticky bottom):** **Follow updates** (→ Follow sheet) and **Ask about this alert** (→
  Assistant, scoped to this alert).
- **States:** followed (the button shows "Following ✓" with an Unfollow option); expired ("Expired at …" and
  greyed); updated since last viewed (a "New update" pill on the timeline).

### 6.5 Follow sheet (bottom sheet)

- **Title:** "Get updates about Ridgeview Fire"
- **What to follow** (radio): **Any update** · **Evacuation changes** · **Severity changes**. Question
  subscriptions use **When my question is answered**. These match the backend triggers `any_update`,
  `evacuation_change`, `severity_change` and `answer_available`.
- **How** (checkboxes): **App notification** · **Phone call to +1 (707) ••• ••23**. Show **Text message**
  greyed with "coming soon".
- **Duration note:** "Updates last 24 hours. You can stop any time — in the app or by saying 'stop updates'
  on a call."
- **Rate-limit note** (small): "At most one call every 15 minutes."
- Buttons: **Follow** and **Cancel**.

### 6.6 Following feed (one followed topic)

- The topic's updates, newest first (alert cards and update cards).
- Opening it marks everything as read and clears the badge.
- Header actions: **View alert** and **Unfollow**. Unfollow asks for confirmation: "Stop updates about
  Ridgeview Fire evacuations? You won't get calls or notifications."
- Subscription status line: "Active · expires tomorrow 2:15 PM · last notified 4:41 PM".

### 6.7 Assistant (in-app "call", text and voice)

- **Purpose:** the same brain as the phone line, for typing or talking inside the app.
- **Header:** "Soterra" + language chip (EN/ES) + timer + status line (**Ready · Listening · Checking ·
  Speaking**) + **Minimize** (→ mini call bar) + **End**.
- **First message** (from the backend): "This is Soterra, the disaster information line. If you are in
  immediate danger, hang up and dial 911. … What would you like to know?". Include the transcript consent line
  with an inline **Summary only** chip.
- **Message types to design:**
  1. User bubble.
  2. **Answer** bubble with a **source footnote** ("That's from Sonoma County Fire Information (Demo),
     updated October 24 at 2:10 PM Pacific.") and a tappable source chip → Alert detail.
  3. **"I don't know yet"** card: "I don't have verified official information about that, so I've saved your
     question." + **Get notified when answered** button.
  4. **Danger** card, red and full width: "If you are in immediate danger, call 911 now. I can't send help or
     contact emergency services for you." + **Call 911** button. It always appears first, before any other
     content.
  5. **Clarify** prompt: "What city, county or ZIP code are you asking about?" + area chips.
  6. **Follow-up confirmation:** "Okay. I'll call this number if there are official updates about evacuations
     for this incident, for the next 24 hours." + **Manage**.
  7. **Live update card**, which appears mid-conversation when a followed alert changes.
  8. **Degraded/fallback:** "Sorry, I can't find that answer right now. If you are in immediate danger, dial
     911." + **Try again**.
  9. **Returning-user offer:** "Welcome back. If you'd like, we can pick up where we left off." + **Continue**
     / **Start fresh**.
- **Composer:** text field, mic button (hold to talk), send. Above the composer, **suggested question chips**
  that change with the topic: "Is my zone under evacuation?", "Where are shelters that take pets?", "Which
  roads are closed?", "Call me if this changes".
- **Controls:** **Read answers aloud** toggle, language switch (EN ↔ ES), **Call the hotline instead**.
- **End call → Summary sheet:** a 2–3 sentence summary, topics, saved questions, follow-ups created, "Transcript
  saved / Summary only", then **Done** and **View in history**.
- **States:** ready/empty; checking (typing indicator + "Checking the latest official updates…", which appears
  after 1.2 s); speaking (waveform); offline ("You're offline. Call +1 804 606 6867 — calls work without
  data." + Call button); minimized (mini call bar).

### 6.8 Question detail (my saved question)

- The question text, asked-on date and language, and status (**Waiting for officials** / **Answered** /
  **Closed**).
- When answered: an answer card with a source line ("Hillcrest Elementary opened as a shelter at 5 PM. That's
  from Sonoma County Emergency Management (Demo), 5:05 PM.") and **Open source**.
- Toggle: **Notify me when answered**.

### 6.9 Map

- **Top:** search field ("Search places, areas, services") and filter chips: **Shelters · Water · Charging ·
  Meeting points · Closures**. A second row adds **Step-free · Pet-friendly · Saved only**, plus **Show all**.
- **View toggle:** **Street map** (OpenStreetMap, loads only when chosen) · **Offline diagram**
  (a simplified drawing that works with no internet: places, affected area shaded, creek, closed bridge, routes)
  · **List** (the accessible list grouped by type).
- **Overlays:** official evacuation zones as shaded polygons with labels (SON-3A Order in red, SON-3B Warning in
  orange), road-closure lines, place pins by type, and the user's chosen point (never live GPS without
  consent).
- **Zone check:** drop a pin → "This point is inside official zone SON-3A (Evacuation Order) — per Sonoma County
  Emergency Management, 4:40 PM." If no official shape exists, show "Official zone shapes aren't available for
  this alert. Use the official zone lookup." with a link.
- **States:** tiles failed (falls back to the offline diagram with a notice); no results; offline (diagram only).

### 6.10 Place detail (bottom sheet expanding to full screen)

- Name, type icon, address and distance/walk time ("Ridgeview Community Center · 500 Elm Street · 12 min walk").
- Status: **Open** / **Full** / **Closed**. A **capacity bar** ("~120 of 200 spaces").
- Attributes: **Step-free**, **Pets in crates OK**, hours, services (water, charging, food, medical).
- Freshness: "Availability checked 2:30 PM by county staff". If old: "Needs reconfirming" in amber.
- Source line.
- Buttons: **Preview walk**, **Save place**, **Set as household meeting point**, **Call the hotline to
  confirm**.

### 6.11 Compare shelters

- Inputs: party size (stepper), needs (Step-free, Pets), max walk time.
- A ranked list of shelters with columns for space, step-free, pets, walk time and freshness, plus the reason
  for the rank ("Most space · checked 20 min ago").
- Tap → Place detail.

### 6.12 Preview walk

- A step-by-step walking route that avoids closures, with a step-free route option.
- List of steps plus a route line on the map. A note: "Routes avoid official closures known at 4:40 PM. Follow
  instructions from officials on scene."
- Buttons: **Start in Apple Maps** and **Close**.

### 6.13 Household

- **Summary card:** "1 of 4 at the meeting point · 2 awaiting check-in".
- **Shared meeting point card:** place name, walk time, **Open on map**, **Change**.
- **Filter:** All | **Awaiting check-in only**.
- **Member rows:** avatar, name, role (Parent, Child, Grandparent, Neighbour), status chip, last update time,
  and a ⚠ "Last check-in 45 min ago" warning when older than 30 minutes.
- **Statuses:** Reviewing the plan · Checking in · On my way · At the meeting point · Awaiting check-in.
- **My status** button at the top: one tap to set your own status (big buttons).
- **Add member** button (name, role, phone optional, meeting point). Edit and remove happen on the member detail
  screen, and remove asks for confirmation.
- **Message preview:** a pre-written text ("I'm on my way to Ridgeview Community Center. — sent via Soterra")
  with **Copy** and **Share**. SMS sending is not built yet, so there is no Send button.
- **States:** no household yet ("Make a plan with the people you live with" + **Create household**);
  everyone safe (calm green summary); someone stale (amber).

### 6.14 More

A list of: Activity centre · Call history · Updates I'm following · Preparedness checklist · Settings · About &
privacy · **Call the hotline**.

### 6.15 Activity centre (inbox)

- Every notification and update in one feed: alert updates, answered questions, household check-ins, and
  callbacks Soterra placed ("Soterra called you at 4:41 PM about the SON-3A Evacuation Order", with **Listen to
  summary** / **View alert**).
- Unread dots and **Mark all read**.

### 6.16 Call history and Call detail

- **List:** topic, date, length, language, and a direction icon (you called / Soterra called you). Filter: All
  · Calls I made · Callbacks.
- **Detail:** summary, topics, areas mentioned, saved questions (with their status), and follow-ups created.
  Then the **transcript**, only if consent was given, with every answer showing its source chip. Without
  consent it shows "Summary only — you chose not to save transcripts."
- Buttons: **Ask a follow-up** (→ Assistant), **Delete call** (confirm: "Delete this call's summary and
  transcript? This can't be undone.").
- Placeholder: a **Recording player** (play/scrub). It is marked "coming soon"; design it, but it is optional.

### 6.17 Updates I'm following (subscriptions manager)

- Rows: topic ("Ridgeview Fire — evacuation changes"), channel icons (app, phone call), created via (App /
  Phone call), status (**Active** · **Paused** · **Expired** · **Stopped**), expiry ("ends tomorrow 2:15
  PM"), last notified.
- Row actions: **Pause** / **Resume**, **Extend 24 h**, **Stop**.
- Global action: **Stop all updates to my number**. It does the same as saying "stop updates" on a call.
- Empty: "You're not following any updates."

### 6.18 Preparedness checklist

- Sections: Go-bag, Documents, Medications, Pets, Home (shut off gas, etc.), Plan (meeting point, contacts).
- Checkbox items with a progress ring. Content comes from officials and is labeled "From Sonoma County
  Emergency Management".

### 6.19 Settings

- **Language:** English / Español. It applies to the app and to calls.
- **Display:** Theme (System / Light / Dark), **Larger text**, **Reduce animations**.
- **Voice:** **Read answers aloud**, plus a voice picker showing the device's voices.
- **Privacy:** **Save call transcripts** switch, **Location** (Off / While using, with an explanation), and
  **Delete my data** (destructive; confirm with a typed or held action).
- **Saved needs:** up to 5 things the caller asked Soterra to remember by voice ("I use a wheelchair"). Voice
  can only save or read them after the callback check ("I'll call you back at this number to confirm it's
  you"); the app shows the same list with **Forget me**, which deletes them and stops all updates.
- **Account & phone link:** linked phone ("+1 (707) ••• ••23 · verified Oct 24"), **Unlink**, **Link another
  number**. Copy: "Calls from a linked phone show up in your history. Without linking, Soterra only remembers
  your language and area for 30 days."
- **Hotline:** number display, **Call**, **Copy number**.
- **Notifications:** an app notifications toggle and a link to iOS Settings.
- **About & privacy:** what Soterra is, the sources it uses (National Weather Service, USGS, FEMA, National
  Hurricane Center, InciWeb, county emergency pages), what the app sends over the internet, the privacy
  notice, and contacts.

### 6.20 Danger flow (from anywhere)

1. Tap the 911 pill, or the assistant detects danger ("I'm trapped, the fire is at my house").
2. The Danger sheet appears immediately, with **Call 911** as the largest button on screen.
3. Secondary: "I'm safe — show information", which returns to the screen the user came from.
4. Never show a loading state before this sheet.

---

## 7. Key user flows to prototype

1. **First launch:** onboarding → Home in crisis mode with the Ridgeview Fire.
2. **Understand an alert:** Home → top alert → Alert detail → Show on map → zone overlay.
3. **Ask a question that has an answer:** Ask Soterra → "What's going on with the Ridgeview Fire?" → sourced
   answer (1,200 acres, 10% contained, Sonoma County Fire Information, updated Oct 24 2:10 PM).
4. **Ask a question with no answer:** "Is Hillcrest Elementary open as a shelter?" → "I don't know yet" card →
   Get notified → appears in My questions → later answered → push notification → Question detail.
5. **Follow and get called back:** Alert detail → Follow → Evacuation changes + Phone call → the alert escalates
   to an Evacuation **Order** → push notification + incoming call → Activity centre entry → Alert timeline
   shows v2.
6. **Find a shelter that takes pets:** Home "Find a shelter" → Map with Shelters + Pet-friendly filters → Place
   detail → Set as household meeting point.
7. **Household check-in:** Household → My status → "On my way" → summary updates → message preview → Share.
8. **Stop updates:** More → Updates I'm following → Stop all, with a confirm dialog.
9. **Danger:** from the Assistant, type "I'm trapped" → Danger card + Call 911.
10. **Offline:** Home with the offline bar → Ask Soterra shows the call-the-hotline fallback.

---

## 8. Sample content (fictional demo data, Sonoma County, CA)

| Title | Source | Severity | Type | Text |
| --- | --- | --- | --- | --- |
| Red Flag Warning for Sonoma County | National Weather Service (Demo) | Severe | wildfire | In effect for the interior valleys and hills until Nov 15, 8 PM Pacific. Gusty northeast winds. |
| Evacuation Warning for the Ridgeview Fire | Sonoma County Emergency Management (Demo) | Severe | evacuation | Zones SON-3A and SON-3B near the Ridgeview Fire, east of Santa Rosa. |
| Ridgeview Fire incident update | Sonoma County Fire Information (Demo) | Severe | wildfire | About 1,200 acres, 10% contained. |
| Evacuation shelters for the Ridgeview Fire | Sonoma County Emergency Management (Demo) | Moderate | shelter | Two shelters open (checked 2:30 PM): Ridgeview Community Center, 500 Elm Street, which takes pets in crates, and a second shelter. |
| Road closure on Ridgeview Road | Caltrans District 4 (Demo) | Moderate | road closure | Closed both ways between Highway 12 and Bennett Valley Road. Use Highway 12 or Bennett Valley Road. |
| **Update:** Evacuation Order for zone SON-3A | Sonoma County Emergency Management (Demo) | **Extreme** | evacuation | Escalated from Warning to **Order** for SON-3A. |

Household sample: Maya (you, Parent, On my way), Daniel (Parent, At the meeting point), Leo (Child, Awaiting
check-in, last 45 min ago ⚠), Rosa (Grandparent, Checking in).

Hotline: **+1 804 606 6867**.

---

## 9. What is built vs. planned (to set expectations)

| Area | Status |
| --- | --- |
| Phone hotline (voice AI, grounded answers, "I don't know yet", danger path, English + Spanish, callbacks) | Live / backend built |
| Official alerts ingestion (NWS, USGS, FEMA, NHC, InciWeb, county pages), versions/timeline, crisis mode | Backend built |
| Saved questions + answers by officials | Backend built |
| Subscriptions (24 h, triggers, rate limit, stop updates) | Backend built; phone-call delivery being verified |
| Accounts + verified phone link | Data model built; sign-in and verification flow not built |
| In-app assistant (typed) | Planned (same backend) |
| Map places, capacity, zone check, walking routes | Planned; zone check only where official shapes exist; routing engine not chosen |
| Household | Planned |
| Push notifications, SMS | Not chosen yet (design them anyway; show SMS as "coming soon") |
| Call recordings | Not chosen yet (optional in mockups) |

---

## Appendix A — Data fields available to screens

- **Bulletin/alert:** title, body, sourceName, url, hazardType, severity, status (actual / cancelled),
  issuedAt, updatedAt, expiresAt, incidentKey, trustTier (official / official_social), isActive, version
  history (timeline), affected areas, optional geometry (zone shape), timeBasis (issued / page_updated /
  observed), and isFixture (show the Demo label).
- **Subscription:** target (incident / area / question), trigger (any_update / evacuation_change /
  severity_change / answer_available), channels (phone_call / sms), language, status (active / paused /
  cancelled / expired), consentAt, createdVia (call / app), expiresAt, lastNotifiedAt.
- **Notification:** message, channel, status, createdAt, deliveredAt, and the related bulletins.
- **Call:** direction (inbound / outbound), language, start/end, summary (text, topics, areas, hazards, saved
  questions, follow-ups, safety flag), and transcript turns with citations (when consented).
- **Saved question:** text, language, area, status (open / answered / dismissed), answer text, answer source
  name/url, answeredAt.
- **System state:** mode (normal / crisis), reason, triggering bulletin, since.
- **Account:** display name, preferred language, needs (e.g. step-free, pets, medication), and linked phones
  with verifiedAt.

## Appendix B — Responder console (not in the app, but the app reflects it)

Officials publish and correct bulletins, which appear as timeline versions in the app. They answer saved
questions, which reach the user through Question detail plus a notification. They update shelter open/closed
status and capacity, which sets the freshness time on Place detail. The app never shows who answered, only the
official source.
