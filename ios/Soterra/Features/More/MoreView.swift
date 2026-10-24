import SwiftUI

/// Activity, history, following, preparedness, settings, the hotline, and the demo controls.
struct MoreView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL

    var body: some View {
        @Bindable var model = model

        List {
            Section {
                row(.activity, "bell", "Activity", "Evacuation Warning for SON-3A and SON-3B · 1:45 PM", badge: 3)
                row(.callHistory, "phone", "Call history", "Last call today, 1:58 PM")
                row(.following, "list.bullet", "Updates I'm following",
                    "\(model.followedTopics.filter(\.isActive).count) active · end after 24 hours")
                row(.checklist, "checklist", "Preparedness checklist",
                    "\(model.checklist.filter(\.isDone).count) of \(model.checklist.count) done")
            }

            Section {
                row(.language, "globe", "Language", model.language.label)
                row(.privacy, "lock", "Privacy", "Transcripts \(model.savesTranscripts ? "on" : "off") · Delete my data")
                row(.settings, "circle.lefthalf.filled", "Appearance", model.appearance.label)
                row(.about, "info.circle", "About Soterra", nil)
            }

            Section("Hotline") {
                Button {
                    openURL(DemoConfig.hotlineURL)
                } label: {
                    ListRow(systemImage: "phone.fill", title: DemoConfig.hotlineDisplay,
                            subtitle: "Soterra hotline · English · Español · 24/7", showsChevron: false)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Calls the Soterra hotline")
                .listRowBackground(Palette.surface)
            }

            Section {
                Picker("Home shows", selection: $model.scenario) {
                    ForEach(HomeScenario.allCases) { scenario in
                        Text(scenario.label).tag(scenario)
                    }
                }
                .listRowBackground(Palette.surface)
                Toggle("Offline", isOn: $model.isOffline)
                    .listRowBackground(Palette.surface)
            } header: {
                Text("Demo controls")
            } footer: {
                Text("Demo data only. This build does not connect to the live backend.")
            }

            Section {
                TrustFooter()
                    .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle("More")
        .soterraToolbar()
    }

    private func row(_ route: Route, _ systemImage: String, _ title: String, _ subtitle: String?,
                     badge: Int? = nil) -> some View {
        NavigationLink(value: route) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .foregroundStyle(Palette.accent)
                    .frame(width: 24)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(Palette.textPrimary)
                    if let subtitle {
                        Text(subtitle)
                            .font(.footnote)
                            .foregroundStyle(Palette.textSecondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                if let badge {
                    Text("\(badge)")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(Palette.onAccent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Palette.accent, in: Capsule())
                        .accessibilityLabel("\(badge) new")
                }
            }
            .frame(minHeight: 44)
        }
        .listRowBackground(Palette.surface)
    }
}
