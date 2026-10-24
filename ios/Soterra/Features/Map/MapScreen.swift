import MapKit
import SwiftUI

/// Fictional demo geometry around the Ridgeview Fire, east of Santa Rosa. Not real evacuation boundaries.
enum DemoGeo {
    struct Zone: Identifiable {
        let id: String
        let coordinates: [CLLocationCoordinate2D]
        let label: CLLocationCoordinate2D
    }

    static let son3A = Zone(id: "SON-3A", coordinates: [
        .init(latitude: 38.4520, longitude: -122.6600), .init(latitude: 38.4550, longitude: -122.6300),
        .init(latitude: 38.4400, longitude: -122.6280), .init(latitude: 38.4370, longitude: -122.6580),
    ], label: .init(latitude: 38.4460, longitude: -122.6440))

    static let son3B = Zone(id: "SON-3B", coordinates: [
        .init(latitude: 38.4550, longitude: -122.6300), .init(latitude: 38.4580, longitude: -122.6000),
        .init(latitude: 38.4320, longitude: -122.5980), .init(latitude: 38.4400, longitude: -122.6280),
    ], label: .init(latitude: 38.4460, longitude: -122.6140))

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
}

/// Shelters, evacuation zones and closures on one map. Zones are shown only from official shapes, and the
/// app never says whether an address is inside one.
struct MapScreen: View {
    @Environment(AppModel.self) private var model
    @State private var position: MapCameraPosition = .region(DemoGeo.initialRegion)
    @State private var query = ""

    private var hasActiveIncident: Bool { model.scenario != .calm }

    private var visibleShelters: [Shelter] {
        DemoData.shelters.filter { shelter in
            (!model.mapFilters.petFriendlyOnly || shelter.takesPets)
                && (query.isEmpty || shelter.name.localizedCaseInsensitiveContains(query))
        }
    }

    private var selectedShelter: Shelter? {
        DemoData.shelters.first { $0.id == model.selectedShelterID }
    }

    var body: some View {
        VStack(spacing: 0) {
            searchField
            filters
            map
        }
        .screenBackground()
        .navigationTitle("Map")
        .soterraToolbar()
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let shelter = selectedShelter {
                ShelterCard(shelter: shelter, isMeetingPoint: shelter.id == model.meetingPointID) {
                    model.selectedShelterID = nil
                }
            }
        }
        .onChange(of: model.selectedShelterID) {
            guard let shelter = selectedShelter else { return }
            withAnimation { position = .region(MKCoordinateRegion(center: shelter.coordinate, span: DemoGeo.initialRegion.span)) }
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Palette.textSecondary)
                .accessibilityHidden(true)
            TextField("Search shelters", text: $query)
                .submitLabel(.search)
                .onSubmit {
                    if let first = visibleShelters.first { model.selectedShelterID = first.id }
                }
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.textSecondary)
                }
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, 16)
        .padding(.top, 4)
    }

    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                FilterChip(title: "Shelters", isOn: model.mapFilters.showsShelters) { model.mapFilters.showsShelters.toggle() }
                FilterChip(title: "Pet-friendly", isOn: model.mapFilters.petFriendlyOnly) { model.mapFilters.petFriendlyOnly.toggle() }
                FilterChip(title: "Zones", isOn: model.mapFilters.showsZones) { model.mapFilters.showsZones.toggle() }
                FilterChip(title: "Roads", isOn: model.mapFilters.showsRoads) { model.mapFilters.showsRoads.toggle() }
            }
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 4)
    }

    private var zoneColorA: Color {
        model.scenario == .escalated ? SeverityLevel.high.fill : SeverityLevel.medium.fill
    }

    private var map: some View {
        Map(position: $position) {
            if hasActiveIncident && model.mapFilters.showsZones {
                MapPolygon(coordinates: DemoGeo.son3A.coordinates)
                    .foregroundStyle(zoneColorA.opacity(0.22))
                    .stroke(zoneColorA, lineWidth: 2)
                MapPolygon(coordinates: DemoGeo.son3B.coordinates)
                    .foregroundStyle(SeverityLevel.medium.fill.opacity(0.22))
                    .stroke(SeverityLevel.medium.fill, lineWidth: 2)
                Annotation("Zone SON-3A", coordinate: DemoGeo.son3A.label, anchor: .center) {
                    ZoneLabel(text: "SON-3A", color: zoneColorA)
                }
                .annotationTitles(.hidden)
                Annotation("Zone SON-3B", coordinate: DemoGeo.son3B.label, anchor: .center) {
                    ZoneLabel(text: "SON-3B", color: SeverityLevel.medium.fill)
                }
                .annotationTitles(.hidden)
                MapCircle(center: DemoGeo.fireCenter, radius: DemoGeo.fireRadius)
                    .foregroundStyle(SeverityLevel.high.fill.opacity(0.35))
                    .stroke(SeverityLevel.high.fill, lineWidth: 1.5)
                Annotation("Ridgeview Fire", coordinate: DemoGeo.fireCenter, anchor: .center) {
                    Image(systemName: "flame.fill")
                        .foregroundStyle(.white)
                        .padding(6)
                        .background(SeverityLevel.high.fill, in: Circle())
                }
                .annotationTitles(.hidden)
            }
            if hasActiveIncident && model.mapFilters.showsRoads {
                MapPolyline(coordinates: DemoGeo.roadClosure)
                    .stroke(SeverityLevel.high.fill, style: StrokeStyle(lineWidth: 4, lineCap: .round, dash: [8, 6]))
            }
            if model.mapFilters.showsShelters {
                ForEach(visibleShelters) { shelter in
                    Annotation(shelter.name, coordinate: shelter.coordinate) {
                        ShelterPin(isSelected: shelter.id == model.selectedShelterID) {
                            model.selectedShelterID = shelter.id
                        }
                    }
                }
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .mapControls {
            MapCompass()
            MapScaleView()
        }
        .overlay(alignment: .topLeading) {
            Text("Demo zones · not real boundaries")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Palette.textSecondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Palette.surface.opacity(0.9), in: Capsule())
                .padding(8)
        }
    }
}

private struct ZoneLabel: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color, in: Capsule())
    }
}

private struct ShelterPin: View {
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
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// The selected shelter, above the tab bar.
private struct ShelterCard: View {
    @Environment(AppModel.self) private var model
    let shelter: Shelter
    let isMeetingPoint: Bool
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(shelter.name)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Palette.textPrimary)
                    Text("\(shelter.address) · Shelter · \(shelter.animalPolicy)")
                        .font(.subheadline)
                        .foregroundStyle(Palette.textSecondary)
                }
                Spacer()
                StatusChip(text: "Open", systemImage: "checkmark", fill: Palette.sage, ink: Palette.abyss)
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(Palette.textSecondary)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Close")
            }
            Text("\(shelter.spacesAvailable) of \(shelter.capacity) spaces")
                .font(.subheadline)
                .foregroundStyle(Palette.textPrimary)
            if shelter.needsReconfirming {
                Label("Checked \(shelter.checkedAt) — capacity needs reconfirming", systemImage: "clock")
                    .font(.footnote)
                    .foregroundStyle(Palette.caution)
            }
            Text(DemoData.emergencyManagement)
                .font(.caption)
                .foregroundStyle(Palette.textSecondary)
            HStack(spacing: 8) {
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
        .padding(16)
        .background(Palette.surface)
        .overlay(alignment: .top) { Rectangle().fill(Palette.separator).frame(height: 1) }
    }
}
