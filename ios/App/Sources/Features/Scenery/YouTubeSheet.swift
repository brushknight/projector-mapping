import SwiftUI
import UIKit
import PMKit
import PMDesign

/// "add from youtube" (protocol §14): paste a watch, youtu.be or Shorts link, trim it, pick a quality and import it
/// into the videos category. With yt-dlp on the Mac the server downloads it; without, it becomes an embedded player.
struct YouTubeSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var name = ""
    @State private var start = ""
    @State private var end = ""
    @State private var quality = 1080
    @State private var tools: VideoTools?
    @State private var jobId: String?
    @State private var error: String?
    @State private var sending = false
    @FocusState private var focus: Field?

    enum Field { case link, name, start, end }

    var body: some View {
        let id = YouTube.videoId(link)
        let job = jobId.flatMap { model.hub.imports[$0] }
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Text("add from youtube").titleStyle(26).lineLimit(1).minimumScaleFactor(0.7)
                Spacer()
                IconPill(.close, size: 16, label: "close") { dismiss() }
            }
            .padding(.top, 4)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    linkField(valid: id != nil)
                    if let id { preview(id) }
                    if job == nil {
                        trimCard
                        qualityCard
                        if let tools, !tools.ytdlp { hintCard }
                        WideButton(sending ? "adding" : "add to videos", icon: .plus, on: id != nil && !sending) { send(id) }
                            .disabled(id == nil || sending)
                            .opacity(id == nil ? 0.5 : 1)
                    } else if let job {
                        progressCard(job)
                    }
                }
                .padding(.bottom, 28)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .presentationBackground(Palette.sheet)
        .presentationCornerRadius(38)
        .presentationDragIndicator(.visible)
        .presentationDetents([.large])
        .task {
            if !model.youtubeLink.isEmpty { link = model.youtubeLink; model.youtubeLink = "" }
            tools = await model.hub.videoTools()
            if model.debugScreen == .youtube, link.isEmpty { link = "https://youtu.be/aqz-KE-bpKQ?t=12"; start = "0:12"; end = "0:32" }
        }
    }

    // MARK: Link

    func linkField(valid: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("link").capStyle().padding(.horizontal, 4)
            HStack(spacing: 8) {
                HStack(spacing: 8) {
                    Icon(.link, size: 17).foregroundStyle(Palette.dim)
                    TextField("", text: $link, prompt: Text("youtube.com/watch?v=…").foregroundStyle(Palette.dim))
                        .font(.pm(15))
                        .foregroundStyle(Palette.ink)
                        .textFieldStyle(.plain)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .link)
                        .submitLabel(.done)
                    if !link.isEmpty {
                        Button { link = "" } label: { Icon(.close, size: 12).foregroundStyle(Palette.dim).frame(width: 24, height: 24) }
                            .buttonStyle(.plain)
                            .accessibilityLabel("clear the link")
                    }
                }
                .padding(.horizontal, 12)
                .frame(height: 44)
                .background(Palette.track, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                IconPill(.clipboard, size: 18, diameter: 44, label: "paste the link") {
                    if let s = UIPasteboard.general.string { link = s.trimmingCharacters(in: .whitespacesAndNewlines) }
                }
            }
            if let error {
                Text(error).font(.pm(12)).foregroundStyle(Palette.pad(.amber)).padding(.horizontal, 4)
            } else if !link.isEmpty && !valid {
                Text(YouTube.invalidMessage.lowercased()).font(.pm(12)).foregroundStyle(Palette.pad(.amber)).padding(.horizontal, 4)
            } else {
                Text("watch, youtu.be and shorts links work.").font(.pm(12)).foregroundStyle(Palette.dim).padding(.horizontal, 4)
            }
        }
    }

    func preview(_ id: String) -> some View {
        Color.clear
            .aspectRatio(16 / 9, contentMode: .fit)
            .overlay {
                AsyncImage(url: YouTube.thumbnailURL(id)) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() } else { Palette.track.overlay(Icon(.film, size: 28).foregroundStyle(Palette.dim)) }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(alignment: .bottomLeading) {
                GlassPill { Icon(.film, size: 14); Text(id) }.padding(10)
            }
            .accessibilityLabel("youtube video \(id)")
    }

    // MARK: Trim and quality

    var trimCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            CapRow("trim", "seconds or m:ss")
            Card(spacing: 10) {
                timeRow("loop from", text: $start, field: .start, placeholder: "start")
                Palette.separator.frame(height: 1)
                timeRow("loop to", text: $end, field: .end, placeholder: "the end")
                if let s = Self.seconds(start), let e = Self.seconds(end), e > 0, e <= s {
                    Text("the end must come after the start.").font(.pm(12)).foregroundStyle(Palette.pad(.amber))
                }
                Palette.separator.frame(height: 1)
                HStack(spacing: 12) {
                    Text("name").font(.pm(15)).foregroundStyle(Palette.ink)
                    Spacer()
                    TextField("", text: $name, prompt: Text("from youtube").foregroundStyle(Palette.dim))
                        .font(.pm(15)).foregroundStyle(Palette.ink).multilineTextAlignment(.trailing)
                        .focused($focus, equals: .name)
                }
                .frame(minHeight: 36)
            }
        }
    }

    func timeRow(_ title: String, text: Binding<String>, field: Field, placeholder: String) -> some View {
        HStack(spacing: 12) {
            Text(title).font(.pm(15)).foregroundStyle(Palette.ink)
            Spacer()
            TextField("", text: text, prompt: Text(placeholder).foregroundStyle(Palette.dim))
                .font(.pmMono(15)).foregroundStyle(Palette.ink).multilineTextAlignment(.trailing)
                .keyboardType(.numbersAndPunctuation)
                .focused($focus, equals: field)
                .frame(width: 120)
        }
        .frame(minHeight: 36)
    }

    var qualityCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            CapRow("quality", "up to")
            Segmented(YouTube.maxHeights.map { $0 == 2160 ? "4k" : "\($0)" }, selected: YouTube.maxHeights.firstIndex(of: quality) ?? 3) { n in
                quality = YouTube.maxHeights[n]
            }
        }
    }

    var hintCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Icon(.help, size: 20).foregroundStyle(Palette.dim)
            Text("this mac has no yt-dlp, so the video plays as an embedded youtube player (needs the internet). " + YouTube.ytdlpHint.lowercased())
                .font(.pm(13)).foregroundStyle(Palette.dim).lineSpacing(3)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    // MARK: Progress

    func progressCard(_ job: ImportJob) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Card(spacing: 12) {
                HStack {
                    Text(job.isDone ? "added to videos" : job.isFailed ? "the import stopped" : "importing")
                        .font(.pm(15)).foregroundStyle(Palette.ink)
                    Spacer()
                    Text(job.isFailed ? "" : "\(Int((job.progress * 100).rounded()))%").font(.pmMono(15, .medium)).foregroundStyle(Palette.ink).monospacedDigit()
                }
                ProgressLine(job.isDone ? 1 : job.progress)
                if !job.message.isEmpty {
                    Text(job.message.lowercased()).font(.pm(12)).foregroundStyle(job.isFailed ? Palette.pad(.amber) : Palette.dim).lineSpacing(3)
                }
                Text(job.mode == "embed" ? "embedded youtube player" : "downloaded · \(job.maxHeight)p")
                    .capStyle()
            }
            if job.isDone {
                WideButton("put it on the wall", icon: .play, on: true) { putOnWall(job) }
                WideButton("done") { model.sceneryCategory = "videos"; dismiss() }
            } else if job.isFailed {
                WideButton("try again") { jobId = nil }
            }
        }
    }

    // MARK: Actions

    /// "12", "0:12", "1:02:03" → seconds.
    static func seconds(_ s: String) -> Double? {
        let t = s.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return nil }
        var total = 0.0
        for part in t.split(separator: ":") {
            guard let v = Double(part.replacingOccurrences(of: ",", with: ".")) else { return nil }
            total = total * 60 + v
        }
        return max(0, total)
    }

    func send(_ id: String?) {
        guard id != nil else { return }
        let s = Self.seconds(start) ?? 0, e = Self.seconds(end) ?? 0
        if e > 0, e <= s { error = "the end must come after the start."; return }
        guard model.hub.isLive else { error = "connect to the projector to import."; return }
        error = nil
        sending = true
        focus = nil
        Task {
            defer { sending = false }
            do {
                let job = try await model.hub.importVideo(url: link, maxHeight: quality, start: s, end: e, name: name.isEmpty ? nil : name)
                jobId = job.id
            } catch let e as APIError where e.code == "invalid_url" {
                error = YouTube.invalidMessage.lowercased()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    func putOnWall(_ job: ImportJob) {
        guard let ref = job.ref else { return }
        let v = model.videos.first { $0.id == job.videoId }
        SceneryTab.pickVideo(model, ref: ref, name: v?.name ?? (name.isEmpty ? "from youtube" : name), trim: (job.start, job.end), embed: job.mode == "embed")
        model.sceneryCategory = "videos"
        dismiss()
    }
}
