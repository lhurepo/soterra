import CoreText
import SwiftUI
import UIKit

/// Outfit SemiBold (SIL Open Font License, Resources/Fonts/OFL.txt) is the brand display face. San Francisco
/// carries all other text, so the UI keeps native Dynamic Type behavior.
enum BrandFont {
    static let displayName = "Outfit-SemiBold"

    /// Registers the fonts bundled in the app so `displayName` resolves.
    static func registerBundledFonts() {
        let urls = (Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? [])
            + (Bundle.main.urls(forResourcesWithExtension: "otf", subdirectory: nil) ?? [])
        for url in urls {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }

    /// The display face for UIKit (navigation titles), scaled for Dynamic Type.
    static func uiFont(size: CGFloat, textStyle: UIFont.TextStyle) -> UIFont {
        let base = UIFont(name: displayName, size: size) ?? .systemFont(ofSize: size, weight: .semibold)
        return UIFontMetrics(forTextStyle: textStyle).scaledFont(for: base)
    }
}

extension Font {
    /// The brand display face at `size`, scaling with Dynamic Type like `style`.
    static func display(_ size: CGFloat, relativeTo style: Font.TextStyle) -> Font {
        .custom(BrandFont.displayName, size: size, relativeTo: style)
    }
}

/// Bar appearances: brand background, Outfit large titles, quiet unselected tab items.
enum BarAppearance {
    static func configure() {
        let navigation = UINavigationBarAppearance()
        navigation.configureWithOpaqueBackground()
        navigation.backgroundColor = UIPalette.background
        navigation.shadowColor = .clear
        navigation.largeTitleTextAttributes = [
            .font: BrandFont.uiFont(size: 34, textStyle: .largeTitle),
            .foregroundColor: UIPalette.textPrimary,
        ]
        navigation.titleTextAttributes = [
            .font: UIFont.preferredFont(forTextStyle: .headline),
            .foregroundColor: UIPalette.textPrimary,
        ]
        let navigationBar = UINavigationBar.appearance()
        navigationBar.standardAppearance = navigation
        navigationBar.scrollEdgeAppearance = navigation
        navigationBar.compactAppearance = navigation

        let tabs = UITabBarAppearance()
        tabs.configureWithOpaqueBackground()
        tabs.backgroundColor = UIPalette.barBackground
        tabs.shadowColor = UIPalette.separator
        for layout in [tabs.stackedLayoutAppearance, tabs.inlineLayoutAppearance, tabs.compactInlineLayoutAppearance] {
            layout.normal.iconColor = UIPalette.textSecondary
            layout.normal.titleTextAttributes = [.foregroundColor: UIPalette.textSecondary]
            layout.selected.iconColor = UIPalette.accent
            layout.selected.titleTextAttributes = [.foregroundColor: UIPalette.accent]
        }
        let tabBar = UITabBar.appearance()
        tabBar.standardAppearance = tabs
        tabBar.scrollEdgeAppearance = tabs
    }
}
