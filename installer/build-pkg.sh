#!/usr/bin/env bash
#
# build-pkg.sh — Build the Rainbow.pkg installer.
#
# Output: installer/build/Rainbow-<version>.pkg
#
# Two outputs from one run:
#   1. A component package (rainbow-component.pkg) — raw payload + scripts
#   2. A product package (Rainbow-<version>.pkg) — wrapped with the
#      installer UI (welcome/conclusion HTML, optional license)
#
# The product package is what users download. For codesigned releases,
# pass DEV_ID="Developer ID Installer: Your Name (TEAMID)" and we'll
# sign + notarize. Without it we produce an unsigned dev .pkg that
# users can right-click → Open to bypass Gatekeeper.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
PAYLOAD_DIR="$BUILD_DIR/payload"
SCRIPTS_DIR="$BUILD_DIR/scripts"

IDENTIFIER="rocks.rainbow.installer"
VERSION="${RAINBOW_VERSION:-$(yq eval '.rainbow.version' "$PROJECT_ROOT/config/rainbow.yaml" 2>/dev/null || echo "0.1.0")}"
COMPONENT_PKG="$BUILD_DIR/rainbow-component.pkg"
PRODUCT_PKG="$BUILD_DIR/Rainbow-$VERSION.pkg"

DEV_ID="${DEV_ID:-}"

# ─── Pre-flight ────────────────────────────────────────────────────
for cmd in pkgbuild productbuild yq; do
    command -v "$cmd" >/dev/null 2>&1 || {
        echo "Missing required command: $cmd" >&2
        exit 1
    }
done

echo "Building Rainbow.pkg v$VERSION"
echo "  Payload root:    $PAYLOAD_DIR"
echo "  Install location: /Applications/Rainbow"
echo

rm -rf "$BUILD_DIR"
mkdir -p "$PAYLOAD_DIR/Applications/Rainbow"
mkdir -p "$SCRIPTS_DIR"

# ─── Payload ───────────────────────────────────────────────────────
# Everything that needs to live on the user's machine after install.
# Build artifacts (dashboard/dist) get rebuilt on-the-fly during install
# anyway, but we ship a pre-built bundle so the wizard works without
# requiring `npm install` post-install.

echo "Preparing payload…"

# Source files for the project
RSYNC_EXCLUDES=(
    --exclude=node_modules
    --exclude=dist
    --exclude=.git
    --exclude=.wrangler
    --exclude="*.tmp"
    --exclude="test"
    --exclude=".DS_Store"
    --exclude="Rainbow-Control-Daemon"  # rebuilt below
    --exclude=".build"                  # Swift / SPM build artifacts
    --exclude="build"                   # installer's own build dir
    --exclude="*.log"
    --exclude=".env"
    --exclude=".env.local"
    --exclude="package-lock.json"       # not needed at runtime; saves a few MB
)
for dir in cli config scripts services cloudflare web app-builder backups docs website; do
    if [ -d "$PROJECT_ROOT/$dir" ]; then
        rsync -a "${RSYNC_EXCLUDES[@]}" \
            "$PROJECT_ROOT/$dir/" "$PAYLOAD_DIR/Applications/Rainbow/$dir/"
    fi
done

# postinstall.sh sources two helper files from the install dir at
# runtime — ship just those, not the whole installer/ tree (which has
# build artifacts, the brand site's installer chrome HTML, etc.).
mkdir -p "$PAYLOAD_DIR/Applications/Rainbow/installer/scripts/lib"
cp "$SCRIPT_DIR/scripts/binaries.lock.sh" \
   "$PAYLOAD_DIR/Applications/Rainbow/installer/scripts/binaries.lock.sh"
cp "$SCRIPT_DIR/scripts/lib/fetch-binary.sh" \
   "$PAYLOAD_DIR/Applications/Rainbow/installer/scripts/lib/fetch-binary.sh"

# Compile the host control daemon (Swift) and ship the binary in the
# payload's bin/ directory. Drops the Node dependency for the user's
# Mac — Apple ships the Swift runtime, the compiler is only needed
# here at build time.
echo "Compiling host control daemon (Swift)…"
mkdir -p "$PAYLOAD_DIR/Applications/Rainbow/bin"
swiftc -O "$PROJECT_ROOT/services/control/Daemon.swift" \
    -o "$PAYLOAD_DIR/Applications/Rainbow/bin/Rainbow-Control-Daemon"
chmod +x "$PAYLOAD_DIR/Applications/Rainbow/bin/Rainbow-Control-Daemon"

# Pre-built dashboard/dist — needed for the setup wizard to render
# without an npm step. Rebuild it now if missing.
if [ ! -f "$PROJECT_ROOT/dashboard/dist/index.html" ]; then
    echo "Building dashboard/dist…"
    (cd "$PROJECT_ROOT/dashboard" && npm install --no-audit --no-fund && npm run build) \
        >> "$BUILD_DIR/build.log" 2>&1
fi
mkdir -p "$PAYLOAD_DIR/Applications/Rainbow/dashboard"
rsync -a "$PROJECT_ROOT/dashboard/dist/" "$PAYLOAD_DIR/Applications/Rainbow/dashboard/dist/"
# Ship dashboard's package + tsconfig so the wizard build is reproducible
# from the install dir if the user wants to fork.
for f in package.json tsconfig.json vite.config.ts index.html; do
    cp "$PROJECT_ROOT/dashboard/$f" "$PAYLOAD_DIR/Applications/Rainbow/dashboard/$f"
done
cp -R "$PROJECT_ROOT/dashboard/src" "$PAYLOAD_DIR/Applications/Rainbow/dashboard/src"

# Top-level files
cp "$PROJECT_ROOT/Makefile" "$PAYLOAD_DIR/Applications/Rainbow/"
cp "$PROJECT_ROOT/README.md" "$PAYLOAD_DIR/Applications/Rainbow/"
cp "$PROJECT_ROOT/LICENSE" "$PAYLOAD_DIR/Applications/Rainbow/" 2>/dev/null || true
cp "$PROJECT_ROOT/CLAUDE.md" "$PAYLOAD_DIR/Applications/Rainbow/" 2>/dev/null || true

# ─── Scripts ───────────────────────────────────────────────────────
# pkgbuild expects scripts named exactly "preinstall" and "postinstall"
# (no extension). Copy ours under those names.

cp "$SCRIPT_DIR/scripts/preflight.sh" "$SCRIPTS_DIR/preinstall"
cp "$SCRIPT_DIR/scripts/postinstall.sh" "$SCRIPTS_DIR/postinstall"
chmod +x "$SCRIPTS_DIR/preinstall" "$SCRIPTS_DIR/postinstall"

# ─── Build component package ───────────────────────────────────────

echo "Building component package…"
pkgbuild \
    --root "$PAYLOAD_DIR" \
    --scripts "$SCRIPTS_DIR" \
    --identifier "$IDENTIFIER" \
    --version "$VERSION" \
    --install-location "/" \
    "$COMPONENT_PKG"

# ─── Build product package (with installer UI) ─────────────────────

DISTRIBUTION_XML="$BUILD_DIR/distribution.xml"
cat > "$DISTRIBUTION_XML" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
    <title>Rainbow</title>
    <organization>$IDENTIFIER</organization>
    <domains enable_localSystem="true"/>
    <options customize="never" require-scripts="true" rootVolumeOnly="true" hostArchitectures="arm64"/>
    <volume-check>
        <allowed-os-versions>
            <os-version min="26.0"/>
        </allowed-os-versions>
    </volume-check>
    <welcome file="welcome.html" mime-type="text/html"/>
    <conclusion file="conclusion.html" mime-type="text/html"/>
    <pkg-ref id="$IDENTIFIER"/>
    <choices-outline>
        <line choice="default">
            <line choice="$IDENTIFIER"/>
        </line>
    </choices-outline>
    <choice id="default"/>
    <choice id="$IDENTIFIER" visible="false">
        <pkg-ref id="$IDENTIFIER"/>
    </choice>
    <pkg-ref id="$IDENTIFIER" version="$VERSION" onConclusion="none">$(basename "$COMPONENT_PKG")</pkg-ref>
</installer-gui-script>
EOF

echo "Building product package…"
productbuild \
    --distribution "$DISTRIBUTION_XML" \
    --resources "$SCRIPT_DIR/resources" \
    --package-path "$BUILD_DIR" \
    "$PRODUCT_PKG"

# ─── Optional codesigning + notarization ───────────────────────────

if [ -n "$DEV_ID" ]; then
    echo "Signing with: $DEV_ID"
    SIGNED_PKG="$BUILD_DIR/Rainbow-$VERSION-signed.pkg"
    productsign --sign "$DEV_ID" "$PRODUCT_PKG" "$SIGNED_PKG"
    mv "$SIGNED_PKG" "$PRODUCT_PKG"

    if [ -n "${NOTARY_PROFILE:-}" ]; then
        echo "Submitting for notarization (profile: $NOTARY_PROFILE)…"
        xcrun notarytool submit "$PRODUCT_PKG" \
            --keychain-profile "$NOTARY_PROFILE" \
            --wait
        xcrun stapler staple "$PRODUCT_PKG"
    else
        echo "Skipping notarization (set NOTARY_PROFILE to enable)"
    fi
fi

# ─── Done ──────────────────────────────────────────────────────────

echo
echo "Built:"
echo "  $PRODUCT_PKG ($(du -h "$PRODUCT_PKG" | cut -f1))"
[ -n "$DEV_ID" ] && echo "  Signed: yes" || echo "  Signed: no (Gatekeeper will warn — user right-clicks → Open first time)"
echo
echo "To test locally:"
echo "  sudo installer -pkg \"$PRODUCT_PKG\" -target /"
