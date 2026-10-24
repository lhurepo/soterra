import Foundation

/// Turns the backend's bulletins into the app's `HazardAlert` and `TimelineItem` values.
enum LiveAlerts {
    static func alerts(from state: AppStateResponse, calendar: Calendar = .current, now: Date = .now) -> [HazardAlert] {
        state.alerts.map { alert(from: $0, calendar: calendar, now: now) }
    }

    static func alert(from b: BackendAlert, calendar: Calendar = .current, now: Date = .now) -> HazardAlert {
        let severity = Severity(rawValue: b.severity) ?? .unknown
        let hazard = HazardType(backend: b.hazardType)
        let kind = kind(for: b.title, hazard: hazard)
        let issued = Date(timeIntervalSince1970: b.issuedAt / 1000)
        var times = [TimeMark(label: "Issued", value: clock(issued, calendar: calendar, now: now))]
        var changeNote: String?
        if let updatedAt = b.updatedAt, updatedAt > b.issuedAt {
            let updated = Date(timeIntervalSince1970: updatedAt / 1000)
            times.append(TimeMark(label: "Updated", value: clock(updated, calendar: calendar, now: now), isHighlighted: true))
            changeNote = "Updated \(clock(updated, calendar: calendar, now: now))"
        }
        if let expiresAt = b.expiresAt {
            let until = Date(timeIntervalSince1970: expiresAt / 1000)
            times.append(TimeMark(label: "Until", value: clock(until, calendar: calendar, now: now)))
        }
        times.append(TimeMark(label: "Now", value: clock(now, calendar: calendar, now: now)))
        let firstSentence = b.body.split(whereSeparator: { ".!?".contains($0) }).first.map(String.init) ?? b.body
        return HazardAlert(
            id: b.id, severity: severity, kind: kind, hazard: hazard,
            title: b.title,
            headline: b.title,
            instruction: firstSentence.trimmingCharacters(in: .whitespacesAndNewlines),
            area: b.areaLabels.isEmpty ? "Area not listed" : b.areaLabels.joined(separator: ", "),
            details: b.body,
            times: times,
            source: SourceInfo(name: b.sourceName, isOfficial: true),
            changeNote: changeNote
        )
    }

    static func timeline(from state: AppStateResponse, calendar: Calendar = .current, now: Date = .now) -> [TimelineItem] {
        state.alerts
            .sorted { ($0.updatedAt ?? $0.issuedAt) > ($1.updatedAt ?? $1.issuedAt) }
            .map { b in
                let when = Date(timeIntervalSince1970: (timeOf(b)) / 1000)
                return TimelineItem(id: "t-\(b.id)", time: clock(when, calendar: calendar, now: now), text: b.title,
                                    source: b.sourceName, severity: Severity(rawValue: b.severity) ?? .unknown, alertID: b.id)
            }
    }

    private static func timeOf(_ b: BackendAlert) -> Double { b.updatedAt ?? b.issuedAt }

    static func kind(for title: String, hazard: HazardType) -> AlertKind {
        let t = title.lowercased()
        if t.contains("order") { return .order }
        if t.contains("warning") { return .warning }
        if t.contains("watch") || t.contains("advisory") { return .advisory }
        if hazard == .roadClosure || t.contains("closure") || t.contains("closed") { return .closure }
        if t.contains("update") { return .update }
        return .info
    }

    /// "2:45 PM" for today, "Nov 15, 8 PM" for another day.
    static func clock(_ date: Date, calendar: Calendar, now: Date) -> String {
        let style: Date.FormatStyle = calendar.isDate(date, inSameDayAs: now)
            ? .dateTime.hour().minute()
            : .dateTime.month(.abbreviated).day().hour().minute()
        return date.formatted(style.locale(Locale(identifier: "en_US")))
    }
}
