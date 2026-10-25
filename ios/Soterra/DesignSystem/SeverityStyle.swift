import SwiftUI

extension SeverityLevel {
    /// Marker and map fill: bright red for high, bright yellow for medium and low.
    var fill: Color {
        switch self {
        case .high: Color(hex: 0xFF3B30)
        case .medium, .low: Color(hex: 0xFFD60A)
        case .unknown: Color(hex: 0x8FA6A6)
        }
    }

    /// Severity chip fill: opaque, one step deeper than the alert card's tint, so it reads as a label, not a siren.
    var chipFill: Color {
        switch self {
        case .high: .adaptive(light: 0xFFBDB8, dark: 0x6E1F1A)
        case .medium, .low: .adaptive(light: 0xFFE27A, dark: 0x5E5000)
        case .unknown: .adaptive(light: 0xDDE4E4, dark: 0x1B3A44)
        }
    }

    /// Text on `chipFill`.
    var chipInk: Color {
        switch self {
        case .high: .adaptive(light: 0x5A0E09, dark: 0xFFE3E0)
        case .medium, .low: .adaptive(light: 0x3D3000, dark: 0xFFF3B8)
        case .unknown: .adaptive(light: 0x3A5254, dark: 0xB8C9CA)
        }
    }

    /// The chip's hairline, so it keeps its shape on a card tinted with the same hue.
    var chipBorder: Color {
        switch self {
        case .high: .adaptive(light: 0xF2958E, dark: 0x9A3A33)
        case .medium, .low: .adaptive(light: 0xE8C440, dark: 0x8A7600)
        case .unknown: .adaptive(light: 0xBFCBCB, dark: 0x2F5560)
        }
    }

    /// Text in the level's color on the page background (darker yellow in light mode for contrast).
    var ink: Color {
        switch self {
        case .high: .adaptive(light: 0xD70015, dark: 0xFF5A52)
        case .medium, .low: .adaptive(light: 0x8A6D00, dark: 0xFFD60A)
        case .unknown: .adaptive(light: 0x4A6466, dark: 0x8FA6A6)
        }
    }
}

/// Colors for a tinted card. Alert cards take their severity's tint: a light tint in light mode and a dark
/// tint in dark mode, never an inverted card.
struct CardTone {
    let top: Color
    let bottom: Color
    let border: Color
    let heading: Color
    let secondary: Color
    let divider: Color
    let note: Color

    static func severity(_ level: SeverityLevel) -> CardTone {
        switch level {
        case .high: high
        case .medium, .low: low
        case .unknown: neutral
        }
    }

    static let high = CardTone(
        top: .adaptive(light: 0xFFE9E7, dark: 0x4A1713), bottom: .adaptive(light: 0xFFD3CF, dark: 0x2C0D0B),
        border: .adaptive(light: 0xFF6B62, dark: 0xD93A30), heading: .adaptive(light: 0x4A0A06, dark: 0xFFEDEB),
        secondary: .adaptive(light: 0x9C1C14, dark: 0xFFB4AE), divider: .adaptive(light: 0xFFB1AB, dark: 0x7A2620),
        note: .adaptive(light: 0xD70015, dark: 0xFF8E87)
    )

    /// Medium and low: bright yellow.
    static let low = CardTone(
        top: .adaptive(light: 0xFFF8CC, dark: 0x4A4100), bottom: .adaptive(light: 0xFFEE8F, dark: 0x2C2600),
        border: .adaptive(light: 0xF2CB00, dark: 0xD4AE00), heading: .adaptive(light: 0x2E2604, dark: 0xFFF6C7),
        secondary: .adaptive(light: 0x6B5500, dark: 0xF0DC7A), divider: .adaptive(light: 0xF2DC5A, dark: 0x7A6A00),
        note: .adaptive(light: 0x7A5F00, dark: 0xFFE24D)
    )

    /// "No active alerts": a quiet sage tint.
    static let calm = CardTone(
        top: .adaptive(light: 0xEAF4F2, dark: 0x0E3A3B), bottom: .adaptive(light: 0xDCEDE9, dark: 0x08282C),
        border: .adaptive(light: 0xA9CEC7, dark: 0x2F6662), heading: .adaptive(light: 0x041421, dark: 0xDCE6E4),
        secondary: .adaptive(light: 0x2F5557, dark: 0x9CC5BE), divider: .adaptive(light: 0xC2DDD8, dark: 0x1F4E4D),
        note: .adaptive(light: 0x2F5557, dark: 0x86B9B0)
    )

    /// Non-alert summaries such as the household card: a deeper step of the surface.
    static let neutral = CardTone(
        top: .adaptive(light: 0xFFFFFF, dark: 0x0C3442), bottom: .adaptive(light: 0xF4F7F7, dark: 0x062A35),
        border: .adaptive(light: 0xC9D2D2, dark: 0x1B4A56), heading: .adaptive(light: 0x041421, dark: 0xD0D6D6),
        secondary: .adaptive(light: 0x4A6466, dark: 0x9AB2B3), divider: .adaptive(light: 0xDCE3E3, dark: 0x1B4A56),
        note: .adaptive(light: 0x2F5557, dark: 0x86B9B0)
    )
}
