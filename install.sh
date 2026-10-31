#!/usr/bin/env bash
# fx installer: downloads the release binary for this machine, checks its
# sha256, and puts it on your PATH.
#
#   curl -fsSL https://raw.githubusercontent.com/notshekhar/fx/main/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --version v0.1.0
#
# Options (each has an environment variable, which `fx upgrade` uses):
#   -v, --version <vX.Y.Z>  install that release instead of the latest   (FX_VERSION)
#       --force             reinstall even when already on that version  (FX_FORCE=1)
#       --uninstall         remove the binary; ~/.fx is left alone        (FX_UNINSTALL=1)
#   FX_INSTALL_DIR          where the binary goes (default ~/.local/bin)

set -euo pipefail

REPO="notshekhar/fx"
INSTALL_DIR="${FX_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${FX_VERSION:-}"
FORCE="${FX_FORCE:-0}"
UNINSTALL="${FX_UNINSTALL:-0}"

usage() {
  cat <<EOF
fx installer

  install.sh [--version vX.Y.Z] [--force] [--uninstall]

  FX_INSTALL_DIR  where the binary goes (default ~/.local/bin)
EOF
}
say() { printf '%s\n' "$*"; }
bold() { printf "\033[1m%s\033[0m\n" "$*"; }
die() { printf "\033[31mfx install: %s\033[0m\n" "$*" >&2; exit 1; }

# ── Download progress bar (the same ■■■･･･ 42% bar as loop's installer) ──
# Download in the background and draw the bar from how big the file has grown;
# polling a file size costs nothing per frame. Only on a TTY; any failure falls
# back to plain curl in the caller.

PROGRESS_COLOR='\033[38;5;215m'
PROGRESS_NC='\033[0m'

# Bytes in a file, or empty if it isn't there yet. stat's flags differ by libc.
file_size() {
  stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo ""
}

# Content-Length after redirects (GitHub sends you to a CDN); empty when unknown.
remote_size() {
  curl -fsSLI "$1" 2>/dev/null \
    | tr -d '\r' \
    | awk 'BEGIN{IGNORECASE=1} /^content-length:/ {n=$2} END{if (n+0 > 0) print n}'
}

print_progress() {
  local bytes="$1" length="$2" width=50
  if [ "${length:-0}" -le 0 ]; then
    # No total to divide by: show what has arrived rather than a fake bar.
    printf "\r${PROGRESS_COLOR}  %s MB${PROGRESS_NC}" "$(( bytes / 1048576 ))" >&2
    return 0
  fi
  local percent=$(( bytes * 100 / length ))
  [ "$percent" -gt 100 ] && percent=100
  local on=$(( percent * width / 100 ))
  local filled empty
  filled="$(printf "%*s" "$on" "")"
  empty="$(printf "%*s" "$(( width - on ))" "")"
  printf "\r${PROGRESS_COLOR}%s%s %3d%%${PROGRESS_NC}" "${filled// /■}" "${empty// /･}" "$percent" >&2
}

download_with_progress() {
  local url="$1" output="$2" length bytes ret
  length="$(remote_size "$url")"
  # Hide the cursor while the bar redraws; always restore it on the way out.
  printf "\033[?25l" >&2
  trap "trap - RETURN; printf '\033[?25h' >&2" RETURN

  # The exit status lands in a file rather than being polled for: a finished
  # background child is a zombie until waited on, and `kill -0` still succeeds.
  local donefile="$output.done"
  rm -f "$donefile"
  { curl -f -s -L -o "$output" "$url"; echo "$?" > "$donefile"; } &
  while [ ! -s "$donefile" ]; do
    bytes="$(file_size "$output")"
    [ -n "$bytes" ] && print_progress "$bytes" "${length:-0}"
    sleep 0.1
  done
  wait
  ret="$(cat "$donefile")"
  rm -f "$donefile"
  # Land the bar on the real final size rather than wherever the last poll got.
  if [ "$ret" -eq 0 ]; then
    bytes="$(file_size "$output")"
    print_progress "$bytes" "${length:-$bytes}"
  fi
  printf '\n' >&2
  return "$ret"
}

while [ $# -gt 0 ]; do
  case "$1" in
    -v|--version) [ $# -ge 2 ] || die "$1 needs a value"; VERSION="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option $1" ;;
  esac
done

if [ "$UNINSTALL" = "1" ]; then
  rm -f "$INSTALL_DIR/fx"
  bold "✓ Uninstalled $INSTALL_DIR/fx. Your sources and sessions in ~/.fx were kept."
  exit 0
fi

command -v curl >/dev/null || die "curl is required"
command -v tar >/dev/null || die "tar is required"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) die "fx ships for macOS and Linux; this is $(uname -s)" ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=x64 ;;
  *) die "no fx build for $(uname -m)" ;;
esac
# A shell under Rosetta reports x86_64 on an Apple Silicon Mac; the native build is the right one.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  arch=arm64
fi
target="$os-$arch"

if [ -z "$VERSION" ]; then
  # The latest release's page redirects to its tag; no API call, so no rate limit.
  latest_url="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")" ||
    die "could not reach GitHub to find the latest release"
  VERSION="${latest_url##*/}"
fi
case "$VERSION" in v*) ;; *) VERSION="v$VERSION" ;; esac
[ "$VERSION" != "latest" ] || die "no fx release found"

if [ "$FORCE" != "1" ] && [ -x "$INSTALL_DIR/fx" ] && [ "$("$INSTALL_DIR/fx" --version 2>/dev/null)" = "${VERSION#v}" ]; then
  bold "✓ Up to date (fx ${VERSION#v} at $INSTALL_DIR/fx)"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
asset="fx-$target.tar.gz"
base="https://github.com/$REPO/releases/download/$VERSION"

bold "▶ Downloading $asset (fx ${VERSION#v})"
# The bar on a TTY; plain curl otherwise, or when the bar's download fails,
# so the retry shows curl's own error.
if ! { [ -t 2 ] && download_with_progress "$base/$asset" "$tmp/$asset"; }; then
  curl -fL --progress-bar -o "$tmp/$asset" "$base/$asset" || die "no $asset in release $VERSION"
fi
curl -fsSL -o "$tmp/$asset.sha256" "$base/$asset.sha256" || die "no checksum for $asset in release $VERSION"

expected="$(awk '{print $1}' "$tmp/$asset.sha256")"
if command -v sha256sum >/dev/null; then
  actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
fi
[ "$expected" = "$actual" ] || die "checksum mismatch for $asset — not installing it"

tar -xzf "$tmp/$asset" -C "$tmp"
chmod +x "$tmp/fx-$target"
"$tmp/fx-$target" --version >/dev/null || die "the downloaded binary does not run on this machine"

mkdir -p "$INSTALL_DIR"
# Moved into place in one step, so a running fx is never left half-written.
mv -f "$tmp/fx-$target" "$INSTALL_DIR/.fx.new"
mv -f "$INSTALL_DIR/.fx.new" "$INSTALL_DIR/fx"
bold "✓ Installed fx ${VERSION#v} at $INSTALL_DIR/fx"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) say "add it to your PATH:  export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
esac
say "next: run fx, then /login if loop is not signed in on this machine"
