#!/usr/bin/env bash
# Pixel comparison of one demo screen with its design board (design/boards/phone-<screen>.png, 2x, 804×1748).
#   scripts/compare.sh <sim> <screen> [scroll-pt]
#   scripts/compare.sh $SIM static
#   scripts/compare.sh $SIM live 400
# Sets dark mode and a 9:41 status bar, launches the app with -pm-demo -pm-screen <screen>, screenshots it, crops the
# board at the same scroll offset and writes into ios/.build/compare/:
#   <screen>[@<pt>].png        board | simulator side by side
#   <screen>[@<pt>]-diff.png   ImageMagick diff (red = differs by more than FUZZ, default 6%)
# and prints the share of pixels that differ. WAIT=<seconds> (default 5) waits longer for slow screens.
set -euo pipefail
sim=$1 screen=$2 scroll=${3:-0}
root="$(cd "$(dirname "$0")/../.." && pwd)"
src="$root/design/boards/phone-$screen.png"
# Screens without a board (scenes, sounds, youtube, videos) have no pixel reference: screenshot them with
#   scripts/shot.sh <sim> <out.png> <screen> [seconds] [scroll-pt]
[ -f "$src" ] || { echo "no board $src; screenshot it with: scripts/shot.sh $sim <out.png> $screen" >&2; exit 2; }
out="$root/ios/.build/compare"; mkdir -p "$out"
name=$screen; [ "$scroll" != 0 ] && name="$screen@$scroll"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

xcrun simctl ui "$sim" appearance dark
xcrun simctl status_bar "$sim" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 >/dev/null
"$(dirname "$0")/shot.sh" "$sim" "$tmp/sim.png" "$screen" "${WAIT:-5}" "$scroll" >/dev/null

# The board at the same offset (2x); the simulator shot (3x) scaled to the board's size.
y=$((scroll * 2))
magick "$src" -crop "804x1748+0+$y" +repage -background '#000000' -extent 804x1748 "$tmp/board.png"
magick "$tmp/sim.png" -resize '804x1748!' "$tmp/sim.png"

magick \( "$tmp/board.png" -gravity north -background '#ff8a00' -splice 0x40 -fill '#16120a' -pointsize 28 -annotate +0+6 "board $name" \) \
       \( "$tmp/sim.png" -gravity north -background '#4fb7b3' -splice 0x40 -fill '#16120a' -pointsize 28 -annotate +0+6 "simulator" \) \
       -background '#000' +append "$out/$name.png"
ae=$(magick compare -metric AE -fuzz "${FUZZ:-6}%" "$tmp/board.png" "$tmp/sim.png" "$out/$name-diff.png" 2>&1 >/dev/null || true)
ae=${ae%% *}
python3 -c "import sys; print(f'{sys.argv[1]}: {float(sys.argv[2]) / (804 * 1748) * 100:.2f}% of pixels differ  ->  {sys.argv[3]}')" "$name" "$ae" "$out/$name.png"
