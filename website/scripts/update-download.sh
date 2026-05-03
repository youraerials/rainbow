#!/usr/bin/env bash
#
# update-download.sh — Sync the brand site's #download metadata with
# whatever's currently the latest GitHub release. Run before
# `wrangler deploy` whenever you cut a new Rainbow.pkg release.
#
# Pulls from the GitHub Releases API:
#   • tag (used as the version label without the leading "v")
#   • Rainbow.pkg asset size (formatted as "KB" or "MB")
#   • Rainbow.pkg.sha256 contents (the published checksum)
#
# Then rewrites four spots in website/index.html:
#   • the hero CTA's "vX.Y.Z · Z MB · macOS 26+" meta line
#   • the download card's Version row
#   • the download card's Size row
#   • the SHA-256 row inside the "Checksums & signatures" disclosure
#
# Idempotent. Safe to re-run; will only emit a diff when a new release
# is up. Uses the standard tools (curl + jq + sed) — no node/bun.

set -euo pipefail

REPO="${RAINBOW_REPO:-youraerials/rainbow}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBSITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INDEX_HTML="$WEBSITE_DIR/index.html"

for cmd in curl jq sed; do
    command -v "$cmd" >/dev/null 2>&1 || {
        echo "ERROR: missing required tool: $cmd" >&2
        exit 1
    }
done

# ─── Pull release metadata ─────────────────────────────────────
echo "Fetching latest release from ${REPO}…"
META=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")

TAG=$(echo "$META" | jq -r '.tag_name')
VERSION="${TAG#v}"
PKG_URL=$(echo "$META" | jq -r '.assets[] | select(.name == "Rainbow.pkg") | .browser_download_url')
PKG_SIZE=$(echo "$META" | jq -r '.assets[] | select(.name == "Rainbow.pkg") | .size')
SHA_URL=$(echo "$META" | jq -r '.assets[] | select(.name == "Rainbow.pkg.sha256") | .browser_download_url')

if [ -z "$PKG_URL" ] || [ "$PKG_URL" = "null" ]; then
    echo "ERROR: latest release has no Rainbow.pkg asset" >&2
    exit 1
fi

# ─── Format size — e.g. 369548 → "361 KB" or "1.4 MB" ──────────
format_size() {
    local bytes="$1"
    if [ "$bytes" -lt $((1024 * 1024)) ]; then
        echo "$((bytes / 1024)) KB"
    elif [ "$bytes" -lt $((1024 * 1024 * 1024)) ]; then
        # one decimal place for MB
        local mb=$((bytes * 10 / 1024 / 1024))
        echo "$((mb / 10)).$((mb % 10)) MB"
    else
        local gb=$((bytes * 10 / 1024 / 1024 / 1024))
        echo "$((gb / 10)).$((gb % 10)) GB"
    fi
}
SIZE=$(format_size "$PKG_SIZE")

# ─── Pull the SHA-256 ──────────────────────────────────────────
SHA256=""
if [ -n "$SHA_URL" ] && [ "$SHA_URL" != "null" ]; then
    SHA256=$(curl -fsSL "$SHA_URL" | awk '{print $1}')
fi

# ─── Hero CTA meta combines version + size + macOS req ─────────
HERO_META="v${VERSION} · ${SIZE} · macOS 26+"

echo
echo "Latest release:"
echo "  Tag:     $TAG"
echo "  Version: $VERSION"
echo "  Size:    $SIZE  ($PKG_SIZE bytes)"
echo "  SHA-256: ${SHA256:-(not published)}"
echo

# ─── In-place edits via a single Python pass ───────────────────
# Python regex handles the multi-line patterns (the brand site's
# Prettier formatting wraps span tags across lines, which BSD sed
# can't easily match by default).

python3 - "$INDEX_HTML" "$VERSION" "$SIZE" "$SHA256" "$HERO_META" <<'PY'
import re, sys, pathlib

path, version, size, sha, hero_meta = sys.argv[1:6]
text = pathlib.Path(path).read_text()

# 1. Hero CTA — the <span class="btn-meta" id="download-meta">…</span>.
#    The opening tag may wrap across lines (`<span class="btn-meta"
#    id="download-meta"\n              >…`), so [\s\S]*? is required.
text = re.sub(
    r'(<span class="btn-meta" id="download-meta"[\s\S]*?>)[\s\S]*?(</span>)',
    rf'\g<1>{hero_meta}\g<2>',
    text,
    count=1,
)

# 2. Download card rows (Version + Size).
def replace_dv(label, new_value, src):
    pattern = re.compile(
        r'(<span class="dv-label">' + re.escape(label) + r'</span>\s*'
        r'<span class="dv-value">)[^<]*(</span>)'
    )
    # `\g<1>` instead of `\1` — when `new_value` starts with a digit
    # (every version we ship does), `\1{0.1.3}` would be parsed as
    # group 10. Named-group syntax dodges that.
    return pattern.sub(rf'\g<1>{new_value}\g<2>', src, count=1)

text = replace_dv("Version", version, text)
text = replace_dv("Size",    size,    text)

# 3. SHA-256 inside the <code> in the checksums block.
if sha:
    text = re.sub(
        r'(<dt>SHA-256</dt>\s*<dd>\s*<code\b[^>]*>)[\s\S]*?(</code>)',
        rf'\g<1>{sha}\g<2>',
        text,
        count=1,
    )

pathlib.Path(path).write_text(text)
PY

echo "Updated $INDEX_HTML."
echo
echo "Diff vs. last commit:"
git -C "$WEBSITE_DIR/.." --no-pager diff --stat -- "$INDEX_HTML" || true
echo
echo "Next:  cd $WEBSITE_DIR && wrangler deploy"
