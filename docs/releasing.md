# Releasing

## Cutting a release

1. Add notes under `## [Unreleased]` in `CHANGELOG.md` as you go (Added, Changed, Fixed).
2. With a clean working tree on `main`:

   ```bash
   scripts/release.sh 0.2.0
   ```

   It moves the Unreleased notes into `## [0.2.0] - <date>`, updates the compare links, sets the version in
   `backend/internal/config/config.go`, `frontend/package.json` (and the lock file) and `ios/project.yml`
   (`MARKETING_VERSION`, and `CURRENT_PROJECT_VERSION` + 1), commits "release v0.2.0" and creates the annotated tag
   `v0.2.0`. It refuses to run with uncommitted changes, an existing tag, or no notes (pass `--allow-empty` to release
   anyway). It does not push; it prints the command:

   ```bash
   git push origin HEAD v0.2.0
   ```

3. The tag starts the `release` workflow. It creates the GitHub release titled "projmap v0.2.0" with the CHANGELOG
   section as its notes, and attaches:

| file | what |
| --- | --- |
| `projmap_<version>_darwin_arm64.tar.gz` | macOS, Apple Silicon |
| `projmap_<version>_darwin_amd64.tar.gz` | macOS, Intel |
| `projmap_<version>_linux_amd64.tar.gz` | Linux, x86-64 |
| `projmap_<version>_linux_arm64.tar.gz` | Linux, arm64 (Raspberry Pi 5, ARM mini PCs) |
| `projmap_<version>_ios.ipa` | the iPhone app, only when the iOS signing secrets exist |
| `SHA256SUMS` | checksums of every file, checked by `install.sh` |

Each tarball holds `projmap` (the server and CLI with the web app embedded, `CGO_ENABLED=0`, version stamped with
`-ldflags -X projmap/internal/config.Version=<version>`), `LICENSE` and `README.md`. A version with a suffix
(`0.2.0-rc.1`) becomes a pre-release.

To rebuild an existing tag, run the workflow by hand: Actions → release → Run workflow, with the tag.

## The same build locally

```bash
cd backend
make release VERSION=0.2.0          # builds ../frontend once, then every platform into ../dist with SHA256SUMS
make release VERSION=0.2.0 PLATFORMS=darwin/arm64   # one platform
make release-bins VERSION=0.2.0     # skip the web build, reuse internal/web/dist
```

Test the installer against that folder without GitHub:

```bash
PROJMAP_BASE_URL=file://$PWD/../dist PROJMAP_BIN_DIR=/tmp/projmap-bin sh ../install.sh
/tmp/projmap-bin/projmap version
```

## CI

`ci` runs on every push to `main` and every pull request:

| job | runner | does |
| --- | --- | --- |
| backend | ubuntu | `make catalog`, `go vet`, gofmt check, `go test ./...`, cross-compile the four release targets |
| frontend | ubuntu | `npm ci`, `npm run typecheck`, `npm test`, `npm run build` |
| ios | macos-26 | Xcode (latest stable), `swift test` on the PM package, `xcodegen generate`, a simulator build without signing |

The iOS job is the slow one (10 to 20 minutes).

## The installer

`install.sh` in the repository root is what users pipe to `sh`. It detects the platform (darwin or linux, arm64 or
amd64), finds the latest release through the GitHub API (or takes `--version`), downloads `SHA256SUMS` and the
tarball, refuses to install on a checksum mismatch, and installs `projmap` to `~/.local/bin`. `--service` runs
`projmap install` on macOS (the launchd agent `dev.projmap.server`).

Linux has no service yet. TODO: a systemd user unit (`~/.config/systemd/user/projmap.service` with
`ExecStart=%h/.local/bin/projmap serve` and `Environment=PROJMAP_DATA=%h/.local/share/projmap`), written by
`projmap install` on Linux, and `--service` in the installer to enable it.

The repository is set in one place: `repo="${PROJMAP_REPO:-brushknight/projector-mapping}"` at the top of `install.sh`.

## Signing the macOS binary

Release binaries are ad-hoc signed by the Go linker and not notarized. curl does not set the quarantine flag, so the
installer's copy runs without a prompt; a browser download needs `xattr -d com.apple.quarantine`. Developer ID
signing and notarization can follow the agents-deck workflow (a `MACOS_CERT_P12` secret, `codesign --options runtime`,
`notarytool`) once a darwin job builds on macOS.

## iOS: App Store and TestFlight

The app is `com.brushknight.projmap`, team `3J46XQAXC4` (set in `ios/project.yml`).

### One-time setup

1. **Apple Developer Program** membership for the team.
2. **Bundle id.** In Certificates, Identifiers & Profiles, register the App ID `com.brushknight.projmap` (Xcode's
   automatic signing also creates it on the first archive). No extra capabilities are needed.
3. **App Store Connect app record.** My Apps → + → New App: platform iOS, name (the final product name; "projmap"
   is a working name), primary language, bundle id `com.brushknight.projmap`, an SKU such as `projmap-ios`.
4. **App Store Connect API key** for CI: Users and Access → Integrations → App Store Connect API → generate a key with
   the Admin role (Xcode's cloud signing needs it to create the distribution certificate). Download the `.p8` once.

### Build locally

```bash
cd ios
xcodegen generate
xcodebuild archive -project projmap.xcodeproj -scheme projmap -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/projmap.xcarchive -allowProvisioningUpdates
xcodebuild -exportArchive -archivePath build/projmap.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/export -allowProvisioningUpdates
```

`ios/ExportOptions.plist` exports for App Store Connect (`method` `app-store-connect`, automatic signing, team
`3J46XQAXC4`). The IPA lands in `build/export/`. Upload it with Xcode's Organizer (Window → Organizer → Distribute
App) or Transporter, or set `destination` to `upload` in the plist to upload during the export.

Every upload needs a higher `CURRENT_PROJECT_VERSION` (build number) than the last one. `scripts/release.sh` bumps
it; CI uses the workflow run number.

### Build in CI

The `ios` job of the release workflow archives and exports when these repository secrets exist, and skips with a
notice otherwise. If it fails, the release still goes out without the IPA.

| secret or variable | value |
| --- | --- |
| `APPSTORE_API_KEY_P8` (secret) | the `.p8` key, base64-encoded: `base64 -i AuthKey_XXXX.p8 \| pbcopy` |
| `APPSTORE_API_KEY_ID` (secret) | the key id |
| `APPSTORE_API_ISSUER_ID` (secret) | the issuer id shown above the keys list |
| `IOS_TEAM_ID` (variable, optional) | another team id than `3J46XQAXC4` |
| `IOS_UPLOAD_TESTFLIGHT` (variable, optional) | `true` uploads the build to App Store Connect instead of only attaching the IPA |

### TestFlight

After an upload, the build appears in App Store Connect → TestFlight once processing finishes (usually 10 to 30
minutes). Answer the export compliance question: the app uses no encryption beyond what iOS provides (HTTPS is not
used either; it speaks plain HTTP on the local network). Internal testers (up to 100 team members) can install right
away; external testers need a short beta review.

### App Review checklist

The privacy strings are already in `ios/App/Resources/Info.plist`. Check before submitting:

- [ ] **Local network** (`NSLocalNetworkUsageDescription`, `NSBonjourServices` = `_projmap._tcp`): the app finds and
      controls a server on the local network. Say in the review notes that the app needs a projmap server on the
      same Wi-Fi and is useless without one.
- [ ] **Camera** (`NSCameraUsageDescription`): scanning the pairing QR code, and stills of the projection for auto map.
- [ ] **Motion** (`NSMotionUsageDescription`): checking that the phone is steady and level before auto map.
- [ ] **Photos** (`NSPhotoLibraryUsageDescription`): sending a picked photo to the projector as scenery.
- [ ] **App Transport Security**: `NSAllowsLocalNetworking` only (plain HTTP to local addresses); no arbitrary loads.
- [ ] **Review access**: reviewers have no projector. Point them to "look around without a projector" on the connect
      screen, which opens the demo with sample data, and include a short video of the app with a real server.
- [ ] **Privacy nutrition label**: no data collected; nothing leaves the local network.
- [ ] **Agents**: the app starts Claude or Codex on the user's own computer through their server; no AI runs in the
      app or on our servers. Say so in the review notes.
- [ ] Screenshots for 6.9" and 6.5" iPhones, app icon, description, support URL and privacy policy URL.
- [ ] Final product name instead of the working name "projmap".
