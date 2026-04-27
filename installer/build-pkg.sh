#!/usr/bin/env bash
#
# build-pkg.sh — Build the Rainbow macOS .pkg installer.
#
# Produces: installer/components/rainbow.pkg
#
# Requirements:
#   - Xcode command line tools
#   - Apple Developer ID (optional, for signing)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
PKG_OUTPUT="$SCRIPT_DIR/components/rainbow.pkg"
IDENTIFIER="rocks.rainbow"
VERSION=$(yq eval '.rainbow.version' "$PROJECT_ROOT/config/rainbow.yaml" 2>/dev/null || echo "0.1.0")

echo "Building Rainbow installer v$VERSION..."

# Clean previous build
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/payload/opt/rainbow"
mkdir -p "$BUILD_DIR/scripts"
mkdir -p "$SCRIPT_DIR/components"

# ─── Copy project files into payload ─────────────────────────────
echo "Preparing payload..."

# Core files
for dir in cli config scripts services infrastructure cloudflare mcp dashboard app-builder backups docs; do
    if [ -d "$PROJECT_ROOT/$dir" ]; then
        cp -R "$PROJECT_ROOT/$dir" "$BUILD_DIR/payload/opt/rainbow/"
    fi
done

# Top-level files
cp "$PROJECT_ROOT/Makefile" "$BUILD_DIR/payload/opt/rainbow/"
cp "$PROJECT_ROOT/README.md" "$BUILD_DIR/payload/opt/rainbow/"
cp "$PROJECT_ROOT/.env.example" "$BUILD_DIR/payload/opt/rainbow/"

# Remove development artifacts
find "$BUILD_DIR/payload" -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
find "$BUILD_DIR/payload" -name ".git" -type d -exec rm -rf {} + 2>/dev/null || true
find "$BUILD_DIR/payload" -name "dist" -type d -exec rm -rf {} + 2>/dev/null || true

# ─── Copy install scripts ───────────────────────────────────────
cp "$SCRIPT_DIR/scripts/preflight.sh" "$BUILD_DIR/scripts/preinstall"
cp "$SCRIPT_DIR/scripts/postinstall.sh" "$BUILD_DIR/scripts/postinstall"
chmod +x "$BUILD_DIR/scripts/preinstall"
chmod +x "$BUILD_DIR/scripts/postinstall"

# ─── Build the component package ─────────────────────────────────
echo "Building component package..."
pkgbuild \
    --root "$BUILD_DIR/payload" \
    --scripts "$BUILD_DIR/scripts" \
    --identifier "$IDENTIFIER" \
    --version "$VERSION" \
    --install-location "/" \
    "$PKG_OUTPUT"

echo ""
echo "Package built: $PKG_OUTPUT"
echo "Size: $(du -h "$PKG_OUTPUT" | cut -f1)"
echo ""

# ─── Optional: build product package with UI ─────────────────────
if [ -f "$SCRIPT_DIR/distribution.xml" ]; then
    PRODUCT_PKG="$SCRIPT_DIR/components/Rainbow-$VERSION.pkg"
    echo "Building product package with installer UI..."
    productbuild \
        --distribution "$SCRIPT_DIR/distribution.xml" \
        --resources "$SCRIPT_DIR/resources" \
        --package-path "$SCRIPT_DIR/components" \
        "$PRODUCT_PKG"
    echo "Product package: $PRODUCT_PKG"
fi

# Clean up
rm -rf "$BUILD_DIR"

echo "Done."
