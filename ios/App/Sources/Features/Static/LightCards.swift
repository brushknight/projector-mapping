import SwiftUI
import PMKit
import PMDesign

// Protocol §15 on the phone: a stack light with attachments in front of it (the static tab, and the live tab's light).
// Every card takes the stack (`static` or `live`); drags go out as `param`, structural edits as intents by id.

// MARK: - Light

/// Intensity and the focus ring; a live stack without a light offers to light it.
struct LightCard: View {
    var mode: String
    @Environment(AppModel.self) private var model

    var body: some View {
        let live = model.hub.isLive
        if let light = model.light(mode) {
            Card {
                CapRow("light", padding: 2) { CapText(light.colorLayer == nil ? Fmt.kelvin(light.color.kelvin) : "colour layer") }
                FillSlider("intensity", icon: .sun, value: light.intensity, enabled: live) { model.lightParam(mode, ["intensity"], .number(round2($0))) }
                FillSlider("focus", icon: .softness, value: light.focus, enabled: live, format: Fmt.focus) {
                    model.lightParam(mode, ["focus"], .number(round2($0)))
                }
            }
        } else {
            Card(spacing: 10) {
                Text("no light").font(.pm(15)).foregroundStyle(Palette.ink)
                Text("the layers draw over black. light the stack to put attachments in front of a light.")
                    .font(.pm(13)).foregroundStyle(Palette.dim).lineSpacing(3)
                WideButton("light it", icon: .sun) { model.edit(.setLight(mode: mode, field: ["intensity"], value: 0.85)) }
            }
        }
    }
}

func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

/// White (CCT, tint, presets) / color (hue, saturation) / colour layer (gradient or animated generator) / effects.
struct LightColorCard: View {
    var mode: String
    @Environment(AppModel.self) private var model
    @State private var segment: Int?

    static let cctGradient = Gradient(colors: [0xFF880D, 0xFFAA5F, 0xFFC392, 0xFFD7B7, 0xFFE7D4, 0xFFF6EC, 0xF9F6FF, 0xE3E9FF, 0xD7E2FF, 0xCFDDFF, 0xC9DAFF].map { Color(hex: $0) })
    static let tintGradient = Gradient(colors: [Color(hex: 0x7DD67A), Color(hex: 0xEEEEEE), Color(hex: 0xD67ACB)])
    static let hueGradient = Gradient(colors: [0xFF0000, 0xFF7F00, 0xFFFF00, 0x7FFF00, 0x00FF00, 0x00FF7F, 0x00FFFF, 0x007FFF, 0x0000FF, 0x7F00FF, 0xFF00FF, 0xFF007F].map { Color(hex: $0) })

    var body: some View {
        if let light = model.light(mode) {
            let initial = model.debugScreen == .staticfx ? 3 : (light.colorLayer != nil ? 2 : (light.color.mode == "hsi" ? 1 : 0))
            let seg = segment ?? initial
            let live = model.hub.isLive
            Card {
                Segmented(["white", "color", "layer", "effects"], selected: seg) { n in
                    segment = n
                    if n == 0, light.color.mode != "cct" || light.colorLayer != nil { pickOwn("cct", light) }
                    if n == 1, light.color.mode != "hsi" || light.colorLayer != nil { pickOwn("hsi", light) }
                }
                switch seg {
                case 0: white(light, live: live)
                case 1: hsi(light, live: live)
                case 2: colorLayer(light, live: live)
                default: effects(light, live: live)
                }
            }
        }
    }

    /// Back to the light's own colour (drops a colour layer).
    func pickOwn(_ colorMode: String, _ light: StackLight) {
        if light.colorLayer != nil { model.edit(.setLight(mode: mode, field: ["colorLayer"], value: .null)) }
        if light.color.mode != colorMode { model.edit(.setLight(mode: mode, field: ["color", "mode"], value: .string(colorMode))) }
    }

    func stripRow(_ title: String, value: String) -> some View {
        HStack {
            Text(title).capStyle()
            Spacer()
            Text(value).font(.pmMono(15)).foregroundStyle(Palette.ink).monospacedDigit()
        }
        .padding(.horizontal, 2)
    }

    @ViewBuilder
    func white(_ light: StackLight, live: Bool) -> some View {
        VStack(spacing: 9) {
            stripRow("temperature", value: Fmt.kelvin(light.color.kelvin))
            StripSlider(gradient: Self.cctGradient, value: (light.color.kelvin - 2000) / 8000, enabled: live) { f in
                model.lightParam(mode, ["color", "kelvin"], .number(((2000 + f * 8000) / 50).rounded() * 50))
            }
        }
        VStack(spacing: 9) {
            stripRow("tint", value: Fmt.tint(light.color.tint))
            StripSlider(gradient: Self.tintGradient, value: (light.color.tint + 1) / 2, enabled: live) { f in
                model.lightParam(mode, ["color", "tint"], .number(((f * 2 - 1) * 100).rounded() / 100))
            }
        }
        HStack(spacing: 8) {
            ForEach(model.catalog.light?.cctPresets ?? []) { p in
                PillButton(p.id, on: abs(light.color.kelvin - p.kelvin) < 1) {
                    model.edit(.setLight(mode: mode, field: ["color", "kelvin"], value: .number(p.kelvin)))
                }
            }
        }
        if light.colorLayer != nil { note("a colour layer colours the light now. pick white or color to use the light's own colour.") }
    }

    @ViewBuilder
    func hsi(_ light: StackLight, live: Bool) -> some View {
        VStack(spacing: 9) {
            stripRow("hue", value: "\(Int(light.color.hue.rounded()))°")
            StripSlider(gradient: Self.hueGradient, value: light.color.hue / 360, enabled: live) { f in
                model.lightParam(mode, ["color", "hue"], .number((f * 360).rounded()))
            }
        }
        VStack(spacing: 9) {
            stripRow("saturation", value: Fmt.percent(light.color.sat))
            StripSlider(gradient: Gradient(colors: [.white, Color(hue: light.color.hue / 360, saturation: 0.8, brightness: 0.81)]),
                        value: light.color.sat, enabled: live) { f in
                model.lightParam(mode, ["color", "sat"], .number((f * 100).rounded() / 100))
            }
        }
    }

    func note(_ text: String) -> some View {
        Text(text).font(.pm(13)).foregroundStyle(Palette.dim).padding(.horizontal, 2).lineSpacing(2)
    }

    @ViewBuilder
    func colorLayer(_ light: StackLight, live: Bool) -> some View {
        note("colour the light with a gradient or an animated colour. the attachments still shape it.")
        let gens = model.catalog.colorGenerators
        let grads = model.catalog.gradients
        FlowLayout(spacing: 8) {
            PillButton("own colour", on: light.colorLayer == nil) { model.edit(.setLight(mode: mode, field: ["colorLayer"], value: .null)) }
            ForEach(gens) { g in
                PillButton(g.name, icon: g.animated ? .wind : nil, iconSize: 13, on: light.colorLayer?.kind == "generator" && light.colorLayer?.ref == g.id) {
                    set(ColorLayer(kind: "generator", ref: g.id, params: Catalog.defaults(g.params)))
                }
            }
            ForEach(grads) { g in
                PillButton(g.name, on: light.colorLayer?.kind == "gradient" && light.colorLayer?.ref == g.id) {
                    var params = Catalog.defaults(model.catalog.gradientParams)
                    for (k, v) in g.defaults { params[k] = v }
                    set(ColorLayer(kind: "gradient", ref: g.id, params: params))
                }
            }
        }
        if let layer = light.colorLayer {
            let spec = layer.kind == "generator" ? model.catalog.colorGenerator(layer.ref)?.params : model.catalog.gradientParams
            ForEach((spec?.items ?? []).filter { $0.spec.isNumeric }) { p in
                let v = layer.params[p.key]?.double ?? p.spec.default?.double ?? p.spec.lower
                FillSlider(p.spec.label ?? p.key, icon: .param(p.key), value: p.spec.fraction(v), enabled: live,
                           format: { Fmt.param(p.key, p.spec, p.spec.value(at: $0)) }) { f in
                    model.lightParam(mode, ["colorLayer", "params", p.key], .number(p.spec.value(at: f)))
                }
            }
        }
    }

    func set(_ layer: ColorLayer) {
        model.edit(.setLight(mode: mode, field: ["colorLayer"], value: (try? JSONValue(encoding: layer)) ?? .null))
    }

    @ViewBuilder
    func effects(_ light: StackLight, live: Bool) -> some View {
        note("effects animate the light itself, like the fx menu on an amaran.")
        let kinds = (model.catalog.light?.fx ?? []).filter { $0 != "none" }
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4), spacing: 10) {
            ForEach(kinds, id: \.self) { k in
                FXTile(k, icon: .fx(k), on: light.fx.kind == k) {
                    model.edit(.setLight(mode: mode, field: ["fx", "kind"], value: .string(light.fx.kind == k ? "none" : k)))
                }
            }
        }
        FillSlider("speed", icon: .wind, value: light.fx.speed, enabled: live) { model.lightParam(mode, ["fx", "speed"], .number(round2($0))) }
    }
}

/// The lens: colour fringe, vignette, dust and haze.
struct LensCard: View {
    var mode: String
    @Environment(AppModel.self) private var model

    var body: some View {
        if let light = model.light(mode) {
            let live = model.hub.isLive
            let specs = model.catalog.stackLight.params
            Card {
                CapRow("lens", padding: 2) { CapText("like a real spotlight") }
                ForEach([("fringe", light.fringe), ("vignette", light.vignette), ("haze", light.haze)], id: \.0) { key, v in
                    FillSlider(specs[key]?.label ?? key, icon: key == "haze" ? .grain : .softness, value: v, enabled: live) {
                        model.lightParam(mode, [key], .number(round2($0)))
                    }
                }
            }
        }
    }
}

// MARK: - Attachments

/// The categorized attachment browser: windows, blinds, nature, patterns, spots. A tap puts that one attachment in
/// front of the light; "add on top" stacks another (masks multiply).
struct AttachmentBrowser: View {
    var mode: String
    @Binding var selected: String?
    @Environment(AppModel.self) private var model
    @State private var category: String?
    @State private var addOnTop = false

    var body: some View {
        let cats = model.catalog.goboCategories.filter { !model.catalog.gobos(in: $0.id).isEmpty }
        let current = category ?? model.attachments(mode).last.flatMap { model.catalog.gobo($0.gobo)?.browseCategory } ?? cats.first?.id ?? "windows"
        let items = model.catalog.gobos(in: current)
        let onWall = Set(model.attachments(mode).map(\.gobo))
        VStack(alignment: .leading, spacing: 10) {
            CapRow("attachments", "\(model.catalog.gobos.count)")
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(cats) { c in PillButton(c.name, on: c.id == current) { category = c.id } }
                }
                .padding(.horizontal, 16)
            }
            .scrollIndicators(.hidden)
            .padding(.horizontal, -16)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 12) {
                ForEach(items) { g in
                    AttachmentTile(item: g, on: onWall.contains(g.id)) { pick(g, add: addOnTop) }
                        .contextMenu {
                            Button("put only this one on", systemImage: "square") { pick(g, add: false) }
                            Button("add it on top", systemImage: "square.2.layers.3d") { pick(g, add: true) }
                        } preview: {
                            VStack(alignment: .leading, spacing: 6) {
                                GoboThumb(gobo: g.id).frame(width: 288, height: 162).clipped()
                                Text(g.description).font(.pm(13)).foregroundStyle(Palette.ink).padding(10)
                            }
                            .background(Palette.card)
                        }
                }
            }
            HStack(spacing: 10) {
                PillButton(addOnTop ? "adding on top" : "add on top", icon: .plus, on: addOnTop) { addOnTop.toggle() }
                Text(addOnTop ? "the next tap stacks another attachment in front of the light." : "a tap replaces what is in front of the light. hold a tile for more.")
                    .font(.pm(12)).foregroundStyle(Palette.dim).lineLimit(2)
            }
            .padding(.horizontal, 2)
        }
    }

    func pick(_ g: GoboItem, add: Bool) {
        guard model.sceneId != nil else { model.flash("No scene is active on the projector."); return }
        let a = model.catalog.newAttachment(g)
        guard let json = try? JSONValue(encoding: a) else { return }
        let list = model.attachments(mode)
        if add {
            model.edit(.addAttachment(mode: mode, attachment: json))
        } else {
            if list.count == 1, list[0].gobo == g.id { selected = list[0].id; return }
            model.edit(.replaceAttachments(mode: mode, attachments: [json]))
            // A fresh light keeps the focus that suits this gobo when the light is still at its default.
            if let f = g.focus, let light = model.light(mode), list.isEmpty, abs(light.focus - 0.7) < 0.001 {
                model.edit(.setLight(mode: mode, field: ["focus"], value: .number(f)))
            }
        }
        selected = a.id
        addOnTop = false
    }
}

/// A 16:9 attachment tile: the server's render (or the native art) and its name.
struct AttachmentTile: View {
    var item: GoboItem
    var on: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                Color.clear
                    .aspectRatio(16 / 10, contentMode: .fit)
                    .overlay { GoboThumb(gobo: item.id) }
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .selectionRing(on, radius: 14)
                Text(item.name).font(.pm(12)).tracking(0.2).lineLimit(1)
                    .foregroundStyle(on ? Palette.ink : Palette.dim)
                    .padding(.horizontal, 2)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.name)
        .accessibilityHint(item.description)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// What is in front of the light, top first: select one to shape it, hide it, or take it off.
struct AttachmentList: View {
    var mode: String
    @Binding var selected: String?
    @Environment(AppModel.self) private var model

    var body: some View {
        let list = Array(model.attachments(mode).reversed())
        let sel = list.first { $0.id == selected }?.id ?? list.first?.id
        if list.count > 1 {
            ListCard {
                ForEach(Array(list.enumerated()), id: \.element.id) { n, a in
                    let on = a.id == sel
                    ListRow(a.name.isEmpty ? a.gobo : a.name, meta: meta(a), on: on, separator: n > 0 && list[n - 1].id != sel) {
                        GoboThumb(gobo: a.gobo)
                    } trailing: {
                        RowIconButton(a.visible ? .eye : .eyeOff, label: a.visible ? "hide \(a.name)" : "show \(a.name)") {
                            model.edit(.setAttachmentField(attachmentId: a.id, field: ["visible"], value: .bool(!a.visible)))
                        }
                        RowIconButton(.trash, size: 18, label: "take \(a.name) off") {
                            if selected == a.id { selected = nil }
                            model.edit(.removeAttachment(attachmentId: a.id))
                        }
                    }
                    .opacity(a.visible || on ? 1 : 0.55)
                    .contentShape(Rectangle())
                    .onTapGesture { selected = a.id }
                }
            }
        }
    }

    func meta(_ a: Attachment) -> String {
        var parts = ["blocks \(Fmt.percent(a.opacity))", String(format: "%.1f×", a.scale)]
        if a.rotation != 0 { parts.append(Fmt.signed(a.rotation, unit: "°")) }
        if a.motion?.on == true { parts.append("moving") }
        return parts.joined(separator: " · ")
    }
}

/// The selected attachment: how much light it blocks, rotation, scale, position, and its shape params.
struct AttachmentControls: View {
    var mode: String
    var attachment: Attachment
    @Environment(AppModel.self) private var model
    @State private var showShape = false

    static let fallback: [String: ParamSpec] = [
        "opacity": ParamSpec(type: "number", min: 0, max: 1, label: "blocks"),
        "rotation": ParamSpec(type: "number", min: -180, max: 180, label: "rotation", unit: "°"),
        "scale": ParamSpec(type: "number", min: 0.25, max: 4, label: "scale", unit: "×"),
        "offsetX": ParamSpec(type: "number", min: -2, max: 2, label: "left / right"),
        "offsetY": ParamSpec(type: "number", min: -2, max: 2, label: "up / down"),
    ]

    var body: some View {
        let a = attachment
        let live = model.hub.isLive
        let specs = model.catalog.stackLight.attachmentParams
        let shape = model.catalog.shapeParams(a.gobo).filter { $0.spec.isNumeric }
        Card {
            HStack {
                Text(a.name.isEmpty ? a.gobo : a.name).capStyle()
                Spacer()
                if model.attachments(mode).count == 1 {
                    Button { model.edit(.removeAttachment(attachmentId: a.id)) } label: {
                        Text("take it off").font(.pm(12)).foregroundStyle(Palette.dim)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 2)
            ForEach(["opacity", "rotation", "scale", "offsetX", "offsetY"], id: \.self) { key in
                let spec = specs[key] ?? Self.fallback[key]!
                let v = value(a, key)
                FillSlider(spec.label ?? key, icon: icon(key), value: spec.fraction(v), enabled: live,
                           format: { format(key, spec, spec.value(at: $0)) }) { f in
                    var next = spec.value(at: f)
                    next = key == "rotation" ? next.rounded() : round2(next)
                    model.attachmentParam(mode, a.id, [key], .number(next))
                }
            }
            if !shape.isEmpty {
                Button { withAnimation(.snappy) { showShape.toggle() } } label: {
                    HStack {
                        Text("shape").capStyle()
                        Spacer()
                        Text(showShape ? "hide" : "\(shape.count) controls").font(.pm(12)).foregroundStyle(Palette.dim)
                        Icon(.chevronRight, size: 14).foregroundStyle(Palette.dim).rotationEffect(.degrees(showShape ? 90 : 0))
                    }
                    .padding(.horizontal, 2).padding(.top, 4)
                    .frame(minHeight: 36)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(showShape ? "hide the shape controls" : "show the shape controls")
            }
            if showShape {
                ForEach(shape) { p in
                    let v = a.param(p.key) ?? p.spec.default?.double ?? p.spec.lower
                    FillSlider(p.spec.label ?? p.key, icon: .param(p.key), value: p.spec.fraction(v), enabled: live,
                               format: { Fmt.param(p.key, p.spec, p.spec.value(at: $0)) }) { f in
                        let next = p.spec.value(at: f)
                        model.attachmentParam(mode, a.id, ["params", p.key], .number(p.spec.type == "integer" ? next : round2(next)))
                    }
                }
            }
        }
    }

    func value(_ a: Attachment, _ key: String) -> Double {
        switch key {
        case "opacity": a.opacity
        case "rotation": a.rotation
        case "scale": a.scale
        case "offsetX": a.offsetX
        default: a.offsetY
        }
    }

    func icon(_ key: String) -> LineIcon {
        switch key {
        case "rotation": .rotate
        case "scale": .plus
        case "opacity": .sun
        default: .angle
        }
    }

    func format(_ key: String, _ spec: ParamSpec, _ v: Double) -> String {
        switch key {
        case "opacity": Fmt.percent(v)
        case "offsetX", "offsetY": Fmt.slide(v)
        default: Fmt.param(key, spec, v)
        }
    }
}

// MARK: - Frame slide

/// The frame slide (§15 `light.slide`): the whole composed light pans inside the frame along the long axis.
struct SlideCard: View {
    var mode: String
    @Environment(AppModel.self) private var model

    var body: some View {
        if let light = model.light(mode) {
            let axis = model.slideAxis
            let v = axis == "x" ? light.slide.x : light.slide.y
            Card(spacing: 10) {
                HStack {
                    Text("frame slide").capStyle()
                    Spacer()
                    Text(Fmt.slide(v)).font(.pmMono(15)).foregroundStyle(Palette.ink).monospacedDigit()
                    PillButton("reset", on: false) { model.lightParam(mode, ["slide", axis], 0) }
                        .opacity(v == 0 ? 0.4 : 1)
                        .disabled(v == 0)
                }
                .padding(.horizontal, 2)
                ZStack {
                    StripSlider(gradient: Gradient(colors: [Palette.track, Palette.off, Palette.track]), value: (v + 1) / 2, enabled: model.hub.isLive) { f in
                        let next = round2(f * 2 - 1)
                        model.lightParam(mode, ["slide", axis], .number(abs(next) < 0.03 ? 0 : next))
                    }
                    Rectangle().fill(Palette.dim).frame(width: 1, height: 18).allowsHitTesting(false)
                }
                Text(axis == "x" ? "drag sideways here or on the picture to slide the light across the wall. what slides out is gone."
                                 : "drag here or sideways on the picture to slide the light up or down the wall. what slides out is gone.")
                    .font(.pm(12)).foregroundStyle(Palette.dim).lineSpacing(2).padding(.horizontal, 2)
            }
        }
    }
}

extension AppModel {
    /// The slide's long axis: x in landscape, y in portrait.
    var slideAxis: String { active.setup?.output.isPortrait == true ? "y" : "x" }
}

/// The hero's sideways drag: slides the light along the long axis (the hero's width is the whole frame).
struct HeroSlide: ViewModifier {
    var mode: String
    @Environment(AppModel.self) private var model
    @State private var start: Double?
    @State private var width: CGFloat = 1

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = max(1, $0) }
            .horizontalPan(enabled: model.hub.isLive && model.light(mode) != nil) { p in
                let axis = model.slideAxis
                switch p.phase {
                case .began, .changed:
                    let light = model.light(mode)
                    if start == nil { start = axis == "x" ? light?.slide.x ?? 0 : light?.slide.y ?? 0 }
                    let next = min(1, max(-1, (start ?? 0) + Double(p.translation.width / width)))
                    model.lightParam(mode, ["slide", axis], .number(round2(next)))
                case .ended, .cancelled:
                    start = nil
                }
            }
    }
}

// MARK: - Motion

/// Motion presets on the whole light or on the selected attachment, the speed (log scale, 5 s … 2 h, keeping the
/// place), play / pause and off (§15).
struct MotionCard: View {
    var mode: String
    var attachment: Attachment?
    @Environment(AppModel.self) private var model
    @State private var onAttachment = false
    @State private var dragDuration: Double?

    var body: some View {
        if model.light(mode) != nil {
            let target = onAttachment ? attachment : nil
            let motion = target?.motion ?? (target == nil ? model.light(mode)?.motion : nil)
            let live = model.hub.isLive
            Card {
                HStack {
                    Text("motion").capStyle()
                    Spacer()
                    if let motion { CapText(motion.on ? "moving" : "paused") }
                }
                .padding(.horizontal, 2)
                if let attachment {
                    Segmented(["whole light", attachment.name.isEmpty ? attachment.gobo : attachment.name], selected: onAttachment ? 1 : 0) { onAttachment = $0 == 1 }
                }
                FlowLayout(spacing: 8) {
                    PillButton("off", on: motion == nil) { model.setMotion(mode, attachment: target?.id, nil) }
                    ForEach(model.catalog.motionPresets) { p in
                        PillButton(p.name, on: motion?.preset == p.id) {
                            var m = Motion.start(p.motion, serverNowMs: model.serverNowMs)
                            if let old = motion, old.preset == p.id { m.duration = old.duration }
                            model.setMotion(mode, attachment: target?.id, m)
                        }
                    }
                }
                if let motion {
                    let d = dragDuration ?? motion.duration
                    FillSlider("speed", icon: .wind, value: 1 - MotionSpeed.fraction(d), enabled: live,
                               format: { "a pass in " + Fmt.duration(MotionSpeed.duration(1 - $0)) }) { f in
                        dragDuration = MotionSpeed.duration(1 - f)
                    } onEnd: { f in
                        let seconds = MotionSpeed.duration(1 - f).rounded()
                        dragDuration = nil
                        model.setMotion(mode, attachment: target?.id, motion.withDuration(seconds, serverNowMs: model.serverNowMs))
                    }
                    MotionProgress(motion: motion)
                    WideButton(motion.on ? "pause" : "play", icon: motion.on ? .stop : .play, on: !motion.on) {
                        let now = model.serverNowMs
                        model.setMotion(mode, attachment: target?.id, motion.on ? motion.paused(serverNowMs: now) : motion.played(serverNowMs: now))
                    }
                    .disabled(!live)
                } else {
                    Text(target == nil ? "pick a move for the whole light: the picture slides, turns and drifts in colour on the server's clock."
                                       : "pick a move for this attachment alone: it slides and turns in front of the light.")
                        .font(.pm(13)).foregroundStyle(Palette.dim).lineSpacing(2).padding(.horizontal, 2)
                }
            }
            .onChange(of: attachment?.id) { _, id in if id == nil { onAttachment = false } }
        }
    }
}

/// Where the move is now (server clock), as the wall shows it.
struct MotionProgress: View {
    var motion: Motion
    @Environment(AppModel.self) private var model

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 10, paused: !motion.on)) { _ in
            let s = motion.sample(serverNowMs: model.serverNowMs)
            VStack(spacing: 6) {
                ProgressLine(s.u)
                HStack {
                    Text(motion.loop == "once" ? (s.u >= 1 ? "done" : "once") : motion.loop == "pingpong" ? "back and forth" : "loops")
                    Spacer()
                    if let k = s.kelvin { Text(Fmt.kelvin(k)) }
                    Text(Fmt.percent(s.u))
                }
                .font(.pm(12)).foregroundStyle(Palette.dim).monospacedDigit()
            }
            .padding(.horizontal, 2)
        }
    }
}
