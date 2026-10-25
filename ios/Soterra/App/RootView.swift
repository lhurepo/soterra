import SwiftUI

/// Tabs: Home · Alerts · Map · Household · More, or the single Simple mode screen. The danger sheet and toasts
/// can appear over either.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var model = model

        Group {
            if model.isSimpleMode {
                NavigationStack { SimpleModeView() }
            } else {
                tabs
            }
        }
        .sheet(isPresented: $model.isShowingDanger) {
            DangerSheet()
        }
        .overlay(alignment: .top) {
            if let toast = model.toast {
                ToastView(message: toast.message)
                    .padding(.top, 8)
                    .transition(.opacity)
                    .task(id: toast.id) {
                        try? await Task.sleep(for: .seconds(3))
                        if model.toast?.id == toast.id { model.toast = nil }
                    }
            }
        }
        .animation(.easeOut(duration: 0.2), value: model.toast)
        .task(id: scenePhase) {
            if scenePhase == .active { await model.refresh() }
        }
    }

    private var tabs: some View {
        @Bindable var model = model

        return TabView(selection: $model.selectedTab) {
            NavigationStack(path: $model.homePath) {
                HomeView().withRoutes()
            }
            .tabItem { Label("Home", systemImage: "house") }
            .tag(AppTab.home)

            NavigationStack(path: $model.alertsPath) {
                AlertsView().withRoutes()
            }
            .tabItem { Label("Alerts", systemImage: "bell") }
            .tag(AppTab.alerts)

            NavigationStack(path: $model.mapPath) {
                MapScreen().withRoutes()
            }
            .tabItem { Label("Map", systemImage: "map") }
            .tag(AppTab.map)

            NavigationStack(path: $model.householdPath) {
                HouseholdView().withRoutes()
            }
            .tabItem { Label("Household", systemImage: "person.2") }
            .tag(AppTab.household)

            NavigationStack(path: $model.morePath) {
                MoreView().withRoutes()
            }
            .tabItem { Label("More", systemImage: "ellipsis") }
            .tag(AppTab.more)
        }
    }
}

private struct RouteDestinations: ViewModifier {
    func body(content: Content) -> some View {
        content.navigationDestination(for: Route.self) { route in
            switch route {
            case .alert(let id): AlertDetailView(alertID: id)
            case .assistant(let topic): AssistantView(topic: topic)
            case .activity: ActivityView()
            case .callHistory: CallHistoryView()
            case .following: FollowingView()
            case .checklist: ChecklistView()
            case .area: AreaView()
            case .language: LanguageView()
            case .privacy: PrivacyView()
            case .settings: AppearanceSettingsView()
            case .about: AboutView()
            }
        }
    }
}

extension View {
    /// Registers every pushable screen for a tab's navigation stack.
    func withRoutes() -> some View {
        modifier(RouteDestinations())
    }
}
