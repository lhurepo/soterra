import SwiftUI

/// Who has checked in, the shared meeting point, and a message to send the family.
struct HouseholdView: View {
    @Environment(AppModel.self) private var model
    @State private var isShowingAddInfo = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                summary
                SectionHeader(title: "Members", actionTitle: "Add") { isShowingAddInfo = true }
                members
                SectionHeader(title: "Message preview")
                Text("“\(model.householdMessage)”")
                    .font(.subheadline)
                    .foregroundStyle(Palette.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .surfaceCard()
                ShareLink(item: model.householdMessage) {
                    Label("Share message", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(OutlineButtonStyle())
                TrustFooter()
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
        }
        .screenBackground()
        .navigationTitle("Household")
        .soterraToolbar()
        .alert("Add a household member", isPresented: $isShowingAddInfo) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Inviting people by phone number comes after the demo.")
        }
    }

    private var summary: some View {
        let tone = CardTone.neutral
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(model.checkedInCount) of \(model.members.count) checked in")
                    .font(.headline)
                Spacer()
                Text("Updated 2:20 PM")
                    .font(.footnote)
                    .foregroundStyle(tone.secondary)
            }
            HStack(spacing: 4) {
                ForEach(model.members) { member in
                    Capsule()
                        .fill(color(for: member.status))
                        .frame(height: 8)
                }
            }
            .accessibilityHidden(true)
            TimeStrip(marks: [TimeMark(label: "Meeting point", value: model.meetingPoint.name)], tone: tone)
        }
        .tintedCard(tone)
    }

    private var members: some View {
        VStack(spacing: 0) {
            ForEach(model.members) { member in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(member.isYou ? "\(member.name) (you)" : member.name)
                            .foregroundStyle(Palette.textPrimary)
                        Text([member.role, member.lastUpdate].compactMap { $0 }.joined(separator: " · "))
                            .font(.footnote)
                            .foregroundStyle(Palette.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if member.isYou {
                        statusMenu(member.status)
                    } else {
                        statusLabel(member.status)
                    }
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 56)
                .accessibilityElement(children: .combine)
                if member.id != model.members.last?.id { Divider().overlay(Palette.separator) }
            }
        }
        .surfaceCard(padding: 0)
    }

    /// Your own status opens a drop-down to change it.
    private func statusMenu(_ current: MemberStatus) -> some View {
        Menu {
            ForEach(MemberStatus.selectable) { status in
                Button(status.label) { model.setMyStatus(status) }
            }
            Button("I need help") { model.isShowingDanger = true }
        } label: {
            HStack(spacing: 4) {
                statusLabel(current)
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.accent)
            }
            .frame(minHeight: 44)
        }
        .accessibilityHint("Update your status")
    }

    @ViewBuilder
    private func statusLabel(_ status: MemberStatus) -> some View {
        switch status {
        case .awaiting:
            Label(status.label, systemImage: "exclamationmark.triangle")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.caution)
        case .checkingIn:
            Text(status.label)
                .font(.subheadline)
                .foregroundStyle(Palette.textSecondary)
        default:
            Text(status.label)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.accent)
        }
    }

    private func color(for status: MemberStatus) -> Color {
        switch status {
        case .onMyWay, .atMeetingPoint, .safe: Palette.accent
        case .checkingIn: Palette.slateTeal.opacity(0.6)
        case .awaiting: SeverityLevel.low.fill
        }
    }
}
