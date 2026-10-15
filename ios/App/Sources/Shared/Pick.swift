import SwiftUI

/// (§16 masks) A gallery pick that feels instant: the tapped tile shows as picked at once (`show(_:)`) and the patch goes
/// out on the next turn of the main run loop (`AppModel.editSoon`), so the haptic and the ring never wait for the
/// store, the encoder or the network. When the store catches up (`settle`) or two seconds pass, the store wins again.
struct OptimisticPick: DynamicProperty {
    @State private var tapped: String?
    @State private var at = Date.distantPast

    /// What to show as picked: the tile tapped last while it is fresh, else what the store says.
    func show(_ store: String?) -> String? {
        if let tapped, Date().timeIntervalSince(at) < 2 { return tapped }
        return store
    }

    /// The tile tapped just now.
    func tap(_ id: String?) {
        tapped = id
        at = Date()
    }

    /// The store has the pick (or another change): show what it says.
    func settle() { tapped = nil }
}
