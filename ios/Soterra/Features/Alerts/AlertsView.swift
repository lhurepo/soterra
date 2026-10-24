import SwiftUI

/// Every active official alert for the area, or only the ones being followed.
struct AlertsView: View {
    @Environment(AppModel.self) private var model

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
        }
        .screenBackground()
        .navigationTitle("Alerts")
        .soterraToolbar()
        .safeAreaInset(edge: .top, spacing: 0) {
            if model.isOffline { OfflineBanner() }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if model.alerts.isEmpty {
            ContentUnavailableView("No active official alerts",
                                   systemImage: "checkmark.shield",
                                   description: Text("Last checked 2:14 PM for Sonoma County."))
                .padding(.top, 40)
        } else {
            ContentUnavailableView("Not following any alerts",
                                   systemImage: "bell.slash",
                                   description: Text("Open an alert and tap Follow updates to hear when it changes."))
                .padding(.top, 40)
        }
    }
}
