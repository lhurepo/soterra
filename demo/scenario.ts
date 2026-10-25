// [S] The demo scenario: the Marina Earthquake (fictional). 13 mock sites served by Convex at /mock-sites/sf/<page>
// and crawled by real Apify actors. Each site has a "before" page (calm) and an "after" page (the earthquake).
// `npm run demo:start` writes both, serves "before", switches to "after" a few seconds later and crawls every site.
// Pages are deliberately short: one fact per sentence, every sentence ends with a period, times in "Last updated" form,
// so the extractor quotes them cleanly. Every page ends with "This is fictional demo data."
//
// Story: at a Cal Hacks judging session in the Palace of Fine Arts, a M6.4 earthquake hits the Marina District.
// The caller is studying at the Marina Branch Library (1890 Chestnut Street), inside the evacuation zone, and has a
// friend at the hackathon. Hacker posts on the mock X feed are unverified (signals only, never spoken); the facts the
// caller hears come from the official pages and the three allowlisted official X accounts.

export type DemoTimes = {
  /** When the earthquake struck (shortly before the caller dials). */
  quakeAt: number;
  /** When the "after" pages go live; their "Last updated" time. */
  updatedAt: number;
};

export type DemoSite = {
  sourceId: string;
  /** Issuer shown and spoken ("(Demo)" is added for fixture data by the pipeline when missing). */
  name: string;
  /** Path under /mock-sites/. */
  path: string;
  kind: "official_web" | "social";
  /** website-content-crawler pages go through LLM extraction; cheerio pages use a deterministic page function. */
  actor: "website-content-crawler" | "cheerio-scraper";
  pageFunction?: "shelters" | "x-feed";
  /** Independence group: pages of the same agency never confirm each other. */
  group: string;
  /** Wave 1 is crawled as soon as the pages switch; wave 2 a few seconds later (Apify concurrency). */
  wave: 1 | 2;
  before: (t: DemoTimes) => string;
  after: (t: DemoTimes) => string;
};

const TZ = "America/Los_Angeles";

function zoneAbbr(ms: number): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "short" }).formatToParts(ms).find((p) => p.type === "timeZoneName");
  return part?.value === "PST" ? "PST" : "PDT";
}

/** "3:41 PM PDT" */
export function clock(ms: number): string {
  return `${new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(ms)} ${zoneAbbr(ms)}`;
}

/** "October 24, 2026" */
export function day(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "long", day: "numeric", year: "numeric" }).format(ms);
}

/** "Last updated: October 24, 2026, 3:43 PM PDT" (the form parsePageTime reads). */
function updated(ms: number): string {
  return `<p>Last updated: ${day(ms)}, ${clock(ms)}</p>`;
}

const FOOTER = "<p>This is fictional demo data.</p>";

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}${FOOTER}</body></html>`;
}

/** A calm page: what the site says before the earthquake. The site name is a label in front of the headline. */
function calm(site: string, heading: string, text: string) {
  return (t: DemoTimes) => page(heading, `<p class="site">${site}</p><h1>${heading}</h1>${updated(t.quakeAt - 30 * 60_000)}<p>${text}</p>`);
}

/** The tab title is the headline, so every extractor takes the headline as the bulletin title. */
function wcc(site: string, heading: string, sentences: string[]) {
  return (t: DemoTimes) => page(heading, `<p class="site">${site}</p><h1>${heading}</h1>${updated(t.updatedAt)}${sentences.map((s) => `<p>${s}</p>`).join("")}`);
}

// ───────────────────────── Shelters (cheerio table) ─────────────────────────

const SHELTER_HEAD = "<tr><th>Shelter</th><th>Address</th><th>Status</th><th>Capacity</th><th>Available</th><th>Pets</th><th>Accessibility</th></tr>";

function shelterPage(heading: string, rows: string[][]) {
  return (t: DemoTimes) =>
    page(
      "SF Emergency Shelters (Demo)",
      `<h1>${heading}</h1><p class="checked">Checked by city staff at ${clock(t.updatedAt)} on ${day(t.updatedAt)}.</p>` +
        `<table><thead>${SHELTER_HEAD}</thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
    );
}

// ───────────────────────── X feed (cheerio) ─────────────────────────

/** Allowlisted official accounts on the mock X feed: their posts become official_social bulletins. */
export const DEMO_X_ACCOUNTS = [
  { handle: "sfdem_demo", issuer: "SF Emergency Management (Demo)", states: ["CA"], group: "sf-dem" },
  { handle: "sffd_demo", issuer: "SF Fire Department (Demo)", states: ["CA"], group: "sffd" },
  { handle: "usgsquakes_demo", issuer: "USGS Earthquakes (Demo)", states: ["CA"], group: "usgs" },
];

type Post = { handle: string; name: string; text: string; /** seconds after the quake */ at: number };

const BEFORE_POSTS: Omit<Post, "at">[] = [
  { handle: "byte_me_maya", name: "Maya", text: "judging starts in 10 minutes and our demo still has one bug #CalHacks" },
  { handle: "sudo_sam", name: "Sam", text: "the Palace of Fine Arts is such a vibe for a hackathon #CalHacks" },
  { handle: "jordan_ships", name: "Jordan", text: "36 hours, 4 energy drinks, 1 robot dog. let's go #CalHacks" },
];

/** At least 30 posts. Hackers (not allowlisted) become signals only; the official ones are allowlisted. */
const AFTER_POSTS = (q: string): Post[] => [
  { handle: "usgsquakes_demo", name: "USGS Earthquakes (Demo)", at: 40, text: `Magnitude 6.4 earthquake at ${q}, epicenter at the Palace of Fine Arts, Marina District, San Francisco. Depth 8 km. Aftershocks are likely.` },
  { handle: "sfdem_demo", name: "SF Emergency Management (Demo)", at: 50, text: "EVACUATION ORDER: Marina District north of Lombard Street, from Van Ness Avenue to Lyon Street. Leave now. Shelter open at Hamilton Recreation Center, 1900 Geary Boulevard." },
  { handle: "sffd_demo", name: "SF Fire Department (Demo)", at: 55, text: "Partial collapse at the Palace of Fine Arts. All Cal Hacks attendees and staff are accounted for. Minor injuries were treated on scene." },
  { handle: "sffd_demo", name: "SF Fire Department (Demo)", at: 58, text: "Crews are working 3 structure fires and 6 gas leaks in the Marina District. Avoid Marina Boulevard and Baker Street." },
  { handle: "sfdem_demo", name: "SF Emergency Management (Demo)", at: 60, text: "The Golden Gate Bridge and Marina Boulevard are closed. BART is suspended for inspection. Expect aftershocks: drop, cover and hold on." },
  { handle: "byte_me_maya", name: "Maya", at: 3, text: "EARTHQUAKE at Cal Hacks!! we were literally in the middle of judging #PalaceOfFineArts" },
  { handle: "sudo_sam", name: "Sam", at: 4, text: "bro we were mid-demo and the whole rotunda started swaying. we got out #CalHacks #earthquake" },
  { handle: "jordan_ships", name: "Jordan", at: 5, text: "my robot dog got crushed by a falling column. RIP Sparky #CalHacks #earthquake" },
  { handle: "null_pointer_priya", name: "Priya", at: 6, text: "I lost ALL my stuff, my laptop is under the east hall rubble. at least we're alive #earthquake" },
  { handle: "dev_diego", name: "Diego", at: 7, text: "I swear I saw Iron Man carry someone out of the east hall. or a guy in a really good cosplay #CalHacks" },
  { handle: "hackerhannah", name: "Hannah", at: 8, text: "#PalaceOfFineArts is in ruins. the colonnade on the lagoon side is down #earthquake" },
  { handle: "kernel_kev", name: "Kevin", at: 9, text: "east exhibition hall roof partly came down. everyone ran to the lawn by the lagoon #quake" },
  { handle: "async_ava", name: "Ava", at: 10, text: "smell of gas on Baker St near the Palace, firefighters telling everyone to move back #earthquake" },
  { handle: "rustacean_ray", name: "Ray", at: 11, text: "Marina Blvd is cracked open near the yacht harbor, water everywhere #sfquake #earthquake" },
  { handle: "golden_bear_gabe", name: "Gabe", at: 12, text: "felt that in Berkeley, the whole library shook. hope my friends at Cal Hacks are ok #earthquake" },
  { handle: "lambda_lena", name: "Lena", at: 14, text: "aftershock just now!! everyone on the lawn screamed #earthquake" },
  { handle: "stackoverflow_sid", name: "Sid", at: 15, text: "staff did a headcount on the lawn, they say everyone from the hall is out #CalHacks #earthquake" },
  { handle: "byte_me_maya", name: "Maya", at: 16, text: "judges were mid-sentence giving feedback. 'great UI but' *earthquake* #CalHacks" },
  { handle: "pixel_pat", name: "Pat", at: 17, text: "power is out across the Marina, all the traffic lights on Lombard are dead #sfquake #earthquake" },
  { handle: "dev_diego", name: "Diego", at: 18, text: "fire trucks everywhere on Lyon St. smoke over by Chestnut #earthquake" },
  { handle: "sudo_sam", name: "Sam", at: 19, text: "our project was literally a disaster hotline. you can't make this up #CalHacks #earthquake" },
  { handle: "toll_plaza_tim", name: "Tim", at: 20, text: "Golden Gate Bridge is closed, police at the toll plaza turning everyone around after the quake #sfquake" },
  { handle: "bart_rider_bea", name: "Bea", at: 22, text: "BART stopped mid-tunnel for a bit after the quake, now they're walking us out at Embarcadero #earthquake" },
  { handle: "jordan_ships", name: "Jordan", at: 23, text: "someone's hackathon drone flew itself into the lagoon during the shaking #CalHacks #earthquake" },
  { handle: "hackerhannah", name: "Hannah", at: 24, text: "free advice: don't go back into the Palace for your laptop. firefighters are not playing #CalHacks #earthquake" },
  { handle: "kernel_kev", name: "Kevin", at: 25, text: "the dome is still standing but there are cracks all over the inside #PalaceOfFineArts #earthquake" },
  { handle: "async_ava", name: "Ava", at: 26, text: "people walking south toward Geary with sleeping bags, heard there's a shelter at Hamilton Rec #sfquake #earthquake" },
  { handle: "rustacean_ray", name: "Ray", at: 27, text: "water pipe burst on Chestnut St after the earthquake, the street is filling with water" },
  { handle: "lambda_lena", name: "Lena", at: 28, text: "I was in the bathroom when it hit. worst 20 seconds of my life #CalHacks #earthquake" },
  { handle: "null_pointer_priya", name: "Priya", at: 29, text: "the swans in the lagoon look unbothered honestly #PalaceOfFineArts #earthquake" },
  { handle: "stackoverflow_sid", name: "Sid", at: 30, text: "my teammate twisted her ankle running out, medics on the lawn taped it up, she's fine #CalHacks #earthquake" },
  { handle: "pixel_pat", name: "Pat", at: 32, text: "organizers moved everyone to the Marina Green, now they say leave the Marina entirely #earthquake" },
  { handle: "dev_diego", name: "Diego", at: 34, text: "rubble is mostly on the lagoon side and the east hall. the west entrance looks ok #PalaceOfFineArts #earthquake" },
  { handle: "byte_me_maya", name: "Maya", at: 36, text: "lost my hoodie, my charger and my will to code. but we all made it out #CalHacks #earthquake" },
  { handle: "toll_plaza_tim", name: "Tim", at: 38, text: "gas smell near Marina Blvd and Baker after the quake, PG&E trucks just pulled up #sfquake" },
];

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function feedPage(posts: (t: DemoTimes) => { id: string; handle: string; name: string; text: string; postedAt: number }[]) {
  return (t: DemoTimes) =>
    page(
      "X (Demo)",
      `<h1>Latest posts</h1>` +
        posts(t)
          .sort((a, b) => b.postedAt - a.postedAt)
          .map(
            (p) =>
              `<article class="post" data-id="${p.id}" data-handle="${p.handle}"><span class="name">${escapeHtml(p.name)}</span> @${p.handle} ` +
              `<time datetime="${new Date(p.postedAt).toISOString()}">${clock(p.postedAt)}</time><p class="text">${escapeHtml(p.text)}</p></article>`,
          )
          .join(""),
    );
}

/** Ids of every post on the mock feed (the reset deletes their signals). */
export const DEMO_POST_IDS = [...BEFORE_POSTS.map((_, i) => `sfdemo-calm-${i + 1}`), ...AFTER_POSTS("").map((_, i) => `sfdemo-post-${String(i + 1).padStart(2, "0")}`)];

// ───────────────────────── The 13 sites ─────────────────────────

const SF_DEM = "San Francisco Department of Emergency Management";

export const DEMO_SITES: DemoSite[] = [
  {
    sourceId: "sfdemo_alerts",
    name: `${SF_DEM} (Demo)`,
    path: "sf/alertsf.html",
    kind: "official_web",
    actor: "website-content-crawler",
    group: "sf-dem",
    wave: 1,
    before: calm("AlertSF (Demo)", "AlertSF: Current Alerts", "There are no active emergency alerts for San Francisco."),
    after: (t) =>
      wcc("AlertSF (Demo)", "Marina Earthquake: Evacuation Order for the Marina District", [
        `An Evacuation Order is in effect for the Marina District after the magnitude 6.4 Marina Earthquake at ${clock(t.quakeAt)}.`,
        "Zone SF-1 Marina District: north of Lombard Street, from Van Ness Avenue to Lyon Street, including Marina Green and Crissy Field.",
        "The order is due to gas leaks, fires and damaged buildings near the Palace of Fine Arts.",
        "Leave now and go to Hamilton Recreation Center, 1900 Geary Boulevard.",
        "Avoid Marina Boulevard, Baker Street and Lombard Street.",
        "Stay out of damaged buildings.",
      ])(t),
  },
  {
    sourceId: "sfdemo_usgs",
    name: "U.S. Geological Survey (Demo)",
    path: "sf/usgs-event.html",
    kind: "official_web",
    actor: "website-content-crawler",
    group: "usgs",
    wave: 1,
    before: calm("USGS Earthquake Hazards (Demo)", "Bay Area Earthquakes: Past Day", "No significant earthquakes were recorded in the San Francisco Bay Area in the past day."),
    after: (t) =>
      wcc("USGS Earthquake Hazards (Demo)", "M 6.4 Marina Earthquake, San Francisco, CA", [
        `A magnitude 6.4 earthquake struck at ${clock(t.quakeAt)} on ${day(t.quakeAt)}.`,
        "The epicenter was at the Palace of Fine Arts in the Marina District of San Francisco, at a depth of 8 km.",
        "Shaking was violent in the Marina District, very strong across northern San Francisco, and strong in Oakland and Berkeley.",
        "Aftershocks are likely; there is a 1 in 20 chance of a magnitude 5 or larger aftershock in the next week.",
        "Stay away from damaged buildings during aftershocks.",
      ])(t),
  },
  {
    sourceId: "sfdemo_sffd",
    name: "San Francisco Fire Department (Demo)",
    path: "sf/sffd-incident.html",
    kind: "official_web",
    actor: "website-content-crawler",
    group: "sffd",
    wave: 1,
    before: calm("SFFD Incidents (Demo)", "SFFD: Major Incidents", "There are no major incidents in San Francisco."),
    after: (t) =>
      wcc("SFFD Incidents (Demo)", "Marina Earthquake: Palace of Fine Arts Partial Collapse", [
        `The colonnade and the east exhibition hall of the Palace of Fine Arts partially collapsed in the earthquake at ${clock(t.quakeAt)}.`,
        "All Cal Hacks attendees and staff at the Palace of Fine Arts are accounted for.",
        "Fourteen people had minor injuries and were treated on scene; two were taken to Zuckerberg San Francisco General Hospital.",
        "Crews are working 3 structure fires and 6 gas leaks in the Marina District.",
        "Avoid the area around Baker Street and Marina Boulevard.",
      ])(t),
  },
  {
    sourceId: "sfdemo_shelters",
    name: `${SF_DEM} (Demo)`,
    path: "sf/shelters.html",
    kind: "official_web",
    actor: "cheerio-scraper",
    pageFunction: "shelters",
    group: "sf-dem",
    wave: 1,
    before: shelterPage("San Francisco Emergency Shelters", [
      ["Hamilton Recreation Center", "1900 Geary Boulevard, San Francisco", "Closed", "250", "0", "Pets in crates", "Wheelchair accessible"],
    ]),
    after: shelterPage("Marina Earthquake: Emergency Shelters", [
      ["Hamilton Recreation Center", "1900 Geary Boulevard, San Francisco", "Open", "250", "180", "Pets in crates", "Wheelchair accessible"],
      ["Kezar Pavilion", "755 Stanyan Street, San Francisco", "Open", "400", "390", "Service animals only", "Wheelchair accessible"],
      ["Moscone Center West", "800 Howard Street, San Francisco", "Opening at 6:00 PM", "1000", "1000", "Pets allowed", "Wheelchair accessible, medical station"],
      ["Marina Middle School", "3500 Fillmore Street, San Francisco", "Closed (inside the evacuation zone)", "0", "0", "None", "None"],
    ]),
  },
  {
    sourceId: "sfdemo_x",
    name: "X (Demo)",
    path: "sf/x-feed.html",
    kind: "social",
    actor: "cheerio-scraper",
    pageFunction: "x-feed",
    group: "x-demo",
    wave: 1,
    before: feedPage((t) => BEFORE_POSTS.map((p, i) => ({ ...p, id: `sfdemo-calm-${i + 1}`, postedAt: t.quakeAt - (20 - i * 5) * 60_000 }))),
    after: feedPage((t) => [
      ...BEFORE_POSTS.map((p, i) => ({ ...p, id: `sfdemo-calm-${i + 1}`, postedAt: t.quakeAt - (20 - i * 5) * 60_000 })),
      ...AFTER_POSTS(clock(t.quakeAt)).map((p, i) => ({
        ...p,
        id: `sfdemo-post-${String(i + 1).padStart(2, "0")}`,
        postedAt: Math.min(t.quakeAt + p.at * 1_000, t.updatedAt),
      })),
    ]),
  },
  {
    sourceId: "sfdemo_situation",
    name: `${SF_DEM} (Demo)`,
    path: "sf/situation.html",
    kind: "official_web",
    actor: "website-content-crawler",
    group: "sf-dem",
    wave: 2,
    before: calm("SF Situation Updates (Demo)", "San Francisco Situation Updates", "There is no active emergency in San Francisco."),
    after: (t) =>
      wcc("SF Situation Updates (Demo)", "Marina Earthquake: Situation Update", [
        "Everyone at the Cal Hacks event at the Palace of Fine Arts is accounted for after the partial collapse.",
        "The Evacuation Order for the Marina District north of Lombard Street remains in effect.",
        "Shelter is open at Hamilton Recreation Center, 1900 Geary Boulevard, and Kezar Pavilion, 755 Stanyan Street.",
        "Drinking water stations are open at Alta Plaza Park and Hamilton Recreation Center.",
        "The Golden Gate Bridge, Marina Boulevard and BART are closed.",
        "Expect aftershocks.",
      ])(t),
  },
  {
    sourceId: "sfdemo_tsunami",
    name: "National Tsunami Center (Demo)",
    path: "sf/tsunami.html",
    kind: "official_web",
    actor: "website-content-crawler",
    group: "ntwc",
    wave: 2,
    before: calm("Tsunami.gov (Demo)", "Tsunami Messages", "There are no tsunami messages in effect for the California coast."),
    after: (t) =>
      wcc("Tsunami.gov (Demo)", "Tsunami Information Statement: Marina Earthquake", [
        "There is no tsunami threat to San Francisco Bay or the California coast from the magnitude 6.4 Marina Earthquake.",
        "The earthquake was too small and too far inland to generate a tsunami.",
        "No action is needed for tsunami safety.",
      ])(t),
  },
  {
    sourceId: "sfdemo_sfmta",
    name: "SFMTA (Demo)",
    path: "sf/sfmta.html",
    kind: "official_web",
    actor: "website-content-crawler",
    group: "sfmta",
    wave: 2,
    before: calm("SFMTA Service Alerts (Demo)", "Muni and Street Alerts", "Muni is running on schedule and there are no major street closures."),
    after: (t) =>
      wcc("SFMTA Service Alerts (Demo)", "Marina Earthquake: Street Closures and Muni Detours", [
        "Marina Boulevard is closed in both directions from Lyon Street to Laguna Street.",
        "Lombard Street is closed from Van Ness Avenue to Broderick Street.",
        "Muni routes 22, 28, 30 and 43 are detoured away from the Marina District.",
        "Avoid driving in northern San Francisco so emergency vehicles can get through.",
      ])(t),
  },
  {
    sourceId: "sfdemo_caltrans",
    name: "Caltrans District 4 (Demo)",
    path: "sf/caltrans.html",
    kind: "official_web",
    actor: "website-content-crawler",
    group: "caltrans",
    wave: 2,
    before: calm("Caltrans District 4 (Demo)", "Bay Area Highway Conditions", "All Bay Area bridges and highways are open."),
    after: (t) =>
      wcc("Caltrans District 4 (Demo)", "Marina Earthquake: Golden Gate Bridge Closed", [
        "The Golden Gate Bridge is closed in both directions for a safety inspection.",
        "Presidio Parkway is closed from Marina Boulevard to the toll plaza.",
        "The Bay Bridge is open with long delays.",
        "Avoid travel to the Marina District and the Presidio.",
      ])(t),
  },
  {
    sourceId: "sfdemo_bart",
    name: "BART (Demo)",
    path: "sf/bart.html",
    kind: "official_web",
    actor: "website-content-crawler",
    group: "bart",
    wave: 2,
    before: calm("BART Service Status (Demo)", "BART Service Status", "BART trains are running on schedule."),
    after: (t) =>
      wcc("BART Service Status (Demo)", "Marina Earthquake: BART Service Suspended", [
        "BART service is suspended on all lines while crews inspect the tracks and the Transbay Tube.",
        "Trains stopped between stations have been moved to the nearest station.",
        "Service is expected to resume in stages after 7:00 PM.",
        "Stay off station platforms and follow staff directions.",
      ])(t),
  },
  {
    sourceId: "sfdemo_pge",
    name: "PG&E (Demo)",
    path: "sf/pge.html",
    kind: "official_web",
    actor: "website-content-crawler",
    group: "pge",
    wave: 2,
    before: calm("PG&E Outage Center (Demo)", "PG&E Outages: San Francisco", "There are no major outages in San Francisco."),
    after: (t) =>
      wcc("PG&E Outage Center (Demo)", "Marina Earthquake: Gas Shutoff and Power Outages", [
        "Gas service is shut off in the Marina District while crews repair leaks.",
        "About 18,000 customers in northern San Francisco are without power.",
        "If you smell gas, leave the building and call 911.",
        "Do not turn your gas back on yourself.",
      ])(t),
  },
  {
    sourceId: "sfdemo_water",
    name: "San Francisco Public Utilities Commission (Demo)",
    path: "sf/water.html",
    kind: "official_web",
    actor: "website-content-crawler",
    group: "sfpuc",
    wave: 2,
    before: calm("SFPUC Water Service (Demo)", "Water Service Status", "Water service is normal across San Francisco."),
    after: (t) =>
      wcc("SFPUC Water Service (Demo)", "Marina Earthquake: Water Service and Water Stations", [
        "Two water mains broke in the Marina District and water pressure is low north of Lombard Street.",
        "Drinking water stations are open at Alta Plaza Park, Jackson Street and Steiner Street, and at Hamilton Recreation Center, 1900 Geary Boulevard.",
        "Boil tap water before drinking it in the Marina District.",
      ])(t),
  },
  {
    sourceId: "sfdemo_redcross",
    name: "American Red Cross (Demo)",
    path: "sf/redcross.html",
    kind: "official_web",
    actor: "website-content-crawler",
    group: "redcross",
    wave: 2,
    before: calm("Red Cross Bay Area (Demo)", "Red Cross Bay Area Response", "There are no active Red Cross disaster responses in San Francisco."),
    after: (t) =>
      wcc("Red Cross Bay Area (Demo)", "Marina Earthquake: Red Cross Response", [
        "Red Cross volunteers are supporting the shelter at Hamilton Recreation Center with cots, food, water and first aid.",
        "To find a family member, register on the Red Cross Safe and Well site or call 1-800-733-2767.",
        "Bring medications, a phone charger and identification if you go to a shelter.",
      ])(t),
  },
];

/** Every sourceId that carries demo data (the reset deletes their bulletins). */
export const DEMO_SOURCE_IDS = DEMO_SITES.map((s) => s.sourceId);

/** Times for a run that starts now: the quake struck a minute ago, the pages switch after `delayMs`. */
export function demoTimes(startedAt: number, delayMs: number): DemoTimes {
  return { quakeAt: startedAt - 60_000, updatedAt: startedAt + delayMs };
}
