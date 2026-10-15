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
    @State private var agent = "claude"
    @State private var agents: [AgentAvailability] = []
    @State private var preflight: Preflight?
    @State private var preflightError: String?
    @State private var failure: String?
    @State private var failedResult: CalibrationResult?
    @State private var roi: CGRect?
    @State private var editingROI = false
    @State private var lightCheck: LightCheck?
    @State private var checkingLight = false
    @State private var showTips = false
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
        .task(id: step) { await whileOnStep(step) }
        .task(id: calibrationId) { await watchCalibration() }
        .onDisappear {
            motion.stop()
            CameraBridge.stopStreaming(model)
            model.camera.onLight = nil
            model.camera.stop()
        }
        .onAppear { prepareDemo() }
        .onChange(of: result) { _, _ in if !promptEdited { prompt = defaultPrompt() } }
        .onChange(of: motion.steady) { _, v in MotionStatus.shared.steady = v }
        .onChange(of: motion.level) { _, v in MotionStatus.shared.level = v }
        .onChange(of: calibrationProgress?.step) { _, s in
            if s == "done" { Task { await finishCalibration() } }
            if s == "failed" {
                // the failure stays on screen (step 2) with what the camera saw; nothing jumps back silently
                let m = calibrationProgress?.message ?? ""
                failure = m.isEmpty ? "Calibration failed. Dim the room and try again." : m
                Task {
                    await model.camera.lock(false)
                    if let id = calibrationId { failedResult = try? await model.hub.calibrationResult(id) }
                }
            }
        }
        .alert("make the projector stand out", isPresented: $showTips) {
            Button("ok", role: .cancel) {}
        } message: {
            Text("turn off the ceiling lights and lamps, close the blinds, dim or turn away monitors that light the area, and set the projector to its brightest mode. then try again.")
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

    var liveCamera: Bool { !model.demo && cameraRunning }

    /// The projected area the phone sees while the output shows the aiming image.
    var aimShapes: [PreviewShape] {
        var out: [PreviewShape] = []
        if let l = light, l.quad.count == 4 { out.append(PreviewShape(points: l.quad, style: l.projectorInFrame ? .fill : .dashed)) }
        if let r = roi { out.append(PreviewShape(points: [r.origin, CGPoint(x: r.maxX, y: r.minY), CGPoint(x: r.maxX, y: r.maxY), CGPoint(x: r.minX, y: r.maxY)], style: .solid)) }
        return out
    }

    var roiRect: ROIRect? { roi.map { ROIRect(x: $0.minX, y: $0.minY, w: $0.width, h: $0.height) } }

    var setupStep: some View {
        let steady = model.demo || motion.steady
        let inFrame = model.demo || (light?.projectorInFrame ?? false)
        let dim = !model.demo && (light?.dim ?? false)
        let pf = preflight
        let ready = model.demo || (pf?.ready ?? false)
        return Group {
            title("auto map")
            lead("put the phone on a stand next to the projector so it sees the whole projection. it stays there while mapping.")
            Viewfinder(grid: !editingROI, shapes: aimShapes, editingROI: editingROI, onROI: { r in roi = r; editingROI = false; Task { try? await model.api?.aim(true, cameraRoi: roiRect) } }) {
                GlassPill {
                    if model.demo || pf?.camera.ok == true { OnAirDot() }
                    Text(streamLabel)
                }
            } topTrailing: {
                GlassPill { Text(pf?.aiming == true ? "projector white" : "720p · 8 fps") }
            } bottomLeading: {
                GlassPill { Icon(.level, size: 14); Text("level \(String(format: "%.1f", abs(model.demo ? 0.4 : motion.level)))°") }
            } bottomTrailing: {
                GlassPill { Text("1× wide") }
            } overlay: { _ in EmptyView() }
            if let failure {
                Card(spacing: 6) {
                    Text("calibration stopped").font(.pm(15)).tracking(0.2).foregroundStyle(Palette.ink)
                    Text(failure).font(.pm(12.5)).tracking(0.2).foregroundStyle(Palette.dim).lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if !model.demo { preflightCard }
            if !model.demo {
                HStack(spacing: 8) {
                    Button { editingROI.toggle() } label: {
                        Pill(on: editingROI || roi != nil) { Icon(.pencil, size: 14); Text(editingROI ? "drag over the object" : (roi == nil ? "mark the object" : "object marked")) }
                    }
                    .buttonStyle(.plain)
                    if roi != nil {
                        Button { roi = nil; Task { try? await model.api?.aim(true) } } label: { Pill { Text("whole view") } }
                            .buttonStyle(.plain)
                    }
                    Spacer(minLength: 0)
                    Button { Task { await runLightCheck() } } label: { Pill { Text(checkingLight ? "checking…" : "check the light") } }
                        .buttonStyle(.plain)
                        .disabled(checkingLight || preflight?.output.ok != true)
                }
            }
            Card(spacing: 2) {
                if !model.demo, let lc = lightCheck ?? preflight?.light {
                    CheckRow("projector visible: \(lc.level)", meta: lc.message, done: lc.level == "strong")
                }
                CheckRow("projector light is in frame", meta: inFrameMeta, done: inFrame)
                CheckRow("phone is steady", meta: steady ? "holding still" : String(format: "moving %.1f° · you can start, it checks again at the end", motion.drift), done: steady)
                CheckRow("room is dim", meta: "brighter rooms make calibration slower", done: dim)
            }
            WideButton("start auto map", icon: .wand, iconSize: 20, on: ready, height: 60, font: .pm(17)) { Task { await startCalibration() } }
                .disabled(busy || !ready)
                .opacity(ready ? 1 : 0.5)
            if !ready, let reason = pf?.reason, !reason.isEmpty {
                Text(reason).font(.pm(12.5)).tracking(0.2).foregroundStyle(Palette.dim).padding(.horizontal, 4)
            }
            WideButton("just take a photo for the laptop", icon: .camera) { Task { await takePhoto() } }
                .disabled(busy)
        }
    }

    var streamLabel: String {
        if model.demo { return "streaming to \(model.serverName)" }
        guard let c = preflight?.camera else { return "connecting to \(model.serverName)" }
        return c.ok ? "streaming · \(String(format: "%.0f", c.fps)) fps" : "not reaching \(model.serverName)"
    }

    var inFrameMeta: String {
        guard let l = light, !model.demo else { return model.demo ? "found the projected area" : "waiting for the camera" }
        if preflight?.output.ok == false { return "open the projector output first: it lights up white for aiming" }
        if l.projectorInFrame {
            return l.touchesEdge ? "part of the projection is out of view: turn or move the phone back" : "found the projected area (\(Int(l.bright * 100))% of the view)"
        }
        return l.quad.isEmpty ? "point the phone at the white projected area" : "the projected area is too small: move the phone closer"
    }

    /// Live checks from the server: output, camera preview, server.
    var preflightCard: some View {
        Card(spacing: 2) {
            if let err = preflightError {
                CheckRow("server", meta: err, done: false)
            } else if let pf = preflight {
                CheckRow("projector output", meta: pf.output.ok ? pf.output.detail : pf.output.fix, done: pf.output.ok)
                if !pf.output.warning.isEmpty {
                    Text(pf.output.warning).font(.pm(12)).tracking(0.2).foregroundStyle(Palette.dim).padding(.leading, 36)
                        .fixedSize(horizontal: false, vertical: true)
                }
                CheckRow("camera preview on the server", meta: pf.camera.ok ? pf.camera.detail : (pf.camera.fix.isEmpty ? pf.camera.detail : "\(pf.camera.detail). \(pf.camera.fix)"), done: pf.camera.ok)
                CheckRow("server", meta: "\(model.serverName) answers", done: true)
            } else {
                CheckRow("server", meta: "checking \(model.serverName)…", done: false)
            }
        }
    }

    // MARK: 2 · calibrating

    var calibrationProgress: CalibrationProgress? { calibrationId.flatMap { model.hub.calibration[$0] } }

    @ViewBuilder var calibratingStep: some View {
        if calibrationProgress?.step == "failed" || failedResult?.status == "failed" { failedView } else { runningView }
    }

    /// While calibrating, also read the calibration itself every 3 s: after a server restart the progress channel is
    /// gone (the server marks the pass "interrupted"), and the phone must not wait forever.
    func watchCalibration() async {
        guard !model.demo, let api = model.api else { return }
        while !Task.isCancelled, step == 1, let id = calibrationId {
            try? await Task.sleep(for: .seconds(3))
            guard step == 1, calibrationId == id, calibrationProgress?.step != "failed", calibrationProgress?.step != "done",
                  let r = try? await api.calibration(id) else { continue }
            if r.status == "failed" {
                failure = r.message.isEmpty ? "Calibration failed." : r.message
                failedResult = r
                await model.camera.lock(false)
            } else if r.status == "done" {
                await finishCalibration()
            }
        }
    }

    /// A failed calibration stays on screen: the server's reason, what the camera saw of the projector, and the ways on.
    var failedView: some View {
        Group {
            title("calibration stopped")
            lead(failure ?? calibrationProgress?.message ?? "the calibration failed.")
            if let sha = failedResult?.diffAsset, let api = model.api {
                VStack(alignment: .leading, spacing: 6) {
                    AsyncImage(url: api.assetURL(sha: sha)) { img in img.resizable().scaledToFit() } placeholder: { Color.black.aspectRatio(4 / 3, contentMode: .fit) }
                        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    Text("what the camera saw of the projector: bright = the projector lights it").font(.pm(12)).tracking(0.2).foregroundStyle(Palette.dim).padding(.horizontal, 4)
                }
            }
            if let c = failedResult?.quality?.contrast {
                Text("projector \(Int(c.brighterPct.rounded()))% brighter than the room, over \(Int((c.lit * 100).rounded()))% of the view")
                    .font(.pm(12.5)).tracking(0.2).foregroundStyle(Palette.dim).padding(.horizontal, 4)
            }
            WideButton("try again", icon: .wand, on: true) {
                Task {
                    // light the projector white again so the camera meters on it before the new pass
                    try? await model.api?.aim(true, cameraRoi: roiRect)
                    try? await Task.sleep(for: .milliseconds(600))
                    await startCalibration()
                }
            }
                .disabled(busy)
            HStack(spacing: 10) {
                WideButton("darker room tips", icon: .help) { showTips = true }
                WideButton("mark the object", icon: .pencil) {
                    editingROI = true
                    model.autoMapStep = 0
                }
            }
            WideButton("back to setup") { model.autoMapStep = 0 }
        }
    }

    var runningView: some View {
        let p = calibrationProgress ?? CalibrationProgress(step: "patterns", done: 0, total: 22, message: "gray code")
        // Backend steps: white, black, x0…, y0…, decode, done | failed (protocol §9); the demo uses patterns,
        // matching, surfaces, done.
        let matching = p.step == "decode" || p.step == "matching"
        let patternsDone = matching || ["verify", "surfaces", "done", "failed"].contains(p.step)
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
            if !p.message.isEmpty && !model.demo {
                Text(p.message).font(.pm(12.5)).tracking(0.2).foregroundStyle(Palette.dim).padding(.horizontal, 4)
            }
            Card(spacing: 2) {
                CheckRow("projecting patterns", meta: "\(p.done) of \(p.total) · gray code", done: patternsDone)
                if !model.demo {
                    CheckRow("checking the phone did not move", meta: p.step == "verify" ? "now" : (matching || p.step == "done" ? "done" : "at the end"), done: matching || p.step == "done")
                }
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

    /// Candidate outlines in camera space for the live preview (selected solid, others dashed).
    var candidateShapes: [PreviewShape] {
        guard liveCamera else { return [] }
        return candidates.compactMap { c in
            let pts = c.outline.compactMap { $0.count >= 2 ? CGPoint(x: $0[0], y: $0[1]) : nil }
            return pts.count >= 3 ? PreviewShape(points: pts, style: selected.contains(c.id) ? .solid : .dashed) : nil
        }
    }

    var qualityLine: String {
        guard let q = result?.quality else { return "camera matched" }
        if let r = q.roi { return "sharp area mapped \(Int((r.sharp * 100).rounded()))% · \(String(format: "%.1f", r.errorPx > 0 ? r.errorPx : q.errorPx)) px" }
        return "\(Int((q.coverage * 100).rounded()))% seen · \(String(format: "%.1f", q.errorPx)) px"
    }

    var chooseStep: some View {
        Group {
            title("what to map?")
            Viewfinder(grid: false, shapes: candidateShapes) {
                GlassPill { Text("\(candidates.count) object\(candidates.count == 1 ? "" : "s") found") }
            } topTrailing: {
                GlassPill { Text("tap to select") }
            } bottomLeading: {
                EmptyView()
            } bottomTrailing: {
                GlassPill { Text(model.demo ? "camera matched · \(String(format: "%.1f", result?.quality?.errorPx ?? 0.6)) px" : qualityLine) }
            } overlay: { size in
                if !liveCamera { CandidateOverlay(candidates: candidates, selected: selected, size: size) { toggle($0) } }
            }
            if !model.demo, let r = result {
                Text(candidates.isEmpty ? "\(r.message). no flat surfaces found: draw them on the laptop, or ask the agent to find them." : r.message)
                    .font(.pm(12.5)).tracking(0.2).foregroundStyle(Palette.dim).padding(.horizontal, 4)
                    .fixedSize(horizontal: false, vertical: true)
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
                    ForEach(["claude", "codex"], id: \.self) { a in
                        let why = unavailable(a)
                        Button { if let why { model.flash(why) } else { agent = a } } label: {
                            Pill(on: agent == a, height: 34) { Text(why == nil ? a : "\(a) · not installed") }
                        }
                        .buttonStyle(.plain)
                        .opacity(why == nil ? 1 : 0.45)
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
        .task { await loadAgents() }
    }

    /// Why an agent can't run on the server's Mac (nil when it can, or when the server has not said).
    func unavailable(_ a: String) -> String? {
        guard !model.demo, let x = agents.first(where: { $0.agent == a }), !x.available else { return nil }
        return x.reason.isEmpty ? "\(a) is not installed on \(model.serverName)." : x.reason
    }

    func loadAgents() async {
        guard !model.demo, let api = model.api, let list = try? await api.agentsAvailable() else { return }
        agents = list
        if unavailable(agent) != nil, let ok = list.first(where: { $0.available }) { agent = ok.agent }
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
            title(done ? "\(agent) is done" : (agentStatus == "failed" ? "\(agent) stopped" : "\(agent) is mapping"))
            Viewfinder(grid: false, shapes: candidateShapes.filter { $0.style == .solid }) {
                GlassPill { OnAirDot(); Text("outline projected") }
            } topTrailing: {
                GlassPill { Text("pass \(passes)") }
            } bottomLeading: {
                EmptyView()
            } bottomTrailing: {
                GlassPill { Text("error \(String(format: "%.1f", errorPx(events))) px") }
            } overlay: { size in
                if !liveCamera { CubeOutline(candidate: candidates.first { selected.contains($0.id) } ?? candidates.first, size: size) }
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

    /// While the setup step is open: poll the pre-flight every second and keep the aiming image on the projector
    /// (renewed every 5 s; the server takes it down 15 s after the last renewal). Leaving the step takes it down.
    func whileOnStep(_ s: Int) async {
        guard s == 0, !model.demo, let api = model.api else { return }
        let aimer = Task { @MainActor in
            while !Task.isCancelled {
                if preflight?.output.ok ?? true { try? await api.aim(true, cameraRoi: roiRect) }
                try? await Task.sleep(for: .seconds(5))
            }
        }
        while !Task.isCancelled {
            do {
                preflight = try await api.preflight()
                preflightError = nil
            } catch is CancellationError {
                break
            } catch {
                preflightError = "can't reach \(model.serverName): \(error.localizedDescription) Check the Mac is awake and on the same Wi-Fi."
            }
            try? await Task.sleep(for: .seconds(1))
        }
        aimer.cancel()
        // the calibration (step 1) drives the output itself; the server ignores this while it runs
        Task { try? await api.aim(false) }
    }

    func runLightCheck() async {
        guard let api = model.api else { return }
        checkingLight = true
        defer { checkingLight = false }
        do { lightCheck = try await api.lightCheck() } catch { model.flash(error.localizedDescription) }
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
        failure = nil
        failedResult = nil
        do {
            // the projector shows white for aiming now: meter on the object (or the projected area), then lock
            let q = light?.quad ?? []
            let point = roi.map { CGPoint(x: $0.midX, y: $0.midY) }
                ?? (q.count == 4 ? CGPoint(x: q.map(\.x).reduce(0, +) / 4, y: q.map(\.y).reduce(0, +) / 4) : nil)
            if model.demo { await model.camera.lock(true) } else { await model.camera.meterAndLock(at: point) }
            calibrationId = try await model.hub.startCalibration(setupId: setupId, cameraRoi: roiRect)
            calibrationStart = Date()
            model.autoMapStep = 1
        } catch {
            await model.camera.lock(false)
            failure = error.localizedDescription
            model.flash(error.localizedDescription)
        }
    }

    func finishCalibration() async {
        guard let id = calibrationId else { return }
        do {
            result = try await model.hub.calibrationResult(id)
        } catch {
            model.flash("Calibrated, but the candidates did not load: \(error.localizedDescription)")
        }
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
    var shapes: [PreviewShape] = []
    var editingROI = false
    var onROI: ((CGRect) -> Void)?
    var topLeading: TL
    var topTrailing: TR
    var bottomLeading: BL
    var bottomTrailing: BR
    var overlay: (CGSize) -> Overlay
    @Environment(AppModel.self) private var model

    init(grid: Bool, shapes: [PreviewShape] = [], editingROI: Bool = false, onROI: ((CGRect) -> Void)? = nil, @ViewBuilder topLeading: () -> TL, @ViewBuilder topTrailing: () -> TR, @ViewBuilder bottomLeading: () -> BL,
         @ViewBuilder bottomTrailing: () -> BR, @ViewBuilder overlay: @escaping (CGSize) -> Overlay) {
        self.grid = grid
        self.shapes = shapes
        self.editingROI = editingROI
        self.onROI = onROI
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
                            CameraPreview(session: model.camera.session, shapes: shapes, editingROI: editingROI, onROI: onROI.map { f in { r in f(r) } })
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
