#!/usr/bin/env bash
# fetch-binary.sh — Pull a tool binary from a GitHub release into
# /Applications/Rainbow/bin without involving Homebrew or Xcode CLI.
#
# Usage:
#   fetch_binary <tool-name> <version> <download-url> [<archive-member>] [<expected-sha256>]
#
# - <tool-name>      final filename in /Applications/Rainbow/bin
# - <version>        used for cache + logging
# - <download-url>   absolute URL of the release asset
# - <archive-member> optional path inside .tar.gz / .zip — extract that
#                    file as <tool-name>. If omitted the URL must point
#                    directly at the binary.
# - <expected-sha256> optional. If set we verify before installing.
#
# Idempotent: skips download when the same version is already present.

BIN_DIR="${RAINBOW_BIN_DIR:-/Applications/Rainbow/bin}"
CACHE_DIR="${RAINBOW_FETCH_CACHE:-${TMPDIR:-/tmp}/rainbow-fetch}"

fetch_binary() {
    local name="$1" version="$2" url="$3" member="${4:-}" sha="${5:-}"
    local target="$BIN_DIR/$name"
    local stamp="$BIN_DIR/.$name.version"

    mkdir -p "$BIN_DIR" "$CACHE_DIR"

    if [ -x "$target" ] && [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$version" ]; then
        echo "  $name $version — already installed"
        return 0
    fi

    local cached="$CACHE_DIR/$name-$version-$(basename "$url")"
    if [ ! -s "$cached" ]; then
        echo "  $name $version — downloading $url"
        curl -fsSL --retry 3 -o "$cached" "$url"
    fi

    if [ -n "$sha" ]; then
        local actual
        actual=$(shasum -a 256 "$cached" | awk '{print $1}')
        if [ "$actual" != "$sha" ]; then
            echo "ERROR: $name SHA-256 mismatch" >&2
            echo "  expected: $sha" >&2
            echo "  actual:   $actual" >&2
            rm -f "$cached"
            return 1
        fi
    fi

    case "$cached" in
        *.tar.gz|*.tgz)
            local tmpd; tmpd=$(mktemp -d)
            tar -xzf "$cached" -C "$tmpd"
            if [ -n "$member" ]; then
                cp "$tmpd/$member" "$target"
            else
                # Single binary at root of archive — pick the first
                # executable file.
                local first
                first=$(find "$tmpd" -maxdepth 2 -type f -perm +111 | head -1)
                cp "$first" "$target"
            fi
            rm -rf "$tmpd"
            ;;
        *.zip)
            local tmpd; tmpd=$(mktemp -d)
            unzip -q "$cached" -d "$tmpd"
            if [ -n "$member" ]; then
                cp "$tmpd/$member" "$target"
            else
                local first
                first=$(find "$tmpd" -maxdepth 2 -type f -perm +111 | head -1)
                cp "$first" "$target"
            fi
            rm -rf "$tmpd"
            ;;
        *.bz2)
            local out="$CACHE_DIR/$(basename "$cached" .bz2)"
            bunzip2 -k -f -c "$cached" > "$out"
            cp "$out" "$target"
            rm -f "$out"
            ;;
        *.gz)
            # bare gzip (not tar) — single-file decompress
            local out="$CACHE_DIR/$(basename "$cached" .gz)"
            gunzip -k -f -c "$cached" > "$out"
            cp "$out" "$target"
            rm -f "$out"
            ;;
        *.pkg)
            # Apple's `container` distribution is a .pkg. Run it
            # silently — it installs to /usr/local/bin/container.
            # We then symlink that into our bin dir so callers
            # don't need to know where Apple put it.
            sudo -n /usr/sbin/installer -pkg "$cached" -target / >/dev/null
            local installed_path="/usr/local/bin/container"
            if [ -x "$installed_path" ]; then
                ln -sf "$installed_path" "$target"
            else
                echo "ERROR: $name .pkg installed but $installed_path missing" >&2
                return 1
            fi
            ;;
        *)
            # Treat as a raw binary
            cp "$cached" "$target"
            ;;
    esac

    chmod +x "$target"
    echo "$version" > "$stamp"
    echo "  $name $version — installed to $target"
}
