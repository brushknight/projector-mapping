import SwiftUI
import PMKit
import PMDesign

/// The attachment scrub rail (static and live tabs): "full frame" (nothing in front of the light) at the top, then
/// every plate in browse order (windows, nature, sky, patterns, beams). Each plate replaces the selected attachment and
/// keeps its placement, like a tap in the browser; the full frame takes them all off, and the next plate gets the
/// placement back.
struct AttachmentRail: View {
    var mode: String
    @Binding var selected: String?
    @Environment(AppModel.self) private var model
    /// the attachment the full frame took off, so scrubbing back onto a plate keeps its placement
    @State private var kept: Attachment?

    var body: some View {
        let cats = model.catalog.goboCategories.filter { !model.catalog.gobos(in: $0.id).isEmpty }
        let full = ScrubEntry(id: "", name: "full frame", group: "nothing in front of the light") {
            Palette.ink.overlay { Icon(.sun, size: 28).foregroundStyle(Palette.ground) }
        }
        let entries = [full] + cats.flatMap { c in
            model.catalog.gobos(in: c.id).map { g in ScrubEntry(id: g.id, name: g.name, group: c.name) { GoboThumb(gobo: g.id) } }
        }
        ScrubRail(entries: entries, current: model.attachments(mode).last?.gobo ?? "", hideKey: "attachments") { e in
            send(e.id.isEmpty ? nil : model.catalog.gobo(e.id))
        }
    }

    /// Puts this plate in front of the light in place of the selected attachment, keeping its placement (§16); nil takes
    /// every attachment off (the full frame is lit).
    func send(_ g: GoboItem?) {
        guard model.sceneId != nil else { model.flash("No scene is active on the projector."); return }
        let list = model.attachments(mode)
        guard let g else {
            if list.isEmpty { return }
            kept = list.first { $0.id == selected } ?? list.last
            model.pickFast(path: ScenePath.attachments(mode), value: [], fallback: .replaceAttachments(mode: mode, attachments: []))
            selected = nil
            return
        }
        if list.count == 1, list[0].gobo == g.id { return }
        let a = AttachmentSwap.replacing(list.first { $0.id == selected } ?? list.last ?? kept, with: g, catalog: model.catalog)
        guard let json = try? JSONValue(encoding: a) else { return }
        model.pickFast(path: ScenePath.attachments(mode), value: [json], fallback: .replaceAttachments(mode: mode, attachments: [json]))
        selected = a.id
    }
}
