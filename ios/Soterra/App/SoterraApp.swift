import SwiftUI

@main
struct SoterraApp: App {
    @State private var model = AppModel()

    init() {
        BrandFont.registerBundledFonts()
        BarAppearance.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(Palette.accent)
                .preferredColorScheme(model.appearance.colorScheme)
        }
    }
}
