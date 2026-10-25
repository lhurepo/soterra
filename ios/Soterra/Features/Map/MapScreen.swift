import MapKit
import SwiftUI

/// Fictional demo geometry around the Ridgeview Fire, east of Santa Rosa. Not real evacuation boundaries.
enum DemoGeo {
    struct Zone: Identifiable {
        let id: String
        let coordinates: [CLLocationCoordinate2D]
        let label: CLLocationCoordinate2D
        /// What the bulletin says the zone covers.
        let covers: String

        /// Ray casting on latitude and longitude, which is accurate enough at the size of a zone.
        func contains(_ point: CLLocationCoordinate2D) -> Bool {
            var isInside = false
            var j = coordinates.count - 1
            for i in coordinates.indices {
                let a = coordinates[i], b = coordinates[j]
                if (a.latitude > point.latitude) != (b.latitude > point.latitude),
                   point.longitude < (b.longitude - a.longitude) * (point.latitude - a.latitude) / (b.latitude - a.latitude) + a.longitude {
                    isInside.toggle()
                }
                j = i
            }
            return isInside
        }
    }

    static let son3A = Zone(id: "SON-3A", coordinates: [
        .init(latitude: 38.4520, longitude: -122.6600), .init(latitude: 38.4550, longitude: -122.6300),
        .init(latitude: 38.4400, longitude: -122.6280), .init(latitude: 38.4370, longitude: -122.6580),
    ], label: .init(latitude: 38.4460, longitude: -122.6440),
    covers: "Zone SON-3A covers Ridgeview Road from Highway 12 to Bennett Valley Road.")

    static let son3B = Zone(id: "SON-3B", coordinates: [
        .init(latitude: 38.4550, longitude: -122.6300), .init(latitude: 38.4580, longitude: -122.6000),
        .init(latitude: 38.4320, longitude: -122.5980), .init(latitude: 38.4400, longitude: -122.6280),
    ], label: .init(latitude: 38.4460, longitude: -122.6140),
    covers: "Zone SON-3B covers the Matanzas Creek area.")

    static let zones = [son3A, son3B]

    static let fireCenter = CLLocationCoordinate2D(latitude: 38.4520, longitude: -122.6050)
    static let fireRadius: CLLocationDistance = 900

    static let roadClosure: [CLLocationCoordinate2D] = [
        .init(latitude: 38.4490, longitude: -122.6680), .init(latitude: 38.4440, longitude: -122.6450),
        .init(latitude: 38.4380, longitude: -122.6320),
    ]

    static let initialRegion = MKCoordinateRegion(
        center: .init(latitude: 38.4440, longitude: -122.6500),
        span: .init(latitudeDelta: 0.06, longitudeDelta: 0.13)
    )

    static func coordinate(of place: MapPlace) -> CLLocationCoordinate2D? {
        switch place {
        case .shelter(let id): DemoData.shelters.first { $0.id == id }?.coordinate
        case .zone(let id): zones.first { $0.id == id }?.label
        case .fire: fireCenter
        case .roadClosure: roadClosure[1]
        }
    }
}

/// A full-screen map of shelters, evacuation zones and closures. Search and filters float on top and fade while
/// the person moves the map; tapping a place slides up its card above the tab bar and pans the map (keeping
/// the zoom) so the place sits above the panel. Zones are shown only from official shapes, and the app never says
/// whether an address is inside one.
struct MapScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var isVoiceOverOn
    @Namespace private var mapScope
    @State private var position: MapCameraPosition = .region(DemoGeo.initialRegion)
    /// The camera and visible span after the last move, so framing a place keeps the person's zoom and rotation.
    @State private var camera: MapCamera?
    @State private var visibleSpan = DemoGeo.initialRegion.span
    @State private var query = ""
    @State private var isChromeHidden = false
    @FocusState private var isSearchFocused: Bool

    private var hasActiveIncident: Bool { model.scenario != .calm }

    private var visibleShelters: [Shelter] {
        DemoData.shelters.filter { shelter in
            (!model.mapFilters.petFriendlyOnly || shelter.takesPets)
                && (query.isEmpty || shelter.name.localizedCaseInsensitiveContains(query))
        }
    }

    var body: some View {
        GeometryReader { geometry in
            MapReader { proxy in
                // The map always fills the screen, so the panel opening never resizes it
                // (a resize makes MapKit refit the region, which looked like a jump in zoom).
                map
                    .ignoresSafeArea(edges: .bottom)
                    .onTapGesture { point in handleTap(at: point, proxy: proxy) }
            }
            .overlay(alignment: .top) {
                if !isChromeHidden {
                    chrome.transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: -12)))
                }
            }
            .overlay(alignment: .bottomTrailing) { mapCorner }
            .overlay(alignment: .bottom) {
                if let place = model.mapSelection {
                    let screenHeight = geometry.size.height + geometry.safeAreaInsets.top + geometry.safeAreaInsets.bottom
                    // No .id(place): switching places updates the open panel instead of sliding a new one in.
                    MapPlacePanel(place: place, maxHeight: screenHeight / 2) { select(nil) }
                        .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .mapScope(mapScope)
        .screenBackground()
        .navigationTitle("Map")
        .navigationBarTitleDisplayMode(.inline)
        .soterraToolbar()
        .onAppear { frame(model.mapSelection) }
        .onChange(of: model.mapSelection) { _, place in frame(place) }
        .onChange(of: model.mapFilters) { dropHiddenSelection() }
        .onChange(of: model.scenario) { dropHiddenSelection() }
    }

    // MARK: Map

    private var zoneColorA: Color {
        model.scenario == .escalated ? SeverityLevel.high.fill : SeverityLevel.medium.fill
    }

    private var map: some View {
        Map(position: $position, scope: mapScope) {
            if hasActiveIncident && model.mapFilters.showsZones {
                zonePolygon(DemoGeo.son3A, color: zoneColorA)
                zonePolygon(DemoGeo.son3B, color: SeverityLevel.medium.fill)
                zoneLabel(DemoGeo.son3A, color: zoneColorA)
                zoneLabel(DemoGeo.son3B, color: SeverityLevel.medium.fill)
                MapCircle(center: DemoGeo.fireCenter, radius: DemoGeo.fireRadius)
                    .foregroundStyle(SeverityLevel.high.fill.opacity(0.35))
                    .stroke(SeverityLevel.high.fill, lineWidth: model.mapSelection == .fire ? 3 : 1.5)
                Annotation("Ridgeview Fire", coordinate: DemoGeo.fireCenter, anchor: .center) {
                    Button { select(.fire) } label: {
                        Image(systemName: "flame.fill")
                            .foregroundStyle(.white)
                            .padding(6)
                            .background(SeverityLevel.high.fill, in: Circle())
                            .frame(width: 44, height: 44)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Ridgeview Fire")
                }
                .annotationTitles(.hidden)
            }
            if hasActiveIncident && model.mapFilters.showsRoads {
                MapPolyline(coordinates: DemoGeo.roadClosure)
                    .stroke(SeverityLevel.high.fill,
                            style: StrokeStyle(lineWidth: model.mapSelection == .roadClosure ? 6 : 4, lineCap: .round, dash: [8, 6]))
            }
            if model.mapFilters.showsShelters {
                ForEach(visibleShelters) { shelter in
                    Annotation(shelter.name, coordinate: shelter.coordinate) {
                        ShelterPin(name: shelter.name, isSelected: shelter.id == model.selectedShelterID) {
                            select(.shelter(shelter.id))
                        }
                    }
                }
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .mapControls {}
        .onMapCameraChange(frequency: .continuous) {
            // Only the person moving the map hides the search and filters, never the app's own camera moves.
            guard position.positionedByUser,
                  !isSearchFocused, !isVoiceOverOn, !isChromeHidden else { return }
            setChromeHidden(true)
        }
        .onMapCameraChange(frequency: .onEnd) { context in
            camera = context.camera
            visibleSpan = context.region.span
        }
    }

    private func zonePolygon(_ zone: DemoGeo.Zone, color: Color) -> some MapContent {
        MapPolygon(coordinates: zone.coordinates)
            .foregroundStyle(color.opacity(model.mapSelection == .zone(zone.id) ? 0.34 : 0.22))
            .stroke(color, lineWidth: model.mapSelection == .zone(zone.id) ? 3 : 2)
    }

    private func zoneLabel(_ zone: DemoGeo.Zone, color: Color) -> some MapContent {
        Annotation("Zone \(zone.id)", coordinate: zone.label, anchor: .center) {
            Button { select(.zone(zone.id)) } label: {
                ZoneLabel(text: zone.id, color: color)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Zone \(zone.id)")
        }
        .annotationTitles(.hidden)
    }

    /// Compass (only while the map is rotated) and the demo notice, which stays visible when the search fades.
    private var mapCorner: some View {
        VStack(alignment: .trailing, spacing: 8) {
            MapCompass(scope: mapScope)
            Text("Demo zones · not real boundaries")
                .font(.caption2.weight(.semibold))
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(Palette.textSecondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Palette.surface.opacity(0.92), in: Capsule())
        }
        .padding(.trailing, 12)
        .padding(.bottom, 28)
    }

    // MARK: Search and filters

    private var chrome: some View {
        VStack(alignment: .leading, spacing: 8) {
            searchField
            filters
        }
        .padding(.top, 8)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Palette.textSecondary)
                .accessibilityHidden(true)
            TextField("Search shelters", text: $query)
                .focused($isSearchFocused)
                .submitLabel(.search)
                .onSubmit {
                    if let first = visibleShelters.first { select(.shelter(first.id)) }
                }
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Palette.textSecondary)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, query.isEmpty ? 14 : 0)
        .frame(minHeight: 48)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .shadow(color: .black.opacity(0.14), radius: 8, y: 3)
        .padding(.horizontal, 16)
    }

    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                FilterChip(title: "Shelters", isOn: model.mapFilters.showsShelters) { model.mapFilters.showsShelters.toggle() }
                FilterChip(title: "Pet-friendly", isOn: model.mapFilters.petFriendlyOnly) { model.mapFilters.petFriendlyOnly.toggle() }
                FilterChip(title: "Zones", isOn: model.mapFilters.showsZones) { model.mapFilters.showsZones.toggle() }
                FilterChip(title: "Roads", isOn: model.mapFilters.showsRoads) { model.mapFilters.showsRoads.toggle() }
            }
            .shadow(color: .black.opacity(0.12), radius: 6, y: 2)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    // MARK: Selection

    private func setChromeHidden(_ isHidden: Bool) {
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { isChromeHidden = isHidden }
    }

    private func select(_ place: MapPlace?) {
        isSearchFocused = false
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.28)) { model.mapSelection = place }
    }

    /// Pans to `place` at the current zoom and rotation, a quarter screen above center so it stays clear of the
    /// panel. Only the center changes, so the move is a smooth pan, never a zoom out and back.
    private func frame(_ place: MapPlace?) {
        guard let place, var center = DemoGeo.coordinate(of: place) else { return }
        center.latitude -= visibleSpan.latitudeDelta * 0.25
        let target: MapCameraPosition = if let camera {
            .camera(MapCamera(centerCoordinate: center, distance: camera.distance,
                              heading: camera.heading, pitch: camera.pitch))
        } else {
            .region(MKCoordinateRegion(center: center, span: visibleSpan))
        }
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.4)) { position = target }
    }

    /// Tapping a place opens its panel; tapping empty map closes the panel and brings the search back.
    private func handleTap(at point: CGPoint, proxy: MapProxy) {
        if isSearchFocused {
            isSearchFocused = false
            return
        }
        if let place = place(at: point, proxy: proxy) {
            select(place)
        } else {
            if model.mapSelection != nil { select(nil) }
            setChromeHidden(false)
        }
    }

    /// What is under a tap, top-most first: shelter pins, zone labels and the fire icon (drawn above the shapes),
    /// then the fire area, the road closure and the zones. The pins and labels are also buttons, for VoiceOver;
    /// a tap reaches both them and this, so the two must agree.
    private func place(at point: CGPoint, proxy: MapProxy) -> MapPlace? {
        let reach: CGFloat = 26
        func offset(to coordinate: CLLocationCoordinate2D) -> CGSize? {
            proxy.convert(coordinate, to: .local).map { CGSize(width: $0.x - point.x, height: $0.y - point.y) }
        }
        func distance(to coordinate: CLLocationCoordinate2D) -> CGFloat {
            offset(to: coordinate).map { hypot($0.width, $0.height) } ?? .infinity
        }

        if model.mapFilters.showsShelters,
           let shelter = visibleShelters.min(by: { distance(to: $0.coordinate) < distance(to: $1.coordinate) }),
           distance(to: shelter.coordinate) <= reach {
            return .shelter(shelter.id)
        }
        guard hasActiveIncident else { return nil }

        if model.mapFilters.showsZones {
            if let zone = DemoGeo.zones.first(where: { zone in
                offset(to: zone.label).map { abs($0.width) <= 36 && abs($0.height) <= 22 } ?? false
            }) {
                return .zone(zone.id)
            }
            if distance(to: DemoGeo.fireCenter) <= reach { return .fire }
        }
        if model.mapFilters.showsZones {
            let edge = CLLocationCoordinate2D(latitude: DemoGeo.fireCenter.latitude + DemoGeo.fireRadius / 111_320,
                                              longitude: DemoGeo.fireCenter.longitude)
            let radius = distance(to: edge) - distance(to: DemoGeo.fireCenter)
            if distance(to: DemoGeo.fireCenter) <= max(reach, abs(radius)) { return .fire }
        }
        if model.mapFilters.showsRoads {
            let points = DemoGeo.roadClosure.compactMap { proxy.convert($0, to: .local) }
            let nearest = zip(points, points.dropFirst()).map { segmentDistance(from: point, $0, $1) }.min() ?? .infinity
            if nearest <= 18 { return .roadClosure }
        }
        if model.mapFilters.showsZones, let coordinate = proxy.convert(point, from: .local),
           let zone = DemoGeo.zones.first(where: { $0.contains(coordinate) }) {
            return .zone(zone.id)
        }
        return nil
    }

    private func segmentDistance(from p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
        let dx = b.x - a.x, dy = b.y - a.y
        let lengthSquared = dx * dx + dy * dy
        guard lengthSquared > 0 else { return hypot(p.x - a.x, p.y - a.y) }
        let t = max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
        return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    }

    /// Closes the panel when a filter or the scenario hides what it describes.
    private func dropHiddenSelection() {
        let filters = model.mapFilters
        let isVisible: Bool = switch model.mapSelection {
        case .shelter(let id): filters.showsShelters && visibleShelters.contains { $0.id == id }
        case .zone, .fire: hasActiveIncident && filters.showsZones
        case .roadClosure: hasActiveIncident && filters.showsRoads
        case nil: true
        }
        if !isVisible { select(nil) }
    }
}

private struct ZoneLabel: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.bold))
            .foregroundStyle(Palette.abyss)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color, in: Capsule())
    }
}

private struct ShelterPin: View {
    let name: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "house.fill")
                .font(.footnote.weight(.bold))
                .foregroundStyle(Palette.abyss)
                .frame(width: isSelected ? 40 : 32, height: isSelected ? 40 : 32)
                .background(Palette.sage, in: Circle())
                .overlay { Circle().strokeBorder(.white, lineWidth: isSelected ? 3 : 2) }
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - Place panel

/// The rounded card that slides up above the tab bar for a tapped place. It fits its details, up to half the
/// screen, then scrolls (large text). Drag the top edge down, or tap Close, to dismiss.
private struct MapPlacePanel: View {
    @Environment(AppModel.self) private var model
    let place: MapPlace
    let maxHeight: CGFloat
    let onClose: () -> Void

    @State private var dragOffset: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ViewThatFits(in: .vertical) {
                details
                ScrollView { details }
            }
        }
        // Switching places crossfades the content while the card stays in place and eases to its new height.
        .id(place)
        .transition(.opacity)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(maxHeight: maxHeight, alignment: .top)
        .fixedSize(horizontal: false, vertical: true)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.14), radius: 14, y: 4)
        .padding(.horizontal, 12)
        .padding(.bottom, 12)
        .offset(y: dragOffset)
        .animation(.easeInOut(duration: 0.25), value: place)
    }

    private var header: some View {
        VStack(spacing: 6) {
            Capsule()
                .fill(Palette.separator)
                .frame(width: 36, height: 5)
                .padding(.top, 8)
                .accessibilityHidden(true)
            HStack(alignment: .top, spacing: 8) {
                Text(title)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Palette.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 10)
                    .accessibilityAddTraits(.isHeader)
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(Palette.textSecondary)
                        .frame(width: 30, height: 30)
                        .background(Palette.surfaceRaised, in: Circle())
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }
            .padding(.leading, 16)
            .padding(.trailing, 6)
        }
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 8)
                .onChanged { dragOffset = max(0, $0.translation.height) }
                .onEnded { value in
                    if value.translation.height > 80 || value.predictedEndTranslation.height > 200 {
                        onClose()
                    } else {
                        withAnimation(.easeOut(duration: 0.2)) { dragOffset = 0 }
                    }
                }
        )
    }

    private var title: String {
        switch place {
        case .shelter(let id): DemoData.shelters.first { $0.id == id }?.name ?? "Shelter"
        case .zone(let id): "Zone \(id)"
        case .fire: "Ridgeview Fire"
        case .roadClosure: "Ridgeview Road"
        }
    }

    @ViewBuilder
    private var details: some View {
        Group {
            switch place {
            case .shelter(let id):
                if let shelter = DemoData.shelters.first(where: { $0.id == id }) {
                    ShelterDetails(shelter: shelter, isMeetingPoint: shelter.id == model.meetingPointID)
                }
            case .zone(let id):
                if let zone = DemoGeo.zones.first(where: { $0.id == id }) {
                    AlertPlaceDetails(alert: zoneAlert(zone), notes: [
                        zone.covers,
                        "Soterra can't tell you if an address is inside this zone. Demo shape, not a real boundary.",
                    ])
                }
            case .fire:
                AlertPlaceDetails(alert: DemoData.fireUpdate, notes: [DemoData.fireUpdate.instruction])
            case .roadClosure:
                AlertPlaceDetails(alert: DemoData.roadClosure, notes: [DemoData.roadClosure.instruction])
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 16)
    }

    /// The bulletin in force for a zone: in the "Order" scenario SON-3A is under the Order, SON-3B still a Warning.
    private func zoneAlert(_ zone: DemoGeo.Zone) -> HazardAlert {
        zone.id == DemoGeo.son3A.id && model.scenario == .escalated ? DemoData.evacuationOrder : DemoData.evacuationWarning
    }
}

/// Two actions side by side, stacked when the text is too large to fit them on one line.
private struct PanelActions<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { content }
            VStack(spacing: 8) { content }
        }
        .padding(.top, 4)
    }
}

private struct ShelterDetails: View {
    @Environment(AppModel.self) private var model
    let shelter: Shelter
    let isMeetingPoint: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(shelter.address) · Shelter · \(shelter.animalPolicy)")
                .font(.subheadline)
                .foregroundStyle(Palette.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { status }
                VStack(alignment: .leading, spacing: 8) { status }
            }
            if shelter.needsReconfirming {
                Label("Checked \(shelter.checkedAt) — capacity needs reconfirming", systemImage: "clock")
                    .font(.footnote)
                    .foregroundStyle(Palette.caution)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(DemoData.emergencyManagement)
                .font(.caption)
                .foregroundStyle(Palette.textSecondary)
            PanelActions {
                Button {
                    let item = MKMapItem(placemark: MKPlacemark(coordinate: shelter.coordinate))
                    item.name = shelter.name
                    item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving])
                } label: {
                    Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond")
                }
                .buttonStyle(FilledButtonStyle())

                Button {
                    model.setMeetingPoint(shelter)
                } label: {
                    Label(isMeetingPoint ? "Meeting point" : "Set meeting point",
                          systemImage: isMeetingPoint ? "checkmark" : "person.2")
                }
                .buttonStyle(OutlineButtonStyle())
                .disabled(isMeetingPoint)
            }
        }
    }
}

private extension ShelterDetails {
    @ViewBuilder var status: some View {
        StatusChip(text: "Open", systemImage: "checkmark", fill: Palette.sage, ink: Palette.abyss)
            .fixedSize()
        Text("\(shelter.spacesAvailable) of \(shelter.capacity) spaces")
            .font(.subheadline)
            .foregroundStyle(Palette.textPrimary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A zone, the fire or the road closure: the bulletin's level, what it says, and its source and time.
private struct AlertPlaceDetails: View {
    @Environment(AppModel.self) private var model
    let alert: HazardAlert
    let notes: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SeverityChip(severity: alert.severity, text: alert.chipText)
            Text(alert.headline)
                .font(.display(20, relativeTo: .title3))
                .foregroundStyle(Palette.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(notes, id: \.self) { note in
                Text(note)
                    .font(.subheadline)
                    .foregroundStyle(Palette.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 2) {
                if let time = alert.times.last(where: { $0.label != "Now" }) {
                    Text("\(time.label) \(time.value)")
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(Palette.textSecondary)
                }
                SourceLine(source: alert.source)
            }
            PanelActions {
                Button("See alert") { model.mapPath.append(.alert(alert.id)) }
                    .buttonStyle(FilledButtonStyle())
                if !model.isOffline {
                    Button("Ask about this") { model.mapPath.append(.assistant(topic: alert.title)) }
                        .buttonStyle(OutlineButtonStyle())
                }
            }
        }
    }
}
