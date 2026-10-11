import SwiftUI
import PMKit
import PMDesign
import PMCamera

/// Boards `phone-automap1…4`: the phone on a stand calibrates with the projector (Gray code), then Codex or Claude
/// maps the chosen objects while the log streams in.
struct AutoMapFlow: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var motion = MotionMonitor()
    @State private var light: SceneLight?
    @State private var cameraRunning = false
    @State private var calibrationId: String?
    @State private var calibrationStart = Date()
    @State private var result: CalibrationResult?
    @State private var selected: Set<String> = ["zimacube"]
    @State private var prompt = ""
    @State private var promptEdited = false
    @State private var agent = "codex"
    @State private var session: AgentSession?
    @State private var agentStart = Date()
    @State private var showHelp = false
    @State private var busy = false
    @FocusState private var promptFocused: Bool

    static let defaultPrompt = "map the zimacube: the three faces I can see, plus the four drive bays on the right side and the fan circle."

    var step: Int { model.autoMapStep }

    var body: some View {
        ZStack {
            Palette.ground.ignoresSafeArea()
            TabPage(bottom: 40) {
                header
                switch step {
                case 0: setupStep
                case 1: calibratingStep
                case 2: chooseStep
                default: mappingStep
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { await startCamera() }
        .onDisappear {
            motion.stop()
            model.camera.onFrame = nil
            model.camera.onLight = nil
            model.camera.stop()
            CameraBridge.streaming = false
        }
        .onAppear { prepareDemo() }
        .onChange(of: result) { _, _ in if !promptEdited { prompt = defaultPrompt() } }
        .onChange(of: motion.steady) { _, v in MotionStatus.shared.steady = v }
        .onChange(of: motion.level) { _, v in MotionStatus.shared.level = v }
        .onChange(of: calibrationProgress?.step) { _, s in
            if s == "done" { Task { await finishCalibration() } }
            if s == "failed" {
                model.flash(calibrationProgress?.message.isEmpty == false ? calibrationProgress!.message : "Calibration failed. Dim the room and try again.")
                Task { await model.camera.lock(false) }
                model.autoMapStep = 0
            }
        }
        .alert("auto map", isPresented: $showHelp) {
            Button("ok", role: .cancel) {}
        } message: {
            Text("the projector shows black and white stripes while this phone watches. that tells the server which projector pixel lands where in the camera view. then codex or claude draws the surfaces for you as a draft you can keep or fix on the laptop.")
        }
    }

    // MARK: Header

    var header: some View {
        HStack {
            IconPill(.close, size: 16, label: "close") { dismiss() }
            Spacer()
            PageDots(count: 4, current: step)
            Spacer()
            IconPill(.help, size: 18, label: "help") { showHelp = true }
        }
        .frame(height: 35)
        .padding(EdgeInsets(top: 4, leading: 4, bottom: 2, trailing: 4))
    }

    func title(_ t: String) -> some View {
        Text(t).titleStyle(26).frame(height: 28.6).padding(EdgeInsets(top: 2, leading: 4, bottom: 0, trailing: 4))
    }

    func lead(_ t: String) -> some View {
        Text(t).font(.pm(14)).tracking(0.2).foregroundStyle(Palette.dim).lineSpacing(5).padding(.horizontal, 4).padding(.vertical, 2.5)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: 1 · set the phone up

    var setupStep: some View {
        let steady = model.demo || motion.steady
        let inFrame = model.demo || (light?.projectorInFrame ?? false)
        let dim = !model.demo && (light?.dim ?? false)
        return Group {
            title("auto map")
            lead("put the phone on a stand next to the projector so it sees the whole scene. it stays there while mapping.")
            Viewfinder(grid: true) {
                GlassPill { OnAirDot(); Text("streaming to \(model.serverName)") }
            } topTrailing: {
                GlassPill { Text("720p · 8 fps") }
            } bottomLeading: {
                GlassPill { Icon(.level, size: 14); Text("level \(String(format: "%.1f", abs(model.demo ? 0.4 : motion.level)))°") }
            } bottomTrailing: {
                GlassPill { Text("1× wide") }
            } overlay: { _ in EmptyView() }
            Card(spacing: 2) {
                CheckRow("phone is steady", meta: "no movement for 3 s", done: steady)
                CheckRow("projector light is in frame", meta: inFrame ? "found a bright 16:9 area" : "point the phone at the projected light", done: inFrame)
                CheckRow("room is dim", meta: "brighter rooms make calibration slower", done: dim)
            }
            WideButton("start auto map", icon: .wand, iconSize: 20, on: true, height: 60, font: .pm(17)) { Task { await startCalibration() } }
                .disabled(busy)
            WideButton("just take a photo for the laptop", icon: .camera) { Task { await takePhoto() } }
                .disabled(busy)
        }
    }

    // MARK: 2 · calibrating

    var calibrationProgress: CalibrationProgress? { calibrationId.flatMap { model.hub.calibration[$0] } }

    var calibratingStep: some View {
        let p = calibrationProgress ?? CalibrationProgress(step: "patterns", done: 0, total: 22, message: "gray code")
        // Backend steps: white, black, x0…, y0…, decode, done | failed (protocol §9); the demo uses patterns,
        // matching, surfaces, done.
        let matching = p.step == "decode" || p.step == "matching"
        let patternsDone = matching || ["surfaces", "done", "failed"].contains(p.step)
        let left = estimateLeft(p)
        return Group {
            title("calibrating")
            lead("the projector flashes stripes and the phone watches them. this tells us exactly which projector pixel lands where.")
            Viewfinder(grid: false) {
                GlassPill { OnAirDot(); Text("pattern \(p.done) / \(p.total)") }
            } topTrailing: {
                GlassPill { Text("don't move") }
            } bottomLeading: {
                EmptyView()
            } bottomTrailing: {
                GlassPill { Text(left) }
            } overlay: { size in
                Stripes(bit: p.done % 11).opacity(patternsDone ? 0 : 0.55).blendMode(.screen)
            }
            ProgressLine(p.fraction)
            Card(spacing: 2) {
                CheckRow("projecting patterns", meta: "\(p.done) of \(p.total) · gray code", done: p.done > 0)
                CheckRow("matching camera ↔ projector pixels", meta: patternsDone ? (matching ? "now" : "done") : "next", done: p.step == "surfaces" || p.step == "done")
                CheckRow("finding surfaces", meta: "edges, planes, corners", done: p.step == "done")
            }
            WideButton("cancel") { dismiss() }
        }
    }

    func estimateLeft(_ p: CalibrationProgress) -> String {
        let remaining = max(0, p.total - p.done)
        let elapsed = Date().timeIntervalSince(calibrationStart)
        let per = p.done > 2 && !model.demo ? elapsed / Double(p.done) : 1.5
        return "~ \(Int((Double(remaining) * per).rounded())) s left"
    }

    // MARK: 3 · what to map

    var candidates: [CalibrationResult.Candidate] { result?.objects ?? [] }

    var chooseStep: some View {
        Group {
            title("what to map?")
            Viewfinder(grid: false) {
                GlassPill { Text("\(candidates.count) object\(candidates.count == 1 ? "" : "s") found") }
            } topTrailing: {
                GlassPill { Text("tap to select") }
            } bottomLeading: {
                EmptyView()
            } bottomTrailing: {
                GlassPill { Text("camera matched · \(String(format: "%.1f", result?.quality?.errorPx ?? 0.6)) px") }
            } overlay: { size in
                CandidateOverlay(candidates: candidates, selected: selected, size: size) { toggle($0) }
            }
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(candidates) { c in
                        Button { toggle(c.id) } label: {
                            Pill(on: selected.contains(c.id)) {
                                if selected.contains(c.id) { Icon(.check, size: 14, stroke: 2.4) }
                                Text(c.name)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                    Button { model.flash("draw the outline on the laptop: auto map › draw.") } label: {
                        Pill { Icon(.pencil, size: 14); Text("draw") }
                    }
                    .buttonStyle(.plain)
                }
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
            VStack(alignment: .leading, spacing: 10) {
                TextField("", text: $prompt, prompt: Text("what should \(agent) map?").foregroundStyle(Palette.dim), axis: .vertical)
                    .font(.pm(16)).tracking(0.2).lineSpacing(5)
                    .foregroundStyle(Palette.ink)
                    .frame(minHeight: 66, alignment: .topLeading)
                    .focused($promptFocused)
                    .onChange(of: prompt) { _, _ in if promptFocused { promptEdited = true } }
                HStack(spacing: 8) {
                    ForEach(["codex", "claude"], id: \.self) { a in
                        Button { agent = a } label: {
                            Pill(on: agent == a, height: 34) { Text(a) }
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                    IconPill(.mic, size: 18, diameter: 40, label: "type or dictate") { promptFocused = true }
                    IconPill(.send, size: 17, diameter: 40, on: true, label: "send") { Task { await startAgent(prompt) } }
                        .disabled(busy || prompt.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .padding(EdgeInsets(top: 14, leading: 14, bottom: 10, trailing: 14))
            .background(Palette.pill, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            Text("\(agent) runs on \(model.serverName) with the projector tools. it can take snapshots from this phone and project test outlines while it works.")
                .font(.pm(12)).tracking(0.2).foregroundStyle(Palette.dim).lineSpacing(4.3).padding(.horizontal, 4)
        }
        .onAppear { if prompt.isEmpty { prompt = defaultPrompt() } }
    }

    func toggle(_ id: String) {
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
        if !promptEdited { prompt = defaultPrompt() }
    }

    func defaultPrompt() -> String {
        let names = candidates.filter { selected.contains($0.id) }.map(\.name)
        if names == ["zimacube"] || candidates.isEmpty { return Self.defaultPrompt }
        if names.isEmpty { return "" }
        return "map the \(names.joined(separator: " and ")): every face I can see, and any details on them."
    }

    // MARK: 4 · mapping

    var events: [AgentEvent] { session.flatMap { model.hub.agentEvents[$0.id] } ?? [] }
    var agentStatus: String { session.flatMap { model.hub.agentStatus[$0.id] } ?? "running" }

    var mappingStep: some View {
        let events = events
        let passes = max(1, events.filter { ($0.tool ?? "").hasPrefix("project_outline") }.count)
        let done = agentStatus == "done"
        return Group {
            title(done ? "\(agent) is done" : "\(agent) is mapping")
            Viewfinder(grid: false) {
                GlassPill { OnAirDot(); Text("outline projected") }
            } topTrailing: {
                GlassPill { Text("pass \(passes)") }
            } bottomLeading: {
                EmptyView()
            } bottomTrailing: {
                GlassPill { Text("error \(String(format: "%.1f", errorPx(events))) px") }
            } overlay: { size in
                CubeOutline(candidate: candidates.first { selected.contains($0.id) } ?? candidates.first, size: size)
            }
            Card {
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    CapRow("\(agent) · mcp", "\(Int(ctx.date.timeIntervalSince(agentStart))) s", padding: 0)
                }
                VStack(alignment: .leading, spacing: 6) {
                    if events.isEmpty {
                        Text("starting \(agent) on \(model.serverName)…").font(.pm(12.5)).foregroundStyle(Palette.dim)
                    }
                    ForEach(events) { e in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Icon(e.ok == nil ? .more : .check, size: 14, stroke: 2.2).foregroundStyle(Palette.dim).frame(width: 18)
                                .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 3 }
                            Text(line(e)).font(.pm(12.5)).tracking(0.2).foregroundStyle(Palette.ink).lineSpacing(3.2)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Text(e.durationMs.map { String(format: "%.1fs", Double($0) / 1000) } ?? "…")
                                .font(.pm(12.5)).tracking(0.2).foregroundStyle(Palette.logTime)
                        }
                        .frame(minHeight: 19)
                    }
                }
            }
            HStack(spacing: 10) {
                WideButton("fix on laptop", icon: .pencil) {
                    model.flash("open auto map on \(model.serverName) to fix the outline.")
                    dismiss()
                }
                WideButton("keep", icon: .check, on: true) { Task { await keep() } }
            }
            Button { Task { await startAgent("animate the \(candidates.first { selected.contains($0.id) }?.name ?? "object"): a grid build, then trace its edges.") } } label: {
                Text("ask \(agent) to animate it").font(.pm(15)).tracking(0.2).foregroundStyle(Palette.dim).frame(maxWidth: .infinity).frame(height: 54)
            }
            .buttonStyle(.plain)
        }
    }

    func line(_ e: AgentEvent) -> String {
        if let tool = e.tool { return e.text.isEmpty ? tool : "\(tool) · \(e.text)" }
        return e.text
    }

    func errorPx(_ events: [AgentEvent]) -> Double {
        for e in events.reversed() {
            if let r = e.text.range(of: #"error ([0-9.]+) ?px"#, options: .regularExpression) {
                let n = e.text[r].filter { $0.isNumber || $0 == "." }
                if let v = Double(n) { return v }
            }
        }
        return model.demo ? 0.8 : (result?.quality?.errorPx ?? 0)
    }

    // MARK: Actions

    func prepareDemo() {
        guard model.demo else { return }
        if step >= 1 { calibrationId = "cal_demo" }
        if step >= 2 { Task { result = try? await model.hub.calibrationResult("cal_demo") } }
        if step >= 3 {
            session = AgentSession(id: "agt_demo", agent: "codex", prompt: Self.defaultPrompt, sceneId: model.sceneId, draftId: "drf_demo")
            agentStart = Date().addingTimeInterval(-42)
            Task { result = try? await model.hub.calibrationResult("cal_demo") }
        }
    }

    func startCamera() async {
        motion.start()
        guard !model.demo else { return }
        model.camera.onLight = { l in Task { @MainActor in light = l } }
        CameraBridge.streaming = true
        CameraBridge.startStreaming(model)
        do {
            try await model.camera.start()
            cameraRunning = true
        } catch {
            model.flash(error.localizedDescription)
        }
    }

    func startCalibration() async {
        guard let setupId = model.active.setup?.id ?? (model.demo ? "set_desk" : nil) else { model.flash("No projector setup is active."); return }
        busy = true
        defer { busy = false }
        do {
            await model.camera.lock(true)
            calibrationId = try await model.hub.startCalibration(setupId: setupId)
            calibrationStart = Date()
            model.autoMapStep = 1
        } catch {
            model.flash(error.localizedDescription)
        }
    }

    func finishCalibration() async {
        guard let id = calibrationId else { return }
        result = try? await model.hub.calibrationResult(id)
        if let first = result?.objects.first, !(result?.objects.contains { selected.contains($0.id) } ?? false) { selected = [first.id] }
        await model.camera.lock(false)
        model.autoMapStep = 2
    }

    func startAgent(_ text: String) async {
        guard let sceneId = model.sceneId else { model.flash("No scene is active on the projector."); return }
        busy = true
        defer { busy = false }
        do {
            session = try await model.hub.startAgent(agent: agent, prompt: text, sceneId: sceneId)
            agentStart = Date()
            promptFocused = false
            model.autoMapStep = 3
        } catch {
            model.flash(error.localizedDescription)
        }
    }

    func keep() async {
        if !model.demo, let draft = session?.draftId {
            do { try await model.api?.applyDraft(draft) } catch { model.flash(error.localizedDescription); return }
        }
        model.flash("kept. the outline is in the scene.")
        dismiss()
    }

    func takePhoto() async {
        guard !model.demo else { model.flash("sent to \(model.serverName)."); return }
        guard let api = model.api else { model.flash("Not connected to the projector."); return }
        busy = true
        defer { busy = false }
        do {
            let jpeg = try await model.camera.captureStill(lock: false)
            _ = try await api.uploadAsset(jpeg, filename: "photo.jpg", kind: "reference")
            model.flash("sent to \(model.serverName).")
        } catch {
            model.flash(error.localizedDescription)
        }
    }
}

// MARK: - Viewfinder

/// `.vf`: the camera view (370×278, radius 28) with glass labels in the corners and an overlay drawn in view space.
struct Viewfinder<TL: View, TR: View, BL: View, BR: View, Overlay: View>: View {
    var grid: Bool
    var topLeading: TL
    var topTrailing: TR
    var bottomLeading: BL
    var bottomTrailing: BR
    var overlay: (CGSize) -> Overlay
    @Environment(AppModel.self) private var model

    init(grid: Bool, @ViewBuilder topLeading: () -> TL, @ViewBuilder topTrailing: () -> TR, @ViewBuilder bottomLeading: () -> BL,
         @ViewBuilder bottomTrailing: () -> BR, @ViewBuilder overlay: @escaping (CGSize) -> Overlay) {
        self.grid = grid
        self.topLeading = topLeading(); self.topTrailing = topTrailing()
        self.bottomLeading = bottomLeading(); self.bottomTrailing = bottomTrailing()
        self.overlay = overlay
    }

    var body: some View {
        Color.black
            .aspectRatio(370 / 278, contentMode: .fit)
            .overlay {
                GeometryReader { g in
                    ZStack {
                        if !model.demo && CameraController.authorized {
                            CameraPreview(session: model.camera.session)
                        } else {
                            DeskSceneArt()
                        }
                        overlay(g.size)
                        if grid {
                            Path { p in
                                for k in 1...2 {
                                    let x = g.size.width * CGFloat(k) / 3, y = g.size.height * CGFloat(k) / 3
                                    p.move(to: CGPoint(x: x, y: 0)); p.addLine(to: CGPoint(x: x, y: g.size.height))
                                    p.move(to: CGPoint(x: 0, y: y)); p.addLine(to: CGPoint(x: g.size.width, y: y))
                                }
                            }
                            .stroke(Color.white.opacity(0.25), lineWidth: 1)
                        }
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay(alignment: .top) { HStack { topLeading; Spacer(minLength: 0); topTrailing }.padding(12) }
            .overlay(alignment: .bottom) { HStack { bottomLeading; Spacer(minLength: 0); bottomTrailing }.padding(12) }
    }
}

/// Gray-code stripes as the camera sees them during calibration.
struct Stripes: View {
    var bit: Int
    var body: some View {
        Canvas { ctx, size in
            let s = size.width / 370
            let w = 2.75 * pow(2, Double(bit % 4))
            var x = 0.0
            while x < 370 {
                ctx.fill(Path(CGRect(x: x * s, y: 0, width: w * s, height: size.height)), with: .color(.white))
                x += w * 2
            }
        }
    }
}

/// Candidates found by calibration: the selected ones outlined in ink with a label, the others dashed grey.
struct CandidateOverlay: View {
    var candidates: [CalibrationResult.Candidate]
    var selected: Set<String>
    var size: CGSize
    var onTap: (String) -> Void

    func path(_ c: CalibrationResult.Candidate) -> Path {
        Path { p in
            let pts = c.outline.compactMap { $0.count >= 2 ? CGPoint(x: $0[0] * size.width, y: $0[1] * size.height) : nil }
            guard let first = pts.first else { return }
            p.move(to: first)
            for q in pts.dropFirst() { p.addLine(to: q) }
            p.closeSubpath()
        }
    }

    var body: some View {
        let s = size.width / 370
        ZStack {
            ForEach(candidates) { c in
                let on = selected.contains(c.id)
                let p = path(c)
                let box = p.boundingRect
                if on {
                    p.fill(Palette.ink.opacity(0.12))
                    p.stroke(Palette.ink, lineWidth: 2)
                    Text("\(c.name) · \(c.faces) face\(c.faces == 1 ? "" : "s")")
                        .font(.pm(11.5 * s)).tracking(0.2).foregroundStyle(Color.black)
                        .padding(.horizontal, 9 * s).frame(height: 20 * s)
                        .background(Palette.ink, in: Capsule())
                        .position(x: box.midX, y: box.minY - 20 * s)
                } else {
                    p.stroke(Palette.dim, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                    Text(c.name)
                        .font(.pm(11.5 * s)).tracking(0.2).foregroundStyle(Color.black)
                        .padding(.horizontal, 9 * s).frame(height: 20 * s)
                        .background(Palette.dim, in: Capsule())
                        .position(x: box.minX + 24 * s, y: box.maxY + 16 * s)
                }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { loc in
            if let hit = candidates.first(where: { path($0).boundingRect.insetBy(dx: -8, dy: -8).contains(loc) }) { onTap(hit.id) }
        }
    }
}

/// The projected outline as the camera sees it: the cube's hexagon and inner edges, glowing.
struct CubeOutline: View {
    var candidate: CalibrationResult.Candidate?
    var size: CGSize

    var body: some View {
        let pts = (candidate?.outline ?? []).compactMap { $0.count >= 2 ? CGPoint(x: $0[0] * size.width, y: $0[1] * size.height) : nil }
        if pts.count == 6 {
            let center = CGPoint(x: pts[0].x, y: pts[5].y + (pts[1].y - pts[0].y))
            let top = Path { p in p.addLines([pts[0], pts[1], center, pts[5]]); p.closeSubpath() }
            let lines = Path { p in
                p.addLines(pts + [pts[0]])
                p.move(to: center); p.addLine(to: pts[1])
                p.move(to: center); p.addLine(to: pts[5])
                p.move(to: center); p.addLine(to: pts[3])
            }
            ZStack {
                top.fill(Color(red: 191 / 255, green: 243 / 255, blue: 1).opacity(0.18))
                lines.stroke(Color(hex: 0xD8F8FF), lineWidth: 2.4).blur(radius: 2.5)
                lines.stroke(Color(hex: 0xD8F8FF), lineWidth: 2.4)
            }
        } else if !pts.isEmpty {
            Path { p in p.addLines(pts + [pts[0]]) }.stroke(Color(hex: 0xD8F8FF), lineWidth: 2.4).shadow(color: Color(hex: 0xD8F8FF), radius: 4)
        }
    }
}
