import Foundation

/// Fictional Marina Earthquake data, taken from demo/scenario.ts (the pages the backend demo crawls). The app is fixed
/// to San Francisco, with the person at the Marina Branch Library. Times are Pacific. Every source name ends in
/// "(Demo)" so nothing can be mistaken for a real bulletin.
enum DemoData {
    static let emergencyManagement = "San Francisco Department of Emergency Management (Demo)"
    static let usgs = "U.S. Geological Survey (Demo)"
    static let fireDepartment = "San Francisco Fire Department (Demo)"
    static let sfmta = "SFMTA (Demo)"
    static let pge = "PG&E (Demo)"

    /// The one area the demo covers (More → Area).
    static let areaName = "San Francisco, CA"

    // MARK: Alerts

    static let orderID = "marina-evacuation-order"
    static let quakeID = "marina-earthquake-usgs"
    static let collapseID = "marina-palace-collapse"
    static let sheltersID = "marina-shelters"
    static let roadClosureID = "marina-street-closures"
    static let utilitiesID = "marina-gas-and-power"

    static let evacuationOrder = HazardAlert(
        id: orderID, severity: .extreme, kind: .order, hazard: .evacuation,
        title: "Evacuation Order",
        headline: "Evacuation Order for the Marina District. Leave now.",
        instruction: "Leave now.",
        area: "Zone SF-1 Marina District, north of Lombard Street, Van Ness Avenue to Lyon Street",
        details: "An Evacuation Order is in effect for the Marina District after the magnitude 6.4 Marina Earthquake. "
            + "Zone SF-1 covers the Marina District north of Lombard Street, from Van Ness Avenue to Lyon Street, "
            + "including Marina Green and Crissy Field. The order is due to gas leaks, fires and damaged buildings "
            + "near the Palace of Fine Arts. Leave now and go to Hamilton Recreation Center, 1900 Geary Boulevard. "
            + "Avoid Marina Boulevard, Baker Street and Lombard Street. Stay out of damaged buildings.",
        times: [TimeMark(label: "Issued", value: "3:43 PM", isHighlighted: true), TimeMark(label: "Now", value: "3:52 PM")],
        source: SourceInfo(name: emergencyManagement, corroboratedBy: [fireDepartment]),
        changeNote: "New at 3:43 PM, the first official order for San Francisco",
        steps: [
            ActionStep(id: "leave", text: "Leave zone SF-1 now", systemImage: "figure.walk"),
            ActionStep(id: "route", text: "Avoid Marina Boulevard, Baker Street and Lombard Street", systemImage: "road.lanes"),
            ActionStep(id: "shelter", text: "Go to Hamilton Recreation Center, 1900 Geary Boulevard", systemImage: "house"),
            ActionStep(id: "buildings", text: "Stay out of damaged buildings", systemImage: "building.2"),
        ]
    )

    static let quakeUpdate = HazardAlert(
        id: quakeID, severity: .severe, kind: .update, hazard: .earthquake,
        title: "M 6.4 Marina Earthquake",
        headline: "Magnitude 6.4 earthquake at the Palace of Fine Arts.",
        instruction: "Aftershocks are likely. Stay away from damaged buildings.",
        area: "Marina District, San Francisco",
        details: "A magnitude 6.4 earthquake struck at 3:41 PM. The epicenter was at the Palace of Fine Arts in the "
            + "Marina District, at a depth of 8 km. Shaking was violent in the Marina District, very strong across "
            + "northern San Francisco, and strong in Oakland and Berkeley. There is a 1 in 20 chance of a "
            + "magnitude 5 or larger aftershock in the next week.",
        times: [TimeMark(label: "Issued", value: "3:43 PM"), TimeMark(label: "Now", value: "3:52 PM")],
        source: SourceInfo(name: usgs, corroboratedBy: [fireDepartment])
    )

    static let palaceCollapse = HazardAlert(
        id: collapseID, severity: .severe, kind: .update, hazard: .earthquake,
        title: "Palace of Fine Arts partial collapse",
        headline: "Palace of Fine Arts partly collapsed. Cal Hacks attendees are accounted for.",
        instruction: "Avoid the area around Baker Street and Marina Boulevard.",
        area: "Palace of Fine Arts, Marina District",
        details: "The colonnade and the east exhibition hall partially collapsed. All Cal Hacks attendees and staff are "
            + "accounted for. Fourteen people had minor injuries and were treated on scene; two were taken to "
            + "Zuckerberg San Francisco General Hospital. Crews are working 3 structure fires and 6 gas leaks in the "
            + "Marina District.",
        times: [TimeMark(label: "Issued", value: "3:43 PM"), TimeMark(label: "Now", value: "3:52 PM")],
        source: SourceInfo(name: fireDepartment, corroboratedBy: [emergencyManagement])
    )

    static let shelterBulletin = HazardAlert(
        id: sheltersID, severity: .moderate, kind: .info, hazard: .shelter,
        title: "Emergency shelters",
        headline: "Two shelters are open. A third opens at 6:00 PM.",
        instruction: "Hamilton Recreation Center takes pets in crates. Kezar Pavilion takes service animals only.",
        area: "Hamilton Recreation Center, Kezar Pavilion and Moscone Center West",
        details: "Hamilton Recreation Center, 1900 Geary Boulevard, has 180 of 250 spaces. Kezar Pavilion, "
            + "755 Stanyan Street, has 390 of 400 spaces. Moscone Center West, 800 Howard Street, opens at 6:00 PM. "
            + "Marina Middle School is closed because it is inside the evacuation zone.",
        times: [TimeMark(label: "Issued", value: "3:43 PM"), TimeMark(label: "Checked", value: "3:45 PM")],
        source: SourceInfo(name: emergencyManagement)
    )

    static let roadClosure = HazardAlert(
        id: roadClosureID, severity: .moderate, kind: .closure, hazard: .roadClosure,
        title: "Street closures",
        headline: "Marina Boulevard is closed both ways.",
        instruction: "Avoid driving in northern San Francisco so emergency vehicles can get through.",
        area: "Marina Boulevard from Lyon Street to Laguna Street",
        details: "Marina Boulevard is closed in both directions from Lyon Street to Laguna Street. Lombard Street is "
            + "closed from Van Ness Avenue to Broderick Street. The Golden Gate Bridge is closed. Muni routes 22, 28, "
            + "30 and 43 are detoured away from the Marina District. BART is suspended.",
        times: [TimeMark(label: "Issued", value: "3:44 PM")],
        source: SourceInfo(name: sfmta)
    )

    static let utilities = HazardAlert(
        id: utilitiesID, severity: .severe, kind: .info, hazard: .other,
        title: "Gas shutoff and power outages",
        headline: "Gas is shut off in the Marina District.",
        instruction: "If you smell gas, leave the building and call 911.",
        area: "Marina District and northern San Francisco",
        details: "Gas service is shut off in the Marina District while crews repair leaks. About 18,000 customers in "
            + "northern San Francisco are without power. Do not turn your gas back on yourself.",
        times: [TimeMark(label: "Issued", value: "3:46 PM")],
        source: SourceInfo(name: pge)
    )

    static let allAlerts: [HazardAlert] = [
        evacuationOrder, quakeUpdate, palaceCollapse, utilities, shelterBulletin, roadClosure,
    ]

    /// `.crisis`: the earthquake has struck but no order exists yet. `.escalated`: the Evacuation Order is out.
    static func alerts(for scenario: HomeScenario) -> [HazardAlert] {
        switch scenario {
        case .crisis: [quakeUpdate, palaceCollapse, roadClosure]
        case .escalated: [evacuationOrder, quakeUpdate, palaceCollapse, utilities, shelterBulletin, roadClosure]
        case .calm: []
        }
    }

    static func alert(id: HazardAlert.ID) -> HazardAlert? {
        allAlerts.first { $0.id == id }
    }

    // MARK: Today

    static func today(for scenario: HomeScenario) -> [TimelineItem] {
        let quake = TimelineItem(id: "t-quake", time: "3:43 PM", text: "M 6.4 earthquake at the Palace of Fine Arts",
                                 source: usgs, severity: .severe, alertID: quakeID)
        let collapse = TimelineItem(id: "t-collapse", time: "3:43 PM", text: "Palace of Fine Arts partly collapsed, Cal Hacks attendees accounted for",
                                    source: fireDepartment, severity: .severe, alertID: collapseID)
        let road = TimelineItem(id: "t-road", time: "3:44 PM", text: "Marina Blvd closed, Lyon St to Laguna St",
                                source: sfmta, severity: .moderate, alertID: roadClosureID)
        switch scenario {
        case .crisis:
            return [road, collapse, quake]
        case .escalated:
            let shelters = TimelineItem(id: "t-shelters", time: "3:45 PM", text: "Two shelters open, Hamilton takes pets",
                                        source: emergencyManagement, severity: .moderate, alertID: sheltersID)
            let order = TimelineItem(id: "t-order", time: "3:43 PM", text: "Evacuation Order for the Marina District",
                                     source: emergencyManagement, severity: .extreme, alertID: orderID)
            return [shelters, road, order]
        case .calm:
            return []
        }
    }

    // MARK: Shelters

    static let hamiltonID = "shelter-hamilton-recreation-center"

    static let shelters: [Shelter] = [
        Shelter(id: hamiltonID, name: "Hamilton Recreation Center", address: "1900 Geary Boulevard",
                latitude: 37.7823, longitude: -122.4357, capacity: 250, spacesAvailable: 180,
                animalPolicy: "Pets in crates", takesPets: true, checkedAt: "3:45 PM", needsReconfirming: true),
        Shelter(id: "shelter-kezar-pavilion", name: "Kezar Pavilion", address: "755 Stanyan Street",
                latitude: 37.7676, longitude: -122.4546, capacity: 400, spacesAvailable: 390,
                animalPolicy: "Service animals only", takesPets: false, checkedAt: "3:45 PM", needsReconfirming: true),
        Shelter(id: "shelter-moscone-center-west", name: "Moscone Center West", address: "800 Howard Street",
                latitude: 37.7840, longitude: -122.4004, capacity: 1000, spacesAvailable: 1000,
                animalPolicy: "Pets allowed", takesPets: true, checkedAt: "3:45 PM", needsReconfirming: true,
                isOpen: false, statusText: "Opens 6:00 PM"),
    ]

    // MARK: Household

    static let members: [HouseholdMember] = [
        HouseholdMember(id: "maya", name: "Maya", role: "Parent", status: .onMyWay, isYou: true),
        HouseholdMember(id: "daniel", name: "Daniel", role: "Parent", status: .atMeetingPoint, lastUpdate: "2:05 PM"),
        HouseholdMember(id: "rosa", name: "Rosa", role: "Grandparent", status: .checkingIn),
        HouseholdMember(id: "leo", name: "Leo", role: "Child", status: .awaiting, lastUpdate: "45 min ago"),
    ]

    // MARK: More

    static let followedTopics: [FollowedTopic] = [
        FollowedTopic(id: "follow-marina", title: "Marina District evacuations", trigger: "Evacuation changes", channel: "Phone call"),
        FollowedTopic(id: "follow-calhacks", title: "Is everyone at the Palace of Fine Arts OK?", trigger: "When officials answer", channel: "Phone call"),
    ]

    static let calls: [CallRecord] = [
        CallRecord(id: "call-1", topic: "Marina Earthquake", date: "Today, 3:42 PM", duration: "4 min",
                   language: "English", summary: "Asked what happened. Asked to be called back with news about the Marina District."),
        CallRecord(id: "call-2", topic: "Shelters near the Marina", date: "Oct 22", duration: "3 min",
                   language: "English", summary: "Asked about shelters that take pets."),
    ]

    static let activity: [ActivityItem] = [
        ActivityItem(id: "a-1", title: "Evacuation Order for the Marina District", detail: emergencyManagement,
                     time: "3:43 PM", systemImage: "exclamationmark.triangle"),
        ActivityItem(id: "a-2", title: "Two shelters are open", detail: emergencyManagement,
                     time: "3:45 PM", systemImage: "house"),
        ActivityItem(id: "a-3", title: "Your question was saved", detail: "Is everyone at the Palace of Fine Arts OK?",
                     time: "3:42 PM", systemImage: "clock"),
    ]

    static let checklist: [ChecklistItem] = [
        ChecklistItem(id: "c-1", title: "Water for 3 days", isDone: true),
        ChecklistItem(id: "c-2", title: "Medicine and copies of prescriptions", isDone: true),
        ChecklistItem(id: "c-3", title: "Phone chargers and a battery pack", isDone: true),
        ChecklistItem(id: "c-4", title: "Important documents in a bag", isDone: true),
        ChecklistItem(id: "c-5", title: "Flashlight and spare batteries", isDone: true),
        ChecklistItem(id: "c-6", title: "Whistle to signal for help", isDone: false),
        ChecklistItem(id: "c-7", title: "Pet carrier, food and leash", isDone: false),
        ChecklistItem(id: "c-8", title: "Cash in small bills", isDone: false),
        ChecklistItem(id: "c-9", title: "Printed list of phone numbers", isDone: false),
        ChecklistItem(id: "c-10", title: "Change of clothes and sturdy shoes", isDone: false),
        ChecklistItem(id: "c-11", title: "Know two ways out of your area", isDone: false),
        ChecklistItem(id: "c-12", title: "Agree on a household meeting point", isDone: false),
    ]

    /// Things a caller asked Soterra to remember by voice (backend: callers.profileNeeds, at most 5).
    static let savedNeeds = ["I have two dogs", "I don't drive"]
}
