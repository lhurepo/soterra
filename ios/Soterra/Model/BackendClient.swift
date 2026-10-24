import Foundation

/// The backend's public feed: `GET /app/state` (convex/app.ts). Read-only, no account, no secrets.
struct AppStateResponse: Decodable, Equatable {
    let contractVersion: String
    let now: Double
    let mode: String
    let crisisReason: String?
    let alerts: [BackendAlert]

    var isCrisis: Bool { mode == "crisis" }
}

struct BackendAlert: Decodable, Equatable {
    let id: String
    let sourceName: String
    let url: String
    let title: String
    let body: String
    let hazardType: String
    let severity: String
    /// Milliseconds since 1970.
    let issuedAt: Double
    let updatedAt: Double?
    let expiresAt: Double?
    let incidentKey: String?
    let version: Int
    let areaLabels: [String]
    let isFixture: Bool
}

enum BackendError: Error, Equatable {
    case badStatus(Int)
    case incompatibleContract(String)
}

protocol AppStateFetching: Sendable {
    func fetchAppState() async throws -> AppStateResponse
}

struct BackendClient: AppStateFetching {
    /// The contract major version this build understands (src/contracts/version.ts).
    static let supportedContractMajor = "1"

    var baseURL: URL = DemoConfig.backendURL
    var session: URLSession = .shared

    func fetchAppState() async throws -> AppStateResponse {
        var request = URLRequest(url: baseURL.appending(path: "app/state"))
        request.timeoutInterval = 8
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw BackendError.badStatus(http.statusCode)
        }
        return try Self.decode(data)
    }

    static func decode(_ data: Data) throws -> AppStateResponse {
        let state = try JSONDecoder().decode(AppStateResponse.self, from: data)
        let major = state.contractVersion.split(separator: ".").first.map(String.init) ?? state.contractVersion
        guard major == supportedContractMajor else { throw BackendError.incompatibleContract(state.contractVersion) }
        return state
    }
}
