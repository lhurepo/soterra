# Product

<!-- impeccable:product-schema 1 -->

Scope: the Soterra **iOS app**. This repository holds the shared backend (Convex) and the phone agent
(`voice/`); the app is a client of that backend. Full screen and feature inventory: `docs/MOBILE_APP_SPEC.md`.

## Platform

ios

## Users

Primary: **residents in or near a disaster area** (wildfire, flood, hurricane and similar). They may be
stressed, outdoors, on a weak connection or low battery, using one hand, older or less comfortable with
technology, and may speak Spanish. They glance for seconds to learn what is happening, what to do next and
whether anything changed; they do not explore.

Secondary: household members coordinating check-ins and a shared meeting point. Responders (officials who
publish bulletins and answer saved questions) use a separate console, which is out of scope for the app.

## Product Purpose

Soterra is an emergency information service. People ask questions and Soterra answers **only from official,
timestamped bulletins**, naming the source and time. When it does not know, it says "I don't know yet", saves
the question, and follows up when officials answer. It calls people back when news they follow changes.

The phone hotline (**+1 712 600 3362**, live) is the main product and needs no app. The app adds visual
alerts, a map, household check-ins, call history and followed topics on top of it. Success: a resident gets
a correct, sourced answer, or an honest "not yet", in seconds, and hears about changes without having to
check.

## Positioning

Grounded or silent: every piece of disaster information carries its official source and time, and uncertainty
is shown as a calm, normal state rather than filled with a guess. The same backend serves a voice line that
anyone can call from any phone, so the app is never the only way in.

## Operating Context

- Ways in: phone hotline, this iOS app, a web companion and the responder console, all on one Convex backend.
- Official data: national weather services, regional emergency feeds and road reports; scraped notices
  where no feed exists. Nothing unverified is presented as information.
- Follow-ups: a caller or app user follows a topic (any update, evacuation change, severity change, answer
  available); notifications are by phone call today, SMS planned; at most one per 15 minutes; subscriptions
  last 24 hours.
- Data model terms: severity (extreme, severe, moderate, minor, unknown); 12 hazard types; trust tiers
  (official, official social, unverified); time basis (issued, page updated, observed); crisis mode.

## Capabilities and Constraints

Non-negotiable rules the UI must never contradict (enforced in the product):

1. **Danger first.** A 911 action is one tap from every screen. Soterra never sends help; no copy may imply it
   ("help is on the way", "SOS sent").
2. **Grounded.** No unsourced disaster text anywhere; every item shows source name and time.
3. **"I don't know yet" is a first-class state**, not an error.
4. **No address guessing.** The app never says an address is or is not inside a zone; it lists official zones
   and links to the official lookup.
5. **Freshness is visible**; stale information is marked as needing reconfirmation.
6. **Trust is labeled**: official vs official social media; unverified content is never shown as fact.
7. **Privacy by default**: no tracking, location only with consent (manual area is the default), transcripts
   kept only with permission, "Delete my data" always available. Anonymous memory lasts 30 days,
   anonymous transcripts 7 days.
8. **The app is optional**: "Call Soterra" is always one tap away and works offline via the dialer.

Built vs planned is tracked in `docs/MOBILE_APP_SPEC.md` §9. Planned, not built: SMS, call recordings, push
notifications, walking routes, languages beyond English and Spanish.

## Brand Commitments

- Name **Soterra**; wordmark set lowercase in **Outfit Medium** (SIL OFL), tracking about −2%.
- Logo: the Soterra mark plus lowercase wordmark. Assets in `docs/soterra-brand-package/` (`README.txt` explains
  it; `logo/<colorway>/` has the icon, horizontal, stacked and wordmark files in 9 colorways, `app-icon/` the
  1024 px app icons, `favicon/` the favicons). The app uses the horizontal logo (04-mist on light, 01-night on
  dark) in the top bar and the 01-night app icon.
- Palette (binding, `docs/soterra-brand-package/colors/`): Abyss #041421,
  Deep Teal #042630, Slate Teal #4C7273, Sage #86B9B0, Mist #D0D6D6, plus #2F5557 for tagline text on light
  backgrounds. Severity colors (red, orange, yellow, blue, grey) and the red 911 pill are semantic and sit
  outside the brand palette.
- Logo usage: on-dark versions on Abyss or Deep Teal, on-light on Mist or white; clear space about a quarter
  of the mark's height; never recolor outside the palette, stretch, or add effects.
- Voice: calm, plain and short. No exclamation marks, no gamification, no playful empty states. Footer line:
  "Soterra shares official information. It does not replace emergency services."

## Evidence on Hand

- Live hotline +1 712 600 3362 (Cartesia voice agent on the Convex dev backend).
- Demo scenario: the fictional **Ridgeview Fire** with demo bulletins from "Sonoma County Emergency
  Management (Demo)" in `fixtures/normalized/`; real hotline wording in `src/config/strings.ts`.
- All demo content is fictional and labeled "(Demo)". There are no real users, testimonials, partnerships or
  agency endorsements; do not fabricate any.

## Product Principles

1. Safety outranks everything: the path to 911 is never more than one tap away or hidden by other UI.
2. Say where it came from and when, or say nothing.
3. Uncertainty is honest and calm; "not yet" is an answer.
4. Design for a stressed person glancing at the screen for a few seconds, not for exploration.
5. The app adds to the phone line and never replaces it.

## Accessibility & Inclusion

- Larger text (Dynamic Type) supported throughout; 44 pt minimum touch targets; 17 pt body.
- Severity is never conveyed by color alone: always color plus label plus icon, in light and dark.
- Reduce Motion: no pulsing markers or animated transitions.
- English and Spanish now (Spanish runs about 30% longer); French, Mandarin and Punjabi planned.
- Offline: show last synced data with its time; calling still works.
