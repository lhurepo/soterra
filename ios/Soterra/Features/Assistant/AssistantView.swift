import SwiftUI

/// Ask Soterra in the app. Answers come only from official sources, each with its source and time; when
/// nothing official exists, the reply is "I don't know yet" and the question is saved.
struct AssistantView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let topic: String?

    @State private var messages: [ChatMessage] = []
    @State private var draft = ""
    @State private var isChecking = false
    @State private var notifiedMessageIDs: Set<ChatMessage.ID> = []
    @FocusState private var isComposerFocused: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    header
                    ForEach(messages) { message in
                        bubble(for: message).id(message.id)
                    }
                    if isChecking {
                        Label("Checking official sources…", systemImage: "magnifyingglass")
                            .font(.footnote)
                            .foregroundStyle(Palette.textSecondary)
                            .id("checking")
                    }
                    if messages.count <= 2 && !isChecking { suggestions }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: messages.count) {
                guard let last = messages.last else { return }
                if reduceMotion {
                    proxy.scrollTo(last.id, anchor: .bottom)
                } else {
                    withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
        .screenBackground()
        .navigationTitle("Ask Soterra")
        .navigationBarTitleDisplayMode(.inline)
        .soterraToolbar(showsWordmark: false)
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .task {
            guard messages.isEmpty else { return }
            messages.append(ChatMessage(content: .text(DemoAssistant.greeting)))
            if let topic { await send("What should I know about the \(topic.lowercased())?") }
        }
    }

    // MARK: Pieces

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "bubble.left.and.text.bubble.right")
                .foregroundStyle(Palette.accent)
                .frame(width: 36, height: 36)
                .background(Palette.surfaceRaised, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text("Soterra").font(.headline).foregroundStyle(Palette.textPrimary)
                Text("Answers only from official sources")
                    .font(.footnote)
                    .foregroundStyle(Palette.textSecondary)
            }
        }
        .padding(.bottom, 4)
    }

    private var suggestions: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(DemoAssistant.suggestions, id: \.self) { suggestion in
                Button(suggestion) { Task { await send(suggestion) } }
                    .font(.subheadline)
                    .foregroundStyle(Palette.textPrimary)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 44)
                    .background(Palette.surfaceRaised, in: Capsule())
                    .disabled(model.isOffline)
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 0) {
            if model.isOffline {
                Text("You're offline. Calling Soterra still works.")
                    .font(.footnote)
                    .foregroundStyle(Palette.textSecondary)
                    .padding(.vertical, 8)
            }
            HStack(spacing: 10) {
                TextField("Ask about the emergency", text: $draft)
                    .focused($isComposerFocused)
                    .submitLabel(.send)
                    .onSubmit { submitDraft() }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .disabled(model.isOffline)

                Button {
                    openURL(DemoConfig.hotlineURL)
                } label: {
                    Image(systemName: "phone")
                        .frame(width: 44, height: 44)
                        .background(Palette.surface, in: Circle())
                }
                .foregroundStyle(Palette.accent)
                .accessibilityLabel("Call Soterra to talk instead")

                Button(action: submitDraft) {
                    Image(systemName: "arrow.up")
                        .font(.body.weight(.bold))
                        .frame(width: 44, height: 44)
                        .background(Palette.accent, in: Circle())
                        .foregroundStyle(Palette.onAccent)
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isOffline)
                .accessibilityLabel("Send")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(Palette.barBackground)
        .overlay(alignment: .top) { Rectangle().fill(Palette.separator).frame(height: 1) }
    }

    @ViewBuilder
    private func bubble(for message: ChatMessage) -> some View {
        switch message.content {
        case .userText(let text):
            HStack {
                Spacer(minLength: 48)
                Text(text)
                    .foregroundStyle(Palette.onAccent)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Palette.accent, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        case .text(let text):
            reply { Text(text).foregroundStyle(Palette.textPrimary) }
        case .answer(let answer):
            reply { AnswerContent(answer: answer) }
        case .unknown(let question):
            reply { unknownContent(question: question, messageID: message.id) }
        case .danger:
            reply {
                VStack(alignment: .leading, spacing: 10) {
                    Label("If you are in immediate danger, call 911 now.", systemImage: "exclamationmark.triangle.fill")
                        .font(.headline)
                        .foregroundStyle(Palette.emergency)
                    Text("Soterra can't send help or contact emergency services for you.")
                        .foregroundStyle(Palette.textPrimary)
                    Button("Show what to do now") { model.isShowingDanger = true }
                        .buttonStyle(FilledButtonStyle(fill: Palette.emergency, foreground: .white))
                }
            }
        case .confirmation(let text):
            reply {
                Label(text, systemImage: "checkmark")
                    .foregroundStyle(Palette.textPrimary)
            }
        }
    }

    private func reply<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        HStack {
            content()
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            Spacer(minLength: 24)
        }
    }

    private func unknownContent(question: String, messageID: ChatMessage.ID) -> some View {
        let isSaved = notifiedMessageIDs.contains(messageID)
        return VStack(alignment: .leading, spacing: 10) {
            Label("I don't know yet", systemImage: "clock")
                .font(.headline)
                .foregroundStyle(Palette.accent)
            Text("No official source has answered this yet. I've saved your question. We'll update you when officials answer.")
                .foregroundStyle(Palette.textPrimary)
            Button {
                notifiedMessageIDs.insert(messageID)
            } label: {
                Label(isSaved ? "We'll tell you" : "Tell me when answered", systemImage: isSaved ? "checkmark" : "bell")
            }
            .buttonStyle(FilledButtonStyle())
            .disabled(isSaved)
            if question.lowercased().contains("shelter") {
                Text("Open shelters right now: Hamilton Recreation Center, 1900 Geary Boulevard (pets in crates). Checked 3:45 PM.")
                    .font(.footnote)
                    .foregroundStyle(Palette.textSecondary)
            }
        }
    }

    // MARK: Sending

    private func submitDraft() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !model.isOffline else { return }
        draft = ""
        Task { await send(text) }
    }

    @MainActor
    private func send(_ text: String) async {
        let previous = messages.last?.content
        messages.append(ChatMessage(content: .userText(text)))
        isChecking = true
        // A short pause so the "checking" state reads like the real lookup.
        try? await Task.sleep(for: .milliseconds(reduceMotion ? 200 : 700))
        isChecking = false
        let reply = DemoAssistant.reply(to: text, previous: previous, scenario: model.scenario)
        messages.append(ChatMessage(content: reply))
        if case .danger = reply { model.isShowingDanger = true }
    }
}

/// A sourced answer: the text, then when and where it came from.
private struct AnswerContent: View {
    let answer: SourcedAnswer

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(LocalizedStringKey(answer.text))
                .foregroundStyle(Palette.textPrimary)
            if let note = answer.note {
                Label(note, systemImage: "clock")
                    .font(.footnote)
                    .foregroundStyle(Palette.caution)
            }
            Divider().overlay(Palette.separator)
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(answer.timeLabel).font(.caption).foregroundStyle(Palette.textSecondary)
                    Text(answer.time).font(.subheadline.weight(.semibold)).monospacedDigit()
                        .foregroundStyle(Palette.textPrimary)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text("Source").font(.caption).foregroundStyle(Palette.textSecondary)
                    Text(answer.source.name).font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.textPrimary)
                }
            }
            if !answer.source.corroboratedBy.isEmpty {
                Label("Also reported by \(ListFormatter.localizedString(byJoining: answer.source.corroboratedBy))",
                      systemImage: "checkmark.seal")
                    .font(.caption)
                    .foregroundStyle(Palette.textSecondary)
            }
        }
    }
}
