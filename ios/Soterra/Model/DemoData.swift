import Foundation

/// Fictional Ridgeview Fire data, taken from fixtures/normalized/ridgeview-*.json (times in Pacific time).
/// Every source name ends in "(Demo)" so nothing can be mistaken for a real bulletin.
enum DemoData {
    static let emergencyManagement = "Sonoma County Emergency Management (Demo)"
    static let fireInformation = "Sonoma County Fire Information (Demo)"
    static let weatherService = "National Weather Service (Demo)"
    static let caltrans = "Caltrans District 4 (Demo)"

    /// The one area the demo covers (More → Area).
    static let areaName = "Sonoma County, CA"

    // MARK: Alerts

    static let warningID = "ridgeview-evacuation-warning"
    static let orderID = "ridgeview-evacuation-order-son-3a"
    static let fireUpdateID = "ridgeview-fire-update"
    static let sheltersID = "ridgeview-shelters"
    static let roadClosureID = "ridgeview-road-closure"
    static let redFlagID = "sonoma-red-flag-warning"

    private static let evacuationSteps: [ActionStep] = [
        ActionStep(id: "pack", text: "Pack medicine, documents and chargers", systemImage: "shippingbox"),
        ActionStep(id: "extra-time", text: "Leave now if you need extra time, have pets or livestock, or have no car",
                   systemImage: "figure.walk"),
        ActionStep(id: "meet", text: "Agree on a meeting point with your household", systemImage: "person.2"),
        ActionStep(id: "road", text: "Avoid Ridgeview Road (closed)", systemImage: "road.lanes"),
    ]

    static let evacuationWarning = HazardAlert(
        id: warningID, severity: .severe, kind: .warning, hazard: .evacuation,
        title: "Evacuation Warning",
        headline: "Evacuation Warning. Be ready to leave.",
        instruction: "Be ready to leave.",
        area: "Zones SON-3A and SON-3B, east of Santa Rosa",
        details: "An Evacuation Warning is in effect for zones SON-3A and SON-3B near the Ridgeview Fire. "
            + "Zone SON-3A covers Ridgeview Road from Highway 12 to Bennett Valley Road. "
            + "Zone SON-3B covers the Matanzas Creek area.",
        times: [TimeMark(label: "Issued", value: "1:45 PM"), TimeMark(label: "Now", value: "2:42 PM")],
        source: SourceInfo(name: emergencyManagement, corroboratedBy: [fireInformation]),
        steps: evacuationSteps
    )

    static let evacuationOrder = HazardAlert(
        id: orderID, severity: .extreme, kind: .order, hazard: .evacuation,
        title: "Evacuation Order",
        headline: "Evacuation Order. Leave now.",
        instruction: "Leave now.",
        area: "Zone SON-3A. SON-3B remains under a Warning.",
        details: "An Evacuation Order is now in effect for zone SON-3A near the Ridgeview Fire. "
            + "Zone SON-3A covers Ridgeview Road from Highway 12 to Bennett Valley Road. People in zone SON-3A must leave now. "
            + "The Evacuation Warning remains in effect for zone SON-3B, the Matanzas Creek area.",
        times: [
            TimeMark(label: "Issued", value: "1:45 PM"),
            TimeMark(label: "Changed", value: "6:20 PM", isHighlighted: true),
            TimeMark(label: "Now", value: "6:24 PM"),
        ],
        source: SourceInfo(name: emergencyManagement, corroboratedBy: [fireInformation]),
        changeNote: "Changed from Warning at 6:20 PM",
        steps: [
            ActionStep(id: "leave", text: "Leave zone SON-3A now", systemImage: "figure.walk"),
            ActionStep(id: "route", text: "Use Highway 12 or Bennett Valley Road, not Ridgeview Road", systemImage: "road.lanes"),
            ActionStep(id: "shelter", text: "Go to an open shelter or your meeting point", systemImage: "house"),
        ]
    )

    static let fireUpdate = HazardAlert(
        id: fireUpdateID, severity: .severe, kind: .update, hazard: .wildfire,
        title: "Ridgeview Fire update",
        headline: "About 1,200 acres, 10% contained.",
        instruction: "Firefighters are working to stop the fire spreading west toward Bennett Valley.",
        area: "East of Santa Rosa",
        details: "The Ridgeview Fire is burning about 1,200 acres east of Santa Rosa and is 10 percent contained. "
            + "It started at about noon on October 24. The cause is under investigation.",
        times: [
            TimeMark(label: "Issued", value: "12:30 PM"),
            TimeMark(label: "Updated", value: "2:10 PM"),
            TimeMark(label: "Now", value: "2:42 PM"),
        ],
        source: SourceInfo(name: fireInformation, corroboratedBy: [emergencyManagement])
    )

    static let shelterBulletin = HazardAlert(
        id: sheltersID, severity: .moderate, kind: .info, hazard: .shelter,
        title: "Evacuation shelters",
        headline: "Two shelters are open.",
        instruction: "Ridgeview Community Center takes pets in crates. Santa Rosa Veterans Building takes service animals only.",
        area: "Ridgeview Community Center and Santa Rosa Veterans Building",
        details: "Both shelters have water, cots and phone charging.",
        times: [TimeMark(label: "Issued", value: "2:00 PM"), TimeMark(label: "Checked", value: "2:30 PM")],
        source: SourceInfo(name: emergencyManagement)
    )

    static let roadClosure = HazardAlert(
        id: roadClosureID, severity: .moderate, kind: .closure, hazard: .roadClosure,
        title: "Road closure",
        headline: "Ridgeview Road is closed both ways.",
        instruction: "Use Highway 12 or Bennett Valley Road instead.",
        area: "Between Highway 12 and Bennett Valley Road",
        details: "Ridgeview Road is closed in both directions between Highway 12 and Bennett Valley Road because of fire activity.",
        times: [TimeMark(label: "Issued", value: "1:15 PM")],
        source: SourceInfo(name: caltrans)
    )

    static let redFlagWarning = HazardAlert(
        id: redFlagID, severity: .severe, kind: .warning, hazard: .wildfire,
        title: "Red Flag Warning",
        headline: "Red Flag Warning until Nov 15, 8 PM.",
        instruction: "Any fire will spread quickly. Avoid anything that could start one.",
        area: "Sonoma County interior valleys and hills",
        details: "Gusty northeast winds of 25 to 35 mph and very low humidity will cause any fire to spread quickly.",
        times: [TimeMark(label: "Issued", value: "8:00 AM"), TimeMark(label: "Until", value: "Nov 15, 8 PM")],
        source: SourceInfo(name: weatherService)
    )

    static let allAlerts: [HazardAlert] = [
        evacuationOrder, evacuationWarning, fireUpdate, redFlagWarning, shelterBulletin, roadClosure,
    ]

    static func alerts(for scenario: HomeScenario) -> [HazardAlert] {
        switch scenario {
        case .crisis: [evacuationWarning, fireUpdate, redFlagWarning, shelterBulletin, roadClosure]
        case .escalated: [evacuationOrder, fireUpdate, redFlagWarning, shelterBulletin, roadClosure]
        case .calm: []
        }
    }

    static func alert(id: HazardAlert.ID) -> HazardAlert? {
        allAlerts.first { $0.id == id }
    }

    // MARK: Today

    static func today(for scenario: HomeScenario) -> [TimelineItem] {
        let shelters = TimelineItem(id: "t-shelters", time: "2:30 PM", text: "Two shelters open, one takes pets",
                                    source: emergencyManagement, severity: .moderate, alertID: sheltersID)
        let fire = TimelineItem(id: "t-fire", time: "2:10 PM", text: "Fire about 1,200 acres, 10% contained",
                                source: fireInformation, severity: .severe, alertID: fireUpdateID)
        let road = TimelineItem(id: "t-road", time: "1:15 PM", text: "Ridgeview Rd closed, Hwy 12 to Bennett Valley Rd",
                                source: caltrans, severity: .moderate, alertID: roadClosureID)
        switch scenario {
        case .crisis:
            return [shelters, fire, road]
        case .escalated:
            let order = TimelineItem(id: "t-order", time: "6:20 PM", text: "Evacuation Order for zone SON-3A",
                                     source: emergencyManagement, severity: .extreme, alertID: orderID)
            return [order, shelters, fire]
        case .calm:
            return []
        }
    }

    // MARK: Shelters

    static let ridgeviewCenterID = "shelter-ridgeview-community-center"

    static let shelters: [Shelter] = [
        Shelter(id: ridgeviewCenterID, name: "Ridgeview Community Center", address: "500 Elm Street",
                latitude: 38.4418, longitude: -122.6905, capacity: 200, spacesAvailable: 120,
                animalPolicy: "Pets in crates", takesPets: true, checkedAt: "2:30 PM", needsReconfirming: true),
        Shelter(id: "shelter-santa-rosa-veterans-building", name: "Santa Rosa Veterans Building", address: "1351 Maple Avenue",
                latitude: 38.4352, longitude: -122.6990, capacity: 300, spacesAvailable: 210,
                animalPolicy: "Service animals only", takesPets: false, checkedAt: "2:30 PM", needsReconfirming: true),
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
        FollowedTopic(id: "follow-ridgeview", title: "Ridgeview Fire evacuations", trigger: "Evacuation changes", channel: "Phone call"),
        FollowedTopic(id: "follow-hillcrest", title: "Is Hillcrest Elementary a shelter?", trigger: "When officials answer", channel: "Phone call"),
    ]

    static let calls: [CallRecord] = [
        CallRecord(id: "call-1", topic: "Ridgeview Fire evacuation zones", date: "Today, 1:58 PM", duration: "4 min",
                   language: "English", summary: "Asked which zones are under the Warning. Followed evacuation changes."),
        CallRecord(id: "call-2", topic: "Shelters near Santa Rosa", date: "Oct 22", duration: "3 min",
                   language: "English", summary: "Asked about shelters that take pets."),
    ]

    static let activity: [ActivityItem] = [
        ActivityItem(id: "a-1", title: "Evacuation Warning for SON-3A and SON-3B", detail: emergencyManagement,
                     time: "1:45 PM", systemImage: "exclamationmark.triangle"),
        ActivityItem(id: "a-2", title: "Two shelters are open", detail: emergencyManagement,
                     time: "2:30 PM", systemImage: "house"),
        ActivityItem(id: "a-3", title: "Your question was saved", detail: "Is Hillcrest Elementary open as a shelter?",
                     time: "2:12 PM", systemImage: "clock"),
    ]

    static let checklist: [ChecklistItem] = [
        ChecklistItem(id: "c-1", title: "Water for 3 days", isDone: true),
        ChecklistItem(id: "c-2", title: "Medicine and copies of prescriptions", isDone: true),
        ChecklistItem(id: "c-3", title: "Phone chargers and a battery pack", isDone: true),
        ChecklistItem(id: "c-4", title: "Important documents in a bag", isDone: true),
        ChecklistItem(id: "c-5", title: "Flashlight and spare batteries", isDone: true),
        ChecklistItem(id: "c-6", title: "N95 masks for smoke", isDone: false),
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
