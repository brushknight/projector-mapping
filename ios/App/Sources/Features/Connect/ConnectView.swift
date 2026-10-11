import SwiftUI
import PMKit
import PMDesign

/// Pairing: find projmap servers over Bonjour (or type an address), then enter the 4-character code the projector
/// shows, or scan its QR code (`projmap://connect?server=…&code=…`).
struct ConnectView: View {
    @Environment(AppModel.self) private var model
    @State private var servers: [BonjourBrowser.Server] = []
    @State private var chosen: URL?
    @State private var chosenName = ""
    @State private var address = ""
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @State private var scanning = false
    @FocusState private var codeFocused: Bool

    var body: some View {
        TabPage(bottom: 40) {
            HStack {
                Text("connect").titleStyle()
                Spacer()
            }
            .frame(height: 35)
            .padding(EdgeInsets(top: 4, leading: 4, bottom: 2, trailing: 4))
            Text("open projmap on the computer that drives the projector. its screen shows a code.")
                .font(.pm(14)).tracking(0.2).foregroundStyle(Palette.dim).lineSpacing(5).padding(.horizontal, 4)
            VStack(spacing: 10) {
                CapRow("on this network", servers.isEmpty ? "looking" : "\(servers.count)")
                ListCard {
                    if servers.isEmpty {
                        ListRow("looking for projmap…", meta: "same wi-fi as the computer") {
                            ProgressView().tint(Palette.dim).frame(width: 44, height: 44).background(Palette.track)
                        } trailing: { EmptyView() }
                    }
                    ForEach(Array(servers.enumerated()), id: \.element.id) { n, s in
                        Button { choose(s.url, name: s.name) } label: {
                            ListRow(s.name, meta: s.url.host() ?? "", on: chosen == s.url, separator: n > 0) {
                                Icon(.projector, size: 22).frame(width: 44, height: 44).background(chosen == s.url ? Color.black : Palette.track)
                                    .foregroundStyle(Palette.ink)
                            } trailing: {
                                Icon(.chevronRight, size: 18).frame(width: 44, height: 44).opacity(0.6)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            Card(spacing: 12) {
                Text("or type its address").capStyle().padding(.horizontal, 2)
                HStack(spacing: 8) {
                    TextField("", text: $address, prompt: Text("studio-mac.local").foregroundStyle(Palette.dim))
                        .font(.pm(16)).foregroundStyle(Palette.ink)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                        .padding(.horizontal, 12).frame(height: 40)
                        .background(Palette.track, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .onSubmit { useAddress() }
                    PillButton("use", on: !address.isEmpty) { useAddress() }
                }
            }
            if chosen != nil {
                Card(spacing: 12) {
                    CapRow("code on \(chosenName)", "4 characters", padding: 2)
                    TextField("", text: $code, prompt: Text("K7Q2").foregroundStyle(Palette.dim))
                        .font(.pmMono(34, .bold)).tracking(10)
                        .multilineTextAlignment(.center)
                        .textInputAutocapitalization(.characters).autocorrectionDisabled()
                        .foregroundStyle(Palette.ink)
                        .frame(height: 64)
                        .background(Palette.track, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .focused($codeFocused)
                        .onChange(of: code) { _, c in
                            code = String(c.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(4))
                            if code.count == 4 { Task { await pair() } }
                        }
                    WideButton(busy ? "pairing…" : "pair", on: code.count == 4) { Task { await pair() } }
                        .disabled(busy || code.count != 4)
                }
            }
            if let error {
                Text(error).font(.pm(13)).foregroundStyle(Palette.red).padding(.horizontal, 4)
            }
            WideButton("scan the code on the projector", icon: .qr) { scanning = true }
            Button { demo() } label: {
                Text("look around without a projector").font(.pm(14)).foregroundStyle(Palette.dim).frame(maxWidth: .infinity).frame(height: 44)
            }
            .buttonStyle(.plain)
        }
        .background(Palette.ground)
        .task {
            if let link = model.pendingLink { model.pendingLink = nil; await use(link) }
        }
        .task {
            for await list in BonjourBrowser().servers() { servers = list }
        }
        .sheet(isPresented: $scanning) {
            QRScannerSheet { text in
                scanning = false
                if let link = ConnectLink(text) { Task { await use(link) } } else { error = "That code is not a projmap code." }
            }
        }
        .onChange(of: model.pendingLink) { _, link in
            if let link { model.pendingLink = nil; Task { await use(link) } }
        }
    }

    func choose(_ url: URL, name: String) {
        chosen = url
        chosenName = name
        error = nil
        code = ""
        codeFocused = true
        Task { await checkInfo(url) }
    }

    func useAddress() {
        guard let url = ConnectLink.normalize(server: address) else { error = "That address does not look right."; return }
        choose(url, name: url.host() ?? address)
    }

    /// `/info`: the server's name, and whether it wants a code at all.
    func checkInfo(_ url: URL, autoPair: Bool = true) async {
        do {
            let info = try await APIClient(server: url, token: nil).info()
            chosenName = info.name.isEmpty ? (info.hostname.isEmpty ? chosenName : info.hostname) : info.name
            if autoPair && !info.pairingRequired {
                model.paired(Credentials(server: url, token: "", deviceId: "", serverName: chosenName))
            }
        } catch {
            self.error = "\(url.host() ?? "that computer") does not answer. Check that projmap runs there."
        }
    }

    func pair() async {
        guard let url = chosen, code.count == 4, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let r = try await APIClient(server: url, token: nil).pair(code: code, name: UIDevice.current.name)
            model.paired(Credentials(server: url, token: r.token, deviceId: r.device.id, serverName: chosenName.isEmpty ? (url.host() ?? "projector") : chosenName))
        } catch let e as APIError where e.status == 401 || e.status == 403 || e.status == 400 || e.status == 404 {
            error = "That code did not work. Check the code on the projector and try again."
            code = ""
        } catch {
            self.error = error.localizedDescription
        }
    }

    func use(_ link: ConnectLink) async {
        chosen = link.server
        chosenName = link.server.host() ?? ""
        if let token = link.token {
            let name = (try? await APIClient(server: link.server, token: token).info())?.name ?? chosenName
            model.paired(Credentials(server: link.server, token: token, deviceId: "", serverName: name))
        } else if let c = link.code {
            await checkInfo(link.server, autoPair: false)
            code = c
            await pair()
        }
    }

    func demo() { model.enterDemo() }
}
