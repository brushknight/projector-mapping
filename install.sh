#!/bin/sh
# projmap installer: downloads a release from GitHub, checks it against the
# release's SHA256SUMS and installs projmap to ~/.local/bin. Add --service to
# start the server at login (`projmap install`, a launchd agent on macOS).
#
#   curl -fsSL https://raw.githubusercontent.com/brushknight/projector-mapping/main/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --service          # also start it at login
#   curl -fsSL .../install.sh | sh -s -- --version v0.2.0
#
# PROJMAP_BASE_URL points at another copy of a release (a folder or URL with
# the tarballs and SHA256SUMS), for testing. PROJMAP_BIN_DIR changes the
# install folder (default ~/.local/bin).
set -eu

repo="${PROJMAP_REPO:-brushknight/projector-mapping}"
version=""
service=0
while [ $# -gt 0 ]; do
  case "$1" in
    --service) service=1 ;;
    --version) version="$2"; shift ;;
    -h|--help) sed -n '2,13p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

os="$(uname -s)"; arch="$(uname -m)"
case "$os" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "projmap has no release build for $os" >&2; exit 1 ;;
esac
case "$arch" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=amd64 ;;
  *) echo "projmap has no release build for $os/$arch" >&2; exit 1 ;;
esac

if [ -z "$version" ] && [ -z "${PROJMAP_BASE_URL:-}" ]; then
  version="$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
  [ -n "$version" ] || { echo "no release found for $repo" >&2; exit 1; }
fi
base="${PROJMAP_BASE_URL:-https://github.com/$repo/releases/download/$version}"
bindir="${PROJMAP_BIN_DIR:-$HOME/.local/bin}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

fetch() { curl -fsSL -o "$tmp/$1" "$base/$1"; }
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi
}

fetch SHA256SUMS
# Without --version and with PROJMAP_BASE_URL, take the version from the tarball names.
if [ -z "$version" ]; then
  version="v$(sed -n "s/.*projmap_\(.*\)_${os}_${arch}\.tar\.gz\$/\1/p" "$tmp/SHA256SUMS" | head -1)"
fi
v="${version#v}"
tarball="projmap_${v}_${os}_${arch}.tar.gz"
echo "projmap $version ($os/$arch)"

want="$(grep "  $tarball\$" "$tmp/SHA256SUMS" | cut -d' ' -f1 || true)"
[ -n "$want" ] || { echo "$tarball is not in SHA256SUMS: no build for $os/$arch in $version" >&2; exit 1; }
fetch "$tarball"
got="$(cd "$tmp" && sha256 "$tarball" | cut -d' ' -f1)"
[ "$want" = "$got" ] || { echo "checksum mismatch for $tarball: not installing" >&2; exit 1; }

tar -xzf "$tmp/$tarball" -C "$tmp" projmap
mkdir -p "$bindir"
rm -f "$bindir/projmap"  # a fresh file: overwriting a binary in place makes macOS kill it
install -m 0755 "$tmp/projmap" "$bindir/projmap"
echo "  projmap -> $bindir/projmap"

if [ "$service" = 1 ]; then
  if [ "$os" = darwin ]; then
    "$bindir/projmap" install
  else
    # TODO: a systemd user unit (projmap install only knows launchd today). Until then, for example:
    #   PROJMAP_DATA=~/.local/share/projmap projmap serve
    echo "  --service: no systemd unit yet on Linux; run 'projmap serve' yourself (see docs/guides/projector-setup.md)"
  fi
fi

case ":$PATH:" in
  *":$bindir:"*) ;;
  *) echo "add $bindir to your PATH, e.g.: echo 'export PATH=$bindir:\$PATH' >> ~/.zshrc" ;;
esac
if [ "$service" = 1 ] && [ "$os" = darwin ]; then
  echo "done · the server runs on http://localhost:7400 · try: projmap open"
else
  echo "done · try: projmap serve, then projmap open"
fi
