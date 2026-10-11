#!/usr/bin/env bash
# Builds the app for a simulator and installs it: scripts/build.sh <sim>
set -euo pipefail
cd "$(dirname "$0")/.."
sim=$1
PATH=/usr/bin:$PATH xcodebuild -project projmap.xcodeproj -scheme projmap -destination "platform=iOS Simulator,id=$sim" \
  -derivedDataPath .build/dd build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)" | sort -u
xcrun simctl install "$sim" .build/dd/Build/Products/Debug-iphonesimulator/projmap.app
