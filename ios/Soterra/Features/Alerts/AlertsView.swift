import SwiftUI

/// Every active official alert for the area, or only the ones being followed. Opens from the bell; an alert opens
/// on this list's stack, with a back button to return.
struct AlertsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var model = model

        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Picker("Show", selection: $model.alertsFilter) {
                    ForEach(AlertsFilter.allCases) { filter in
                        Text(filter.label).tag(filter)
                    }
                }
                .pickerStyle(.segmented)

                if model.visibleAlerts.isEmpty {
                    emptyState
                } else {
                    ForEach(model.visibleAlerts) { alert in
                        Button {
                            model.alertsPath.append(.alert(alert.id))
                        } label: {
                            CompactAlertCard(alert: alert, isFollowing: model.isFollowing(alert))
                        }
                        .buttonStyle(.plain)
                    }
                }
                TrustFooter()
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            // Exactly the screen's width, so nothing wider can make the page drift or wiggle sideways.
            .containerRelativeFrame(.horizontal)
        }
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        .scrollBounceBehavior(.always, axes: .vertical)
        .refreshable { await model.refresh() }
        .screenBackground()
        .navigationTitle("Alerts")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if model.isOffline { OfflineBanner() }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if model.alerts.isEmpty {
            ContentUnavailableView("No active official alerts",
                                   systemImage: "checkmark.shield",
                                   description: Text("Last checked 2:14 PM for San Francisco."))
                .padding(.top, 40)
        } else {
            ContentUnavailableView("Not following any alerts",
                                   systemImage: "bell.slash",
                                   description: Text("Open an alert and tap Follow updates to hear when it changes."))
                .padding(.top, 40)
        }
    }
}
