import SwiftUI

/// Shared list styling for the More screens.
private extension View {
    func moreListStyle(title: String) -> some View {
        scrollContentBackground(.hidden)
            .screenBackground()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .soterraToolbar(showsArea: false)
    }
}

struct ActivityView: View {
    var body: some View {
        List(DemoData.activity) { item in
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: item.systemImage)
                    .foregroundStyle(Palette.accent)
                    .frame(width: 24)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).foregroundStyle(Palette.textPrimary)
                    Text(item.detail).font(.footnote).foregroundStyle(Palette.textSecondary)
                }
                Spacer(minLength: 8)
                Text(item.time).font(.footnote).monospacedDigit().foregroundStyle(Palette.textSecondary)
            }
            .padding(.vertical, 4)
            .listRowBackground(Palette.surface)
        }
        .moreListStyle(title: "Activity")
    }
}

struct CallHistoryView: View {
    var body: some View {
        List(DemoData.calls) { call in
            VStack(alignment: .leading, spacing: 4) {
                Text(call.topic).font(.headline).foregroundStyle(Palette.textPrimary)
                Text("\(call.date) · \(call.duration) · \(call.language)")
                    .font(.footnote)
                    .foregroundStyle(Palette.textSecondary)
                Text(call.summary).font(.subheadline).foregroundStyle(Palette.textPrimary)
            }
            .padding(.vertical, 4)
            .listRowBackground(Palette.surface)
        }
        .moreListStyle(title: "Call history")
    }
}

struct FollowingView: View {
    @Environment(AppModel.self) private var model
    @State private var isConfirmingStopAll = false

    var body: some View {
        @Bindable var model = model

        List {
            Section {
                ForEach($model.followedTopics) { $topic in
                    Toggle(isOn: $topic.isActive) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(topic.title).foregroundStyle(Palette.textPrimary)
                            Text("\(topic.trigger) · \(topic.channel)")
                                .font(.footnote)
                                .foregroundStyle(Palette.textSecondary)
                        }
                    }
                    .listRowBackground(Palette.surface)
                }
            } footer: {
                Text("Updates end after 24 hours. You can also say \"stop updates\" on a call.")
            }
            Section {
                Button("Stop all updates", role: .destructive) { isConfirmingStopAll = true }
                    .listRowBackground(Palette.surface)
            }
        }
        .moreListStyle(title: "Updates I'm following")
        .confirmationDialog("Stop all updates?", isPresented: $isConfirmingStopAll, titleVisibility: .visible) {
            Button("Stop all updates", role: .destructive) { model.stopAllUpdates() }
        } message: {
            Text("Soterra will stop calling you about every topic you follow.")
        }
    }
}

struct ChecklistView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model

        List {
            Section {
                ForEach($model.checklist) { $item in
                    Button {
                        item.isDone.toggle()
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: item.isDone ? "checkmark.circle.fill" : "circle")
                                .font(.title3)
                                .foregroundStyle(item.isDone ? Palette.accent : Palette.textSecondary)
                            Text(item.title)
                                .foregroundStyle(Palette.textPrimary)
                                .strikethrough(item.isDone, color: Palette.textSecondary)
                        }
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(item.isDone ? .isSelected : [])
                    .listRowBackground(Palette.surface)
                }
            } header: {
                Text("\(model.checklist.filter(\.isDone).count) of \(model.checklist.count) done")
            }
        }
        .moreListStyle(title: "Preparedness checklist")
    }
}

struct LanguageView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model

        List {
            Section {
                Picker("Language", selection: $model.language) {
                    ForEach(AppLanguage.allCases) { language in
                        Text(language.label).tag(language)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
                .listRowBackground(Palette.surface)
            } footer: {
                Text("Sets the language Soterra uses when it calls you. The demo app's text is in English.")
            }
        }
        .moreListStyle(title: "Language")
    }
}

struct PrivacyView: View {
    @Environment(AppModel.self) private var model
    @State private var isConfirmingForget = false
    @State private var isConfirmingDelete = false

    var body: some View {
        @Bindable var model = model

        List {
            Section {
                Toggle("Save call transcripts", isOn: $model.savesTranscripts)
                    .listRowBackground(Palette.surface)
            } footer: {
                Text("Off: Soterra keeps only a short summary of each call. Transcripts are deleted after 7 days.")
            }

            Section {
                if model.savedNeeds.isEmpty {
                    Text("Nothing saved")
                        .foregroundStyle(Palette.textSecondary)
                        .listRowBackground(Palette.surface)
                } else {
                    ForEach(model.savedNeeds, id: \.self) { need in
                        Label(need, systemImage: "heart.text.square")
                            .foregroundStyle(Palette.textPrimary)
                            .listRowBackground(Palette.surface)
                    }
                }
                Button("Forget me", role: .destructive) { isConfirmingForget = true }
                    .listRowBackground(Palette.surface)
            } header: {
                Text("Saved needs")
            } footer: {
                Text("Things you asked Soterra to remember on a call, like \"I use a wheelchair\". Up to 5.")
            }

            Section {
                Button("Delete my data", role: .destructive) { isConfirmingDelete = true }
                    .listRowBackground(Palette.surface)
            } footer: {
                Text("No tracking. Location is used only if you allow it.")
            }
        }
        .moreListStyle(title: "Privacy")
        .confirmationDialog("Forget me?", isPresented: $isConfirmingForget, titleVisibility: .visible) {
            Button("Delete and stop updates", role: .destructive) { model.forgetMe() }
        } message: {
            Text("Deletes what Soterra saved about your number and stops all updates.")
        }
        .confirmationDialog("Delete my data?", isPresented: $isConfirmingDelete, titleVisibility: .visible) {
            Button("Delete my data", role: .destructive) { model.forgetMe() }
        } message: {
            Text("Deletes saved needs and follows. Call transcripts are removed within a week.")
        }
    }
}

struct AppearanceSettingsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model

        List {
            Section {
                Picker("Appearance", selection: $model.appearance) {
                    ForEach(Appearance.allCases) { appearance in
                        Text(appearance.label).tag(appearance)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
                .listRowBackground(Palette.surface)
            } footer: {
                Text("Light is the default. Larger text follows your iPhone's text size setting.")
            }
        }
        .moreListStyle(title: "Appearance")
    }
}

struct AboutView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("soterra")
                    .font(.display(40, relativeTo: .largeTitle))
                    .foregroundStyle(Palette.textPrimary)
                    .accessibilityLabel("Soterra")
                Text("Soterra answers questions about emergencies only from official, timestamped bulletins. "
                     + "Every answer names its source and time. When it doesn't know, it says so and saves your question.")
                    .foregroundStyle(Palette.textPrimary)
                Text("Anyone can call \(DemoConfig.hotlineDisplay) from any phone. The app adds alerts, a map and household check-ins.")
                    .foregroundStyle(Palette.textPrimary)
                Text("This build uses fictional demo data. Every source ending in \"(Demo)\" is made up.")
                    .font(.footnote)
                    .foregroundStyle(Palette.textSecondary)
                TrustFooter()
            }
            .padding(16)
        }
        .screenBackground()
        .navigationTitle("About Soterra")
        .navigationBarTitleDisplayMode(.inline)
        .soterraToolbar(showsArea: false)
    }
}
