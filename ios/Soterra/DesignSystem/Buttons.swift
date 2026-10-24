import SwiftUI

/// The main action: a filled brand button (Slate Teal in light mode, Sage in dark mode).
struct FilledButtonStyle: ButtonStyle {
    var fill: Color = Palette.accent
    var foreground: Color = Palette.onAccent

    func makeBody(configuration: Configuration) -> some View {
        SizedButtonLabel(configuration: configuration) { label, isEnabled in
            label
                .foregroundStyle(foreground)
                .background(fill.opacity(isEnabled ? 1 : 0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}

/// A secondary action: an outlined button.
struct OutlineButtonStyle: ButtonStyle {
    var color: Color = Palette.accent
    var border: Color?

    func makeBody(configuration: Configuration) -> some View {
        SizedButtonLabel(configuration: configuration) { label, _ in
            label
                .foregroundStyle(color)
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(border ?? color, lineWidth: 1.5)
                }
        }
    }
}

/// Sizes the label first (48 pt tall, full width), then lets the style paint behind it, so the fill or
/// border always covers the whole button. Also handles the pressed and disabled states.
struct SizedButtonLabel<Styled: View>: View {
    let configuration: ButtonStyleConfiguration
    @ViewBuilder let style: (_ label: AnyView, _ isEnabled: Bool) -> Styled
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let sized = configuration.label
            .font(.body.weight(.semibold))
            .lineLimit(2)
            .minimumScaleFactor(0.85)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 48)
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        style(AnyView(sized), isEnabled)
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.6)
    }
}

/// A selectable filter chip (Map filters).
struct FilterChip: View {
    let title: String
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14)
                .frame(minHeight: 36)
                .foregroundStyle(isOn ? Palette.onAccent : Palette.textPrimary)
                .background(isOn ? Palette.accent : Palette.surface, in: Capsule())
                .overlay { Capsule().strokeBorder(isOn ? Color.clear : Palette.separator, lineWidth: 1) }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}
