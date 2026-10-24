import SwiftUI

/// One alert: what it says, what to do, the zones, and its official source.
struct AlertDetailView: View {
    @Environment(AppModel.self) private var model
    let alertID: HazardAlert.ID

    @State private var isShowingZoneInfo = false
    @State private var isShowingSourceInfo = false

    var body: some View {
        Group {
            if let alert = DemoData.alert(id: alertID) {
                content(for: alert)
            } else {
                ContentUnavailableView("This alert is no longer active", systemImage: "bell.slash")
                    .screenBackground()
            }
        }
        .soterraToolbar(showsArea: false)
    }

    private func content(for alert: HazardAlert) -> some View {
        let tone = CardTone.severity(alert.severity.level)
        return ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SeverityChip(severity: alert.severity, text: alert.chipText)

                VStack(alignment: .leading, spacing: 10) {
                    if let note = alert.changeNote {
                        Label(note, systemImage: "clock")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(tone.note)
                    }
                    Text(alert.instruction)
                        .font(.display(24, relativeTo: .title2))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(alert.details)
                        .font(.subheadline)
                        .foregroundStyle(tone.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    TimeStrip(marks: model.displayTimes(for: alert), tone: tone)
                        .padding(.top, 4)
                }
                .tintedCard(tone, emphasized: alert.changeNote != nil)

                if !alert.steps.isEmpty {
                    SectionHeader(title: "What to do")
                    VStack(spacing: 0) {
                        ForEach(alert.steps) { step in
                            ListRow(systemImage: step.systemImage, title: step.text, showsChevron: false)
                                .padding(.horizontal, 16)
                            if step.id != alert.steps.last?.id { Divider().overlay(Palette.separator) }
                        }
                    }
                    .surfaceCard(padding: 0)
                }

                if alert.hazard == .evacuation {
                    SectionHeader(title: "Your zone")
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Soterra can't tell you if an address is inside a zone.")
                            .foregroundStyle(Palette.textPrimary)
                        Button("Open the official zone lookup") { isShowingZoneInfo = true }
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Palette.accent)
                            .frame(minHeight: 44)
                    }
                    .surfaceCard()
                }

                SectionHeader(title: "Source")
                Button {
                    isShowingSourceInfo = true
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        ListRow(systemImage: "building.columns", title: alert.source.name,
                                subtitle: alert.times.last.map { "\($0.label) \($0.value)" })
                        if !alert.source.corroboratedBy.isEmpty {
                            Label("Also reported by \(ListFormatter.localizedString(byJoining: alert.source.corroboratedBy))",
                                  systemImage: "checkmark.seal")
                                .font(.caption)
                                .foregroundStyle(Palette.textSecondary)
                                .padding(.leading, 36)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, alert.source.corroboratedBy.isEmpty ? 0 : 12)
                }
                .buttonStyle(.plain)
                .surfaceCard(padding: 0)

                TrustFooter()
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
        }
        .screenBackground()
        .navigationTitle(alert.title)
        .navigationBarTitleDisplayMode(.large)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            BottomActionBar {
                Button {
                    model.toggleFollow(alert)
                } label: {
                    Label(model.isFollowing(alert) ? "Following" : "Follow updates",
                          systemImage: model.isFollowing(alert) ? "bell.fill" : "bell")
                }
                .buttonStyle(FilledButtonStyle())

                Button {
                    model.showZonesOnMap()
                } label: {
                    Label("Show on map", systemImage: "map")
                }
                .buttonStyle(OutlineButtonStyle())
            }
        }
        .alert("Official zone lookup", isPresented: $isShowingZoneInfo) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("In the live app this opens the county's official zone lookup. The zones in this demo are fictional.")
        }
        .alert(alert.source.name, isPresented: $isShowingSourceInfo) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Official source. In the live app this opens the original bulletin. This demo bulletin is fictional.")
        }
    }
}
