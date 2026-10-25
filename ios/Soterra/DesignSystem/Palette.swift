import SwiftUI
import UIKit

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }

    /// A color that resolves per appearance. Light is the app's default and main use.
    static func adaptive(light: UInt32, dark: UInt32) -> UIColor {
        UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(uiColor: UIColor(hex: hex))
    }

    static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: .adaptive(light: light, dark: dark))
    }
}

/// UIKit versions of the semantic colors, for bar appearances.
enum UIPalette {
    static let background = UIColor.adaptive(light: 0xE4E9E9, dark: 0x041421)
    static let barBackground = UIColor.adaptive(light: 0xF4F6F6, dark: 0x06192A)
    static let separator = UIColor.adaptive(light: 0xC9D2D2, dark: 0x143A44)
    static let textPrimary = UIColor.adaptive(light: 0x041421, dark: 0xD0D6D6)
    static let textSecondary = UIColor.adaptive(light: 0x4A6466, dark: 0x8FA6A6)
    static let accent = UIColor.adaptive(light: 0x2F5557, dark: 0x86B9B0)
}

/// Brand palette (docs/soterra-brand-assets: Abyss, Deep Teal, Slate Teal, Sage, Mist) and the semantic
/// tones built from it. Severity colors sit outside the brand palette and only carry meaning.
enum Palette {
    // Brand
    static let abyss = Color(hex: 0x041421)
    static let deepTeal = Color(hex: 0x042630)
    static let slateTeal = Color(hex: 0x4C7273)
    static let sage = Color(hex: 0x86B9B0)
    static let mist = Color(hex: 0xD0D6D6)

    // Semantic
    static let background = Color(uiColor: UIPalette.background)
    static let surface = Color.adaptive(light: 0xFFFFFF, dark: 0x042630)
    static let surfaceRaised = Color.adaptive(light: 0xF1F4F4, dark: 0x0A3340)
    static let separator = Color(uiColor: UIPalette.separator)
    static let textPrimary = Color(uiColor: UIPalette.textPrimary)
    static let textSecondary = Color(uiColor: UIPalette.textSecondary)
    static let accent = Color(uiColor: UIPalette.accent)
    static let onAccent = Color.adaptive(light: 0xFFFFFF, dark: 0x041421)
    static let barBackground = Color(uiColor: UIPalette.barBackground)
    /// Text that needs attention but is not an alert (a member who has not checked in, stale capacity).
    static let caution = Color.adaptive(light: 0x8A5A00, dark: 0xE2C044)
    static let offlineBanner = Color.adaptive(light: 0xD5DCDC, dark: 0x2A3A40)
    /// The wordmark: Deep Teal on light backgrounds, Mist on dark (the brand's on-light and on-dark versions).
    static let wordmark = Color.adaptive(light: 0x042630, dark: 0xD0D6D6)
    /// Bright alert red: the bell's badge and the lit edge on a changed alert. Same red as a high-severity alert.
    static let emergency = Color(hex: 0xFF3B30)
}
