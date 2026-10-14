#!/usr/bin/env bash
# Screenshot one demo screen in a simulator: scripts/shot.sh <sim> <out.png> <screen> [seconds] [scroll-pt]
#   scripts/shot.sh $SIM /tmp/static.png static
#   scripts/shot.sh $SIM /tmp/sounds.png sounds          # also: scenes, youtube, videos (no boards, protocol §14)
#   scripts/shot.sh $SIM /tmp/objects.png objects 5 900  # the objects tab scrolled to its soundboard
# Launches the app offline (-pm-demo) on the board's screen (-pm-screen), optionally scrolled (-pm-scroll).
set -euo pipefail
sim=$1 out=$2 screen=${3:-static} wait=${4:-4} scroll=${5:-0}
bundle=com.brushknight.projmap
xcrun simctl terminate "$sim" "$bundle" >/dev/null 2>&1 || true
args=(-pm-demo -pm-screen "$screen")
[ "$scroll" != 0 ] && args+=(-pm-scroll "$scroll")
xcrun simctl launch "$sim" "$bundle" "${args[@]}" >/dev/null
sleep "$wait"
xcrun simctl io "$sim" screenshot "$out" >/dev/null 2>&1
echo "$out"
