import SwiftUI
import PMKit
import PMDesign

/// The static tab (protocol §15): a spotlight with attachments in front of it. The hero (drag sideways to slide the
/// light), the attachment browser, what is in front of the light and the selected one's controls, the light (focus
/// ring, colour, colour layer, effects), the lens, the frame slide, motion, presets.
struct StaticTab: View {
    @Environment(AppModel.self) private var model
    @State private var selectedId: String?

    var body: some View {
        let list = model.attachments("static")
        let selected = list.first { $0.id == selectedId } ?? list.last
        TabPage {
            TabHeader(title: "static")
            Hero { BackdropArt(focus: .light) } leading: { OnAirLabel(detail: detail(list)) } trailing: { FormatLabel() }
                .modifier(HeroSlide(mode: "static"))
            AttachmentBrowser(mode: "static", selected: $selectedId)
            AttachmentList(mode: "static", selected: $selectedId)
            if let selected {
                AttachmentControls(mode: "static", attachment: selected)
            } else {
                EmptyCard(title: "nothing in front of the light", detail: "the whole frame is lit. pick an attachment above to shape it.")
            }
            LightCard(mode: "static")
            LightColorCard(mode: "static")
            SlideCard(mode: "static")
            MotionCard(mode: "static", attachment: selected)
                .id("motion")
            LensCard(mode: "static")
            AccentCard()
            PresetsSection(mode: "static")
        }
        // the one-finger scrub rail: slide along the right edge to run through every attachment
        .overlay(alignment: .trailing) {
            AttachmentRail(mode: "static", selected: $selectedId).padding(.top, 130).padding(.bottom, 150).padding(.trailing, 2)
        }
        .onChange(of: list.map(\.id)) { _, ids in
            if let s = selectedId, !ids.contains(s) { selectedId = nil }
        }
    }

    func detail(_ list: [Attachment]) -> String? {
        switch list.count {
        case 0: nil
        case 1: list[0].name
        default: "\(list.count) attachments"
        }
    }
}
