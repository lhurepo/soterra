import SwiftUI

/// Activity, history, following, preparedness, settings, the hotline, and the demo controls.
struct MoreView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL

    var body: some View {
        @Bindable var model = model

        List {
            Section {
                row(.activity, "bell", "Activity", "Evacuation Order for the Marina District · 3:43 PM", badge: 3)
                row(.callHistory, "phone", "Call history", "Last call today, 3:42 PM")
                row(.following, "list.bullet", "Updates I'm following",
                    "\(model.followedTopics.filter(\.isActive).count) active · end after 24 hours")
                row(.checklist, "checklist", "Preparedness checklist",
                    "\(model.checklist.filter(\.isDone).count) of \(model.checklist.count) done")
            }

            Section {
                Toggle(isOn: $model.isSimpleMode) {
                    settingLabel("textformat.size", "Simple mode", "Bigger text, only the essentials")
                }
                .frame(minHeight: 44)
                .listRowBackground(Palette.surface)
            }

            Section {
                row(.area, "mappin.and.ellipse", "Area", DemoData.areaName)
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
                Toggle("Use live backend data", isOn: $model.useLiveData)
                    .listRowBackground(Palette.surface)
                    .onChange(of: model.useLiveData) { _, isOn in
                        if isOn { Task { await model.refresh() } }
                    }
            } header: {
                Text("Demo controls")
            } footer: {
                Text(model.isShowingLive
                     ? "Showing the latest alerts from the Soterra backend. The scenario picker only applies to demo data."
                     : "Showing demo data. Turn on live data to load alerts from the Soterra backend.")
            }

            Section {
                TrustFooter()
                    .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .screenBackground()
        .soterraToolbar()
    }

    private func row(_ route: Route, _ systemImage: String, _ title: String, _ subtitle: String?,
                     badge: Int? = nil) -> some View {
        NavigationLink(value: route) {
            HStack(spacing: 12) {
                settingLabel(systemImage, title, subtitle)
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

    private func settingLabel(_ systemImage: String, _ title: String, _ subtitle: String?) -> some View {
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
        }
    }
}
