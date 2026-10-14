# The iPhone app

The app is a remote, a camera for auto map and a way to start agents. It plays and switches the show; mapping
happens in the editor. It is native SwiftUI for iOS 26, iPhone only.
It is not on the App Store yet, so you build it with Xcode.

## Requirements

- a Mac with Xcode 27 (it includes the iOS 26 SDK) and the iOS platform installed;
- [xcodegen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`;
- for a device: an Apple ID signed in to Xcode (Settings → Accounts). A free account works for your own phone (the
  install expires after 7 days); a paid Apple Developer membership lasts a year and is needed for TestFlight.

## Generate the project

The Xcode project is generated from `ios/project.yml` and is not checked in:

```bash
cd ios
xcodegen generate
open projmap.xcodeproj
```

Run `xcodegen generate` again after pulling changes that add or move files.

The code lives in the local Swift package `ios/Packages/PM` (PMKit, PMStore, PMLive, PMDesign, PMCamera,
PMPreview) and the app target in `ios/App`. Its only dependency is GRDB. The package tests run without a simulator:

```bash
swift test --package-path Packages/PM
```

## Simulator

In Xcode pick an iPhone simulator and press ⌘R, or from the command line:

```bash
xcodebuild -project projmap.xcodeproj -scheme projmap \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath .build/dd build
xcrun simctl boot 'iPhone 17 Pro' || true
xcrun simctl install booted .build/dd/Build/Products/Debug-iphonesimulator/projmap.app
xcrun simctl launch booted com.brushknight.projmap
```

`scripts/build.sh <simulator-udid>` does the build and install in one step.

The simulator reaches a server on the same Mac at `127.0.0.1:7400`. Useful launch arguments:

| argument | does |
| --- | --- |
| `-pm-demo` | offline demo with sample data, no server |
| `-pm-screen <name>` | open on one screen: `static`, `live`, `color`, `scenery`, `objects`, `setup`, `automap1`…`automap4`, `connect`, `scenes`, `sounds`, `youtube`, `videos` |
| `-pm-reset` | forget the server and the cache |
| `-pm-connect "projmap://connect?server=127.0.0.1:7400&code=K7Q2"` | pair with a code |

The simulator has no camera; auto map shows a drawn desk there.

## Your iPhone

1. Connect the phone by USB (or pair it over Wi-Fi in Xcode's Devices window) and turn on **Developer Mode**
   (Settings → Privacy & Security) when iOS asks.
2. Set your team. The project uses team `3J46XQAXC4` and bundle id `com.brushknight.projmap`; with your own account,
   pass your team id and, if the bundle id is taken, your own:

   ```bash
   TEAM=ABCDE12345   # Xcode → Settings → Accounts, or developer.apple.com → Membership
   xcodebuild -project projmap.xcodeproj -scheme projmap -destination 'generic/platform=iOS' \
     -derivedDataPath .build/dd -allowProvisioningUpdates \
     DEVELOPMENT_TEAM="$TEAM" PRODUCT_BUNDLE_IDENTIFIER=com.example.projmap build
   xcrun devicectl list devices
   xcrun devicectl device install app --device <device-id> .build/dd/Build/Products/Debug-iphoneos/projmap.app
   ```

   In Xcode instead: select the projmap target → Signing & Capabilities → Team, pick your phone as the destination
   and press ⌘R. To keep the change, set `DEVELOPMENT_TEAM` in `ios/project.yml` locally (don't commit it).

3. The first launch from a free account asks you to trust the developer: Settings → General → VPN & Device
   Management.
4. Allow **Local Network** access when asked. Without it the app cannot find or reach the server.

## Using it

- **Tabs** are the modes (static, live, color, scenery, objects); opening one puts it on air.
- **Scenes:** the scene button at the top of every tab lists the scenes, marks the one on the wall, and switches,
  creates or duplicates scenes.
- **Sounds:** the speaker button at the top of every tab opens the soundboard of the active scene, the sound library,
  the master volume and mute, and the audio output. With the output set to **phone**, the phone itself plays every
  sound, the timeline's sound clips and cue sounds included.
- **Objects** plays the timeline: GO, back and stop, a reveal button per object, and the live picture at the wall's
  clock. Cue sounds play on GO.
- **Scenery** has a **videos** category beside the photos. **add from YouTube** takes a link (paste it, or share it to
  projmap), a trim and a quality; **add video file** picks a video from Photos. See
  [sound-and-video.md](sound-and-video.md).

## Permissions

| permission | used for |
| --- | --- |
| Local Network | finding the server over Bonjour (`_projmap._tcp`) and talking to it |
| Camera | scanning the pairing QR code, auto map stills and the camera preview |
| Motion | checking that the phone is steady and level before auto map |
| Photos | sending a photo or a video you pick to the projector as scenery |

The app speaks plain HTTP on the local network only (App Transport Security allows local networking).

## TestFlight and the App Store

Not set up yet. The path is in [../releasing.md](../releasing.md#ios-app-store-and-testflight): an App Store Connect
app record for `com.brushknight.projmap`, an archive exported with `ios/ExportOptions.plist`, and an upload.
The release workflow can build the IPA when the App Store Connect API key secrets exist.
