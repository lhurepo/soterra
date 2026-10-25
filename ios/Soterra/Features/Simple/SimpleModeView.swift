import MapKit
import SwiftUI

/// Simple mode (More → Simple mode): one screen with bigger text and buttons and only the essentials. What is
/// happening (with its source and time), calling Soterra, telling the household you're safe, and the way
/// to the meeting point. Everything else is in the full app.
struct SimpleModeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var isConfirmingFullApp = false

    private var isMarkedSafe: Bool {
        model.members.first(where: \.isYou)?.status == .safe
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let alert = model.topAlert {
                    alertCard(alert)
                } else {
                    calmCard
                }
                actions
                if let steps = model.topAlert?.steps.prefix(3), !steps.isEmpty {
                    whatToDo(Array(steps))
                }
                Button {
                    isConfirmingFullApp = true
                } label: {
                    Text("Switch to the full app")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Palette.accent)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .confirmationDialog("Switch to the full app?", isPresented: $isConfirmingFullApp, titleVisibility: .visible) {
                    Button("Switch to the full app") { model.isSimpleMode = false }
                } message: {
                    Text("You can turn Simple mode back on in More.")
                }
                .padding(.top, 8)
                TrustFooter()
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
        }
        .screenBackground()
        .soterraToolbar()
        .safeAreaInset(edge: .top, spacing: 0) {
            if model.isOffline { OfflineBanner() }
        }
    }

    // MARK: What is happening

    private func alertCard(_ alert: HazardAlert) -> some View {
        let tone = CardTone.severity(alert.severity.level)
        let time = model.displayTimes(for: alert).last(where: { $0.label != "Now" })
        return VStack(alignment: .leading, spacing: 12) {
            SeverityChip(severity: alert.severity, text: alert.chipText)
            if let note = alert.changeNote {
                Label(note, systemImage: "clock")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(tone.note)
            }
            Text(alert.headline)
                .font(.display(32, relativeTo: .largeTitle))
                .foregroundStyle(tone.heading)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(alert.area)
                .font(.title3)
                .foregroundStyle(tone.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text([time.map { "\($0.label) \($0.value)" }, alert.source.name].compactMap { $0 }.joined(separator: " · "))
                .font(.body)
                .foregroundStyle(tone.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .tintedCard(tone)
    }

    private var calmCard: some View {
        let tone = CardTone.calm
        return VStack(alignment: .leading, spacing: 12) {
            StatusChip(text: "No active alerts", systemImage: "checkmark", fill: Palette.sage, ink: Palette.abyss)
            Text("No active official alerts for San Francisco.")
                .font(.display(32, relativeTo: .largeTitle))
                .foregroundStyle(tone.heading)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text("Last checked 2:14 PM")
                .font(.body)
                .foregroundStyle(tone.secondary)
        }
        .tintedCard(tone)
    }

    // MARK: Actions

    private var actions: some View {
        VStack(spacing: 12) {
            Button {
                openURL(DemoConfig.hotlineURL)
            } label: {
                BigButtonLabel(title: "Call Soterra", detail: "Information by phone, 24/7", systemImage: "phone")
            }
            .buttonStyle(BigButtonStyle(fill: Palette.accent, ink: Palette.onAccent))
            .accessibilityHint("Calls the Soterra hotline, \(DemoConfig.hotlineDisplay)")

            Button {
                model.setMyStatus(.safe)
            } label: {
                BigButtonLabel(title: isMarkedSafe ? "You're marked safe" : "I'm safe",
                               detail: "For your household", systemImage: isMarkedSafe ? "checkmark" : "hand.raised")
            }
            .buttonStyle(BigButtonStyle(fill: Palette.surface, ink: Palette.accent, border: Palette.accent))
            .disabled(isMarkedSafe)

            Button {
                let point = model.meetingPoint
                let item = MKMapItem(placemark: MKPlacemark(coordinate: point.coordinate))
                item.name = point.name
                item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving])
            } label: {
                BigButtonLabel(title: "Directions to \(model.meetingPoint.name)",
                               detail: "Meeting point · \(model.meetingPoint.address)",
                               systemImage: "arrow.triangle.turn.up.right.diamond")
            }
            .buttonStyle(BigButtonStyle(fill: Palette.surface, ink: Palette.accent, border: Palette.accent))
            .accessibilityHint("Opens Apple Maps")
        }
    }

    private func whatToDo(_ steps: [ActionStep]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("What to do")
                .font(.title2.weight(.semibold))
                .foregroundStyle(Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
                .padding(.bottom, 8)
            VStack(spacing: 0) {
                ForEach(steps) { step in
                    HStack(alignment: .firstTextBaseline, spacing: 14) {
                        Image(systemName: step.systemImage)
                            .foregroundStyle(Palette.accent)
                            .frame(width: 28)
                            .accessibilityHidden(true)
                        Text(step.text)
                            .foregroundStyle(Palette.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .font(.title3)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    if step.id != steps.last?.id { Divider().overlay(Palette.separator) }
                }
            }
            .surfaceCard(padding: 0)
        }
        .padding(.top, 8)
    }
}

/// A big button's label: icon, title and an optional second line.
private struct BigButtonLabel: View {
    let title: String
    var detail: String?
    let systemImage: String

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.title2.weight(.semibold))
                .frame(width: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.title2.weight(.bold))
                if let detail {
                    Text(detail)
                        .font(.body)
                        .opacity(0.85)
                }
            }
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A full-width button at least 76 pt tall, for Simple mode.
private struct BigButtonStyle: ButtonStyle {
    let fill: Color
    let ink: Color
    var border: Color?
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
        configuration.label
            .foregroundStyle(ink)
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
            .background(fill, in: shape)
            .overlay { if let border { shape.strokeBorder(border, lineWidth: 2) } }
            .contentShape(shape)
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.6)
    }
}
