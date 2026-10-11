#!/bin/sh
# Cut a release: bump the version everywhere, move the Unreleased notes in
# CHANGELOG.md into a section for this version, commit and tag. It does not
# push; it prints the command that does.
#
#   scripts/release.sh 0.2.0
#   scripts/release.sh 0.2.0 --allow-empty   # release without Unreleased notes
#
# Files it changes: CHANGELOG.md, backend/internal/config/config.go (the
# default version), frontend/package.json (+ package-lock.json),
# ios/project.yml (MARKETING_VERSION, and CURRENT_PROJECT_VERSION + 1).
set -eu

usage() { sed -n '2,12p' "$0"; exit 2; }
[ $# -ge 1 ] || usage
version="${1#v}"; shift
allow_empty=0
for a in "$@"; do
  case "$a" in
    --allow-empty) allow_empty=1 ;;
    *) usage ;;
  esac
done
echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$' ||
  { echo "not a semver version: $version" >&2; exit 2; }
tag="v$version"

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

git rev-parse --verify HEAD >/dev/null 2>&1 || { echo "no commits yet: commit the project first" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "the working tree has changes: commit or stash them first" >&2; exit 1; }
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then echo "tag $tag exists" >&2; exit 1; fi

# CHANGELOG: the notes under "## [Unreleased]" become "## [x.y.z] - date".
notes="$(awk '/^## \[Unreleased\]/{p=1; next} /^## \[/{p=0} p' CHANGELOG.md | grep -v '^[[:space:]]*$' || true)"
if [ -z "$notes" ] && [ "$allow_empty" = 0 ]; then
  echo "CHANGELOG.md has no notes under ## [Unreleased]: add some, or pass --allow-empty" >&2; exit 1
fi
today="$(date +%Y-%m-%d)"
V="$version" D="$today" perl -0pi -e '
  s/^## \[Unreleased\]\n/## [Unreleased]\n\n## [$ENV{V}] - $ENV{D}\n/m;
  s/\n\n\n+/\n\n/g;
' CHANGELOG.md
# Compare links at the bottom, when the file has them.
prev="$(git tag -l 'v*' --sort=-v:refname | head -1)"
if grep -q '^\[Unreleased\]: ' CHANGELOG.md; then
  url="$(sed -n 's/^\[Unreleased\]: \(.*\)\/compare\/.*/\1/p' CHANGELOG.md)"
  if [ -n "$url" ]; then
    if [ -n "$prev" ]; then link="$url/compare/$prev...$tag"; else link="$url/releases/tag/$tag"; fi
    T="$tag" U="$url" L="$link" V="$version" perl -0pi -e '
      s/^\[Unreleased\]: .*$/[Unreleased]: $ENV{U}\/compare\/$ENV{T}...HEAD\n[$ENV{V}]: $ENV{L}/m;
    ' CHANGELOG.md
  fi
fi

# Versions in the code.
V="$version" perl -pi -e 's/^var Version = ".*"/var Version = "$ENV{V}"/' backend/internal/config/config.go
V="$version" perl -0pi -e 's/("name": "projmap-web",\s*"private": true,\s*"version": )"[^"]*"/$1"$ENV{V}"/' frontend/package.json
if [ -f frontend/package-lock.json ]; then
  V="$version" perl -0pi -e 's/("name": "projmap-web",\s*"version": )"[^"]*"/$1"$ENV{V}"/g' frontend/package-lock.json
fi
V="$version" perl -pi -e '
  s/^(\s*MARKETING_VERSION: )".*"/$1"$ENV{V}"/;
  s/^(\s*CURRENT_PROJECT_VERSION: )"(\d+)"/$1 . q(") . ($2 + 1) . q(")/e;
' ios/project.yml

git add CHANGELOG.md backend/internal/config/config.go frontend/package.json ios/project.yml
[ -f frontend/package-lock.json ] && git add frontend/package-lock.json
git commit -q -m "release $tag"
git tag -a "$tag" -m "projmap $tag"

echo "committed and tagged $tag:"
git --no-pager show --stat --format='  %h %s' HEAD | sed 's/^/  /'
remote="$(git remote | head -1)"
echo
echo "push it (the release workflow builds and publishes on the tag):"
echo "  git push ${remote:-origin} HEAD $tag"
