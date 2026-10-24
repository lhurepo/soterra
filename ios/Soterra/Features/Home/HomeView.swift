import SwiftUI

/// Home: in one glance, what is happening, how fresh it is, and the next step. Calling or asking Soterra is
/// always one tap away in the bar above the tabs.
struct HomeView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let alert = model.topAlert {
                    AlertCard(
                        alert: alert,
                        times: model.displayTimes(for: alert),
                        isEmphasized: alert.changeNote != nil,
                        onWhatToDo: { model.homePath.append(.alert(alert.id)) },
                        onAsk: askAction(about: alert)
                    )
                    CallSoterraCard()
                    nextSteps
                    today
                } else {
                    calmCard
                    CallSoterraCard()
                    following
                    recentCalls
                }
                TrustFooter()
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
        }
        .screenBackground()
        .navigationTitle(model.homeTitle)
        .soterraToolbar()
        .safeAreaInset(edge: .top, spacing: 0) {
            if model.isOffline { OfflineBanner() }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            CallBar { model.homePath.append(.assistant(topic: nil)) }
        }
    }

    /// Asking needs a connection; offline, the card offers only "What to do" and the call bar.
    private func askAction(about alert: HazardAlert) -> (() -> Void)? {
        guard !model.isOffline else { return nil }
        return { model.homePath.append(.assistant(topic: alert.title)) }
    }

    private var nextSteps: some View {
        let household = model.householdSummary
        return HStack(alignment: .top, spacing: 8) {
            ActionTile(title: "Find a shelter", systemImage: "house",
                       detail: "\(DemoData.shelters.count) open · checked 2:30 PM") {
                model.showShelters()
            }
            ActionTile(title: "Household", systemImage: "person.2",
                       detail: household.text, detailNeedsAttention: household.needsAttention) {
                model.selectedTab = .household
            }
        }
    }

    private var today: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(title: model.isOffline ? "Saved at \(DemoConfig.lastSyncTime)" : "Today",
                          actionTitle: "Following · \(model.newUpdateCount) new") {
                model.showFollowing()
            }
            Divider().overlay(Palette.separator)
            ForEach(model.todayItems) { item in
                Button {
                    if let id = item.alertID { model.homePath.append(.alert(id)) }
                } label: {
                    TimelineRow(item: item)
                }
                .buttonStyle(.plain)
                Divider().overlay(Palette.separator)
            }
        }
    }

    private var calmCard: some View {
        let tone = CardTone.calm
        return VStack(alignment: .leading, spacing: 10) {
            StatusChip(text: "No active alerts", systemImage: "checkmark", fill: Palette.sage, ink: Palette.abyss)
            Text("No active official alerts for Sonoma County.")
                .font(.display(24, relativeTo: .title2))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            TimeStrip(marks: [
                TimeMark(label: "Last checked", value: "2:14 PM"),
                TimeMark(label: "Sources", value: "4 official"),
            ], tone: tone)
            .padding(.top, 4)
            Text("National Weather Service · Sonoma County EM · Caltrans D4 · CAL FIRE")
                .font(.caption)
                .foregroundStyle(tone.secondary)
        }
        .tintedCard(tone)
    }

    private var following: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Following", actionTitle: "Manage") {
                model.push(.following, on: .more)
            }
            VStack(spacing: 0) {
                ForEach(model.followedTopics) { topic in
                    ListRow(systemImage: topic.isActive ? "bell" : "bell.slash", title: topic.title,
                            subtitle: topic.isActive ? "\(topic.trigger) · \(topic.channel)" : "Stopped",
                            showsChevron: false)
                        .padding(.horizontal, 16)
                    if topic.id != model.followedTopics.last?.id { Divider().overlay(Palette.separator) }
                }
            }
            .surfaceCard(padding: 0)
        }
    }

    private var recentCalls: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Recent calls", actionTitle: "See all") {
                model.push(.callHistory, on: .more)
            }
            if let call = DemoData.calls.first {
                Button {
                    model.push(.callHistory, on: .more)
                } label: {
                    ListRow(systemImage: "phone", title: call.topic,
                            subtitle: "\(call.date) · \(call.duration) · \(call.language)")
                        .padding(.horizontal, 16)
                }
                .buttonStyle(.plain)
                .surfaceCard(padding: 0)
            }
        }
    }
}
