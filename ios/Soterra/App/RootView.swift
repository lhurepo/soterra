import SwiftUI

/// Tabs: Home · Chat · Map · Household · More, or the single Simple mode screen. The alerts list (the bell), the
/// danger sheet can appear over either.
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
        .sheet(isPresented: $model.isShowingAlerts) {
            NavigationStack(path: $model.alertsPath) {
                AlertsView().withRoutes()
            }
            .environment(\.isInAlertsList, true)
            // Solid, so the bell's red badge and the chips never show through as translucent.
            .presentationBackground(Palette.background)
        }
        .sheet(isPresented: $model.isShowingDanger) {
            DangerSheet()
        }
        // Fetches when the app opens, then every few seconds while it is on screen, so new alerts appear without
        // closing and reopening it. The task is cancelled when the app leaves the foreground.
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.refresh()
                try? await Task.sleep(for: .seconds(DemoConfig.refreshInterval))
            }
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

            NavigationStack(path: $model.chatPath) {
                AssistantView(topic: nil).withRoutes()
            }
            .tabItem { Label("Chat", systemImage: "bubble.left") }
            .tag(AppTab.chat)

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
