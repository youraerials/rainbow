#!/usr/bin/env bash
#
# install.sh — Install Jellyfin media server natively on macOS.
#
# Jellyfin runs natively to leverage Apple Metal for hardware transcoding,
# which is not available inside Docker containers on macOS.
#
# Usage: ./services/jellyfin/install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"

echo "Installing Jellyfin Media Server..."

# ─── Install via Homebrew ────────────────────────────────────────
if ! command -v jellyfin &>/dev/null; then
    echo "Installing jellyfin via Homebrew..."
    brew install jellyfin
else
    echo "Jellyfin is already installed."
fi

# ─── Configure media paths ──────────────────────────────────────
echo ""
echo "Jellyfin will be accessible at: https://media.$(yq eval '.domain.primary' "$CONFIG_FILE")"
echo ""
echo "Configure your media libraries in the Jellyfin web UI after first launch."
echo "Media paths from rainbow.yaml:"
yq eval '.services.jellyfin.media_paths[]' "$CONFIG_FILE" 2>/dev/null | while read -r path; do
    echo "  - $path"
done

# ─── Install launchd plist ───────────────────────────────────────
PLIST_SRC="$SCRIPT_DIR/launchd/org.jellyfin.server.plist"
PLIST_DST="$HOME/Library/LaunchAgents/org.jellyfin.server.plist"

if [ -f "$PLIST_DST" ]; then
    launchctl unload "$PLIST_DST" 2>/dev/null || true
fi

cp "$PLIST_SRC" "$PLIST_DST"

echo ""
echo "Jellyfin installed."
echo "Start with: brew services start jellyfin"
echo "Or: rainbow start jellyfin"
echo ""
echo "First-run setup:"
echo "  1. Open https://media.$(yq eval '.domain.primary' "$CONFIG_FILE")"
echo "  2. Create an admin account"
echo "  3. Add media libraries pointing to your media paths"
echo "  4. Enable hardware transcoding (Settings > Playback > Hardware acceleration: Apple VideoToolbox)"
