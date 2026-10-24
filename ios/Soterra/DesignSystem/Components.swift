import SwiftUI

// MARK: - Chips and markers

/// Severity chip: icon, severity and alert type together, so meaning never relies on color alone.
struct SeverityChip: View {
    let severity: Severity
    let text: String

    var body: some View {
        let level = severity.level
        HStack(spacing: 5) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.caption.weight(.bold))
            Text(text)
                .font(.footnote.weight(.bold))
        }
        .foregroundStyle(level.chipInk)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(level.fill, in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(level.accessibilityLabel). \(text)")
    }
}

/// A chip for a non-alert status such as "No active alerts".
struct StatusChip: View {
    let text: String
    let systemImage: String
    let fill: Color
    let ink: Color

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.footnote.weight(.bold))
            .foregroundStyle(ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(fill, in: Capsule())
    }
}

/// A dot and short label ("High", "Med", "Low") beside a list row.
struct SeverityMarker: View {
    let level: SeverityLevel

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(level.fill).frame(width: 8, height: 8)
            Text(level.shortLabel)
                .font(.caption2.weight(.bold))
                .foregroundStyle(level.ink)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(level.accessibilityLabel)
    }
}

// MARK: - Time and source

/// The signature time strip: when something was issued, changed, and how fresh it is now.
struct TimeStrip: View {
    let marks: [TimeMark]
    let tone: CardTone

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle().fill(tone.divider).frame(height: 1)
            HStack(alignment: .top, spacing: 8) {
                ForEach(marks) { mark in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(mark.label)
                            .font(.caption)
                            .foregroundStyle(tone.secondary)
                        Text(mark.value)
                            .font(.callout.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(mark.isHighlighted ? tone.note : tone.heading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Source name, Official badge and corroboration, shown under every piece of disaster information.
struct SourceLine: View {
    let source: SourceInfo
    var color: Color = Palette.textSecondary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(source.name)
                    .font(.caption)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if source.isOfficial {
                    Text("Official")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .overlay { RoundedRectangle(cornerRadius: 4).strokeBorder(color, lineWidth: 1) }
                        .accessibilityLabel("Official source")
                }
            }
            if !source.corroboratedBy.isEmpty {
                Label("Also reported by \(ListFormatter.localizedString(byJoining: source.corroboratedBy))",
                      systemImage: "checkmark.seal")
                    .font(.caption)
            }
            if source.sourcesDiffer {
                Label("Sources differ on the figures", systemImage: "exclamationmark.bubble")
                    .font(.caption)
            }
        }
        .foregroundStyle(color)
    }
}

// MARK: - Cards

private struct TintedCardModifier: ViewModifier {
    let tone: CardTone
    let isEmphasized: Bool

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LinearGradient(colors: [tone.top, tone.bottom], startPoint: .top, endPoint: .bottom), in: shape)
            .overlay {
                shape.strokeBorder(isEmphasized ? Palette.emergency : tone.border, lineWidth: isEmphasized ? 1.5 : 1)
            }
            .overlay {
                // A changed alert stays lit until the person has seen it.
                if isEmphasized {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(Palette.emergency.opacity(0.22), lineWidth: 4)
                        .padding(-4)
                }
            }
            .shadow(color: isEmphasized ? Palette.emergency.opacity(0.18) : .clear, radius: 14, y: 8)
            .foregroundStyle(tone.heading)
    }
}

private struct SurfaceCardModifier: ViewModifier {
    var padding: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

extension View {
    /// A card tinted with `tone`; `emphasized` adds the lit red edge for a just-changed alert.
    func tintedCard(_ tone: CardTone, emphasized: Bool = false) -> some View {
        modifier(TintedCardModifier(tone: tone, isEmphasized: emphasized))
    }

    func surfaceCard(padding: CGFloat = 14) -> some View {
        modifier(SurfaceCardModifier(padding: padding))
    }
}

/// The top alert card on Home and in lists: chip, headline, area, time strip, source and actions.
struct AlertCard: View {
    let alert: HazardAlert
    let times: [TimeMark]
    var isEmphasized = false
    var onWhatToDo: (() -> Void)?
    var onAsk: (() -> Void)?

    var body: some View {
        let tone = CardTone.severity(alert.severity.level)
        VStack(alignment: .leading, spacing: 10) {
            SeverityChip(severity: alert.severity, text: alert.chipText)
            if let note = alert.changeNote {
                Label(note, systemImage: "clock")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(tone.note)
            }
            Text(alert.headline)
                .font(.display(24, relativeTo: .title2))
                .foregroundStyle(tone.heading)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(alert.area)
                .font(.subheadline)
                .foregroundStyle(tone.secondary)
            TimeStrip(marks: times, tone: tone)
                .padding(.top, 4)
            SourceLine(source: alert.source, color: tone.secondary)
            if onWhatToDo != nil || onAsk != nil {
                HStack(spacing: 8) {
                    if let onWhatToDo {
                        Button("What to do", action: onWhatToDo)
                            .buttonStyle(FilledButtonStyle())
                    }
                    if let onAsk {
                        Button("Ask about this", action: onAsk)
                            .buttonStyle(OutlineButtonStyle(color: tone.heading, border: tone.border))
                    }
                }
                .padding(.top, 4)
            }
        }
        .tintedCard(tone, emphasized: isEmphasized)
    }
}

/// A smaller alert card for the Alerts list.
struct CompactAlertCard: View {
    let alert: HazardAlert
    let isFollowing: Bool

    var body: some View {
        let tone = CardTone.severity(alert.severity.level)
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                SeverityChip(severity: alert.severity, text: alert.chipText)
                Spacer()
                if isFollowing {
                    Label("Following", systemImage: "bell.fill")
                        .labelStyle(.iconOnly)
                        .font(.footnote)
                        .foregroundStyle(tone.secondary)
                        .accessibilityLabel("Following")
                }
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(tone.secondary)
                    .accessibilityHidden(true)
            }
            Text(alert.headline)
                .font(.headline)
                .foregroundStyle(tone.heading)
                .fixedSize(horizontal: false, vertical: true)
            Text(alert.area)
                .font(.subheadline)
                .foregroundStyle(tone.secondary)
            if let latest = alert.times.last(where: { $0.label != "Now" }) {
                Text("\(latest.label) \(latest.value) · \(alert.source.name)")
                    .font(.caption)
                    .foregroundStyle(tone.secondary)
            }
        }
        .tintedCard(tone)
    }
}

// MARK: - Rows, tiles, headers

struct SectionHeader: View {
    let title: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(.subheadline)
                    .foregroundStyle(Palette.accent)
                    .frame(minHeight: 44)
            }
        }
        .padding(.top, 12)
    }
}

/// A next-step tile on Home.
struct ActionTile: View {
    let title: String
    let systemImage: String
    let detail: String
    var detailNeedsAttention = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: systemImage)
                        .foregroundStyle(Palette.accent)
                    Text(title)
                        .foregroundStyle(Palette.textPrimary)
                }
                .font(.headline)
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(detailNeedsAttention ? Palette.caution : Palette.textSecondary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
            .surfaceCard(padding: 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A row on the time column: time, what happened, source and severity.
struct TimelineRow: View {
    let item: TimelineItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(item.time)
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Palette.accent)
                .frame(minWidth: 68, alignment: .leading)
                .fixedSize()
            VStack(alignment: .leading, spacing: 2) {
                Text(item.text)
                    .font(.subheadline)
                    .foregroundStyle(Palette.textPrimary)
                Text(item.source)
                    .font(.caption)
                    .foregroundStyle(Palette.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            SeverityMarker(level: item.severity.level)
                .padding(.top, 3)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

/// A plain row in a surface list: icon, title, optional subtitle, chevron.
struct ListRow: View {
    let systemImage: String
    let title: String
    var subtitle: String?
    var showsChevron = true

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(Palette.accent)
                .frame(width: 24)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .foregroundStyle(Palette.textPrimary)
                if let subtitle {
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundStyle(Palette.textSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.textSecondary)
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: 52)
        .contentShape(Rectangle())
    }
}

// MARK: - Bars and banners

/// A bar of one or two actions pinned above the tab bar.
struct BottomActionBar<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 8) { content }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Palette.surface)
            .overlay(alignment: .top) { Rectangle().fill(Palette.separator).frame(height: 1) }
    }
}

/// Call Soterra and Ask Soterra, always one tap away. Calling works offline because it uses the dialer.
struct CallBar: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let onAsk: () -> Void

    var body: some View {
        BottomActionBar {
            Button {
                openURL(DemoConfig.hotlineURL)
            } label: {
                Label("Call Soterra", systemImage: "phone")
            }
            .buttonStyle(FilledButtonStyle())
            .accessibilityHint("Calls the Soterra hotline, \(DemoConfig.hotlineDisplay)")

            Button(action: onAsk) {
                Label(model.isOffline ? "Ask (offline)" : "Ask Soterra", systemImage: "bubble.left")
            }
            .buttonStyle(OutlineButtonStyle())
            .disabled(model.isOffline)
        }
    }
}

/// A large, labelled way to phone the hotline from Home. It uses the dialer, so it works offline.
struct CallSoterraCard: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Talk to Soterra")
                .font(.headline)
                .foregroundStyle(Palette.textPrimary)
            Text("Call \(DemoConfig.hotlineDisplay) from any phone. English · Español · 24/7")
                .font(.footnote)
                .foregroundStyle(Palette.textSecondary)
            Button {
                openURL(DemoConfig.hotlineURL)
            } label: {
                Label("Call Soterra", systemImage: "phone.fill")
            }
            .buttonStyle(FilledButtonStyle())
            .accessibilityHint("Calls the Soterra hotline, \(DemoConfig.hotlineDisplay)")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .surfaceCard()
    }
}

struct OfflineBanner: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "wifi.slash")
                .accessibilityHidden(true)
            Text("Offline — showing info from \(DemoConfig.lastSyncTime)")
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("Retry") { model.isOffline = false }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.accent)
                .frame(minHeight: 44)
        }
        .foregroundStyle(Palette.textPrimary)
        .padding(.horizontal, 16)
        .background(Palette.offlineBanner)
    }
}

struct TrustFooter: View {
    var body: some View {
        Text("Soterra shares official information. It does not replace emergency services.")
            .font(.caption)
            .foregroundStyle(Palette.textSecondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
    }
}

struct ToastView: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Palette.onAccent)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Palette.accent, in: Capsule())
            .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
            .padding(.horizontal, 16)
            .accessibilityAddTraits(.isStaticText)
    }
}

// MARK: - Toolbar

/// The 911 pill: in every screen's navigation bar, one tap to the danger sheet.
struct EmergencyButton: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Button {
            model.isShowingDanger = true
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "phone.fill")
                    .font(.caption.weight(.bold))
                Text("911")
                    .font(.subheadline.weight(.bold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .frame(minHeight: 34)
            .background(Palette.emergency, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Emergency")
        .accessibilityHint("Shows how to call 911")
    }
}

/// The area picker. The demo has one area.
struct AreaMenu: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Menu {
            Button {
                model.show("Showing Sonoma County, CA")
            } label: {
                Label("Sonoma County, CA", systemImage: "checkmark")
            }
            Text("More areas after the demo")
        } label: {
            HStack(spacing: 4) {
                Text("Sonoma County, CA")
                    .font(.body.weight(.medium))
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.semibold))
            }
            .foregroundStyle(Palette.accent)
        }
        .accessibilityLabel("Area: Sonoma County, California")
    }
}

private struct SoterraToolbarModifier: ViewModifier {
    let showsArea: Bool

    func body(content: Content) -> some View {
        content.toolbar {
            if showsArea {
                ToolbarItem(placement: .topBarLeading) { AreaMenu() }
            }
            ToolbarItem(placement: .topBarTrailing) { EmergencyButton() }
        }
    }
}

extension View {
    /// The standard bar: area picker (top-level screens) and the 911 pill (every screen).
    func soterraToolbar(showsArea: Bool = true) -> some View {
        modifier(SoterraToolbarModifier(showsArea: showsArea))
    }

    /// The page background used behind every screen.
    func screenBackground() -> some View {
        background(Palette.background.ignoresSafeArea())
    }
}
