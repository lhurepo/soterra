import SwiftUI

/// Shown when the assistant hears danger or someone taps "I need help". It never shows a loading state first, and
/// it never says help is on the way: Soterra cannot send help. The app has no button that dials 911.
struct DangerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 40, weight: .semibold))
                    .foregroundStyle(Palette.emergency)
                    .accessibilityHidden(true)

                Text("If you are in immediate danger, call 911 now.")
                    .font(.display(30, relativeTo: .largeTitle))
                    .foregroundStyle(Palette.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)

                Text("Soterra can't send help or contact emergency services for you.")
                    .font(.body)
                    .foregroundStyle(Palette.textSecondary)

                Button {
                    openURL(DemoConfig.hotlineURL)
                } label: {
                    Label("Call Soterra for information", systemImage: "phone")
                }
                .buttonStyle(OutlineButtonStyle())
                .accessibilityHint("Calls the Soterra hotline, \(DemoConfig.hotlineDisplay). It can't send help.")

                Button("I'm safe — show information") { dismiss() }
                    .buttonStyle(OutlineButtonStyle())

                Text("Text 911 where available if you can't speak.")
                    .font(.footnote)
                    .foregroundStyle(Palette.textSecondary)
                    .frame(maxWidth: .infinity)
            }
            .padding(24)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Palette.surface)
    }
}
