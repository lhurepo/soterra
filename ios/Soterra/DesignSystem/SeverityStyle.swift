import SwiftUI

extension SeverityLevel {
    /// Chip and marker fill: high red, medium orange, low yellow.
    var fill: Color {
        switch self {
        case .high: Color(hex: 0xE5484D)
        case .medium: Color(hex: 0xE8833A)
        case .low: Color(hex: 0xE2C044)
        case .unknown: Color(hex: 0x8FA6A6)
        }
    }

    /// Text on top of `fill`.
    var chipInk: Color {
        switch self {
        case .high: Color(hex: 0x1A0507)
        case .medium: Color(hex: 0x1D0E02)
        case .low: Color(hex: 0x1A1503)
        case .unknown: Color(hex: 0x041421)
        }
    }

    /// Text in the level's color on the page background (darker in light mode for contrast).
    var ink: Color {
        switch self {
        case .high: .adaptive(light: 0xB3262B, dark: 0xE5484D)
        case .medium: .adaptive(light: 0xA85314, dark: 0xE8833A)
        case .low: .adaptive(light: 0x7A6410, dark: 0xE2C044)
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
        case .medium: medium
        case .low: low
        case .unknown: neutral
        }
    }

    static let high = CardTone(
        top: .adaptive(light: 0xFDEFF0, dark: 0x3A1720), bottom: .adaptive(light: 0xFAE2E4, dark: 0x220F16),
        border: .adaptive(light: 0xE9A4A9, dark: 0x8E3540), heading: .adaptive(light: 0x3B0D12, dark: 0xF6E3E4),
        secondary: .adaptive(light: 0x8A3138, dark: 0xDDAAAE), divider: .adaptive(light: 0xF0C4C8, dark: 0x5C2730),
        note: .adaptive(light: 0xB3262B, dark: 0xFF8E93)
    )

    static let medium = CardTone(
        top: .adaptive(light: 0xFEF4EA, dark: 0x3A2413), bottom: .adaptive(light: 0xFCE8D6, dark: 0x23160C),
        border: .adaptive(light: 0xEDB98F, dark: 0x93582A), heading: .adaptive(light: 0x3A1E08, dark: 0xF6E8DA),
        secondary: .adaptive(light: 0x8A4A14, dark: 0xE0B793), divider: .adaptive(light: 0xF2D4B9, dark: 0x5E3D20),
        note: .adaptive(light: 0xA85314, dark: 0xF2A766)
    )

    static let low = CardTone(
        top: .adaptive(light: 0xFCF8E6, dark: 0x332B14), bottom: .adaptive(light: 0xF8F0CF, dark: 0x1F1B0D),
        border: .adaptive(light: 0xE2CD78, dark: 0x80702A), heading: .adaptive(light: 0x2E2604, dark: 0xF4EDD3),
        secondary: .adaptive(light: 0x6E5A0E, dark: 0xD6C789), divider: .adaptive(light: 0xEDE1AA, dark: 0x53491D),
        note: .adaptive(light: 0x7A6410, dark: 0xE9CF6A)
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
