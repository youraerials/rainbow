#!/usr/bin/env bash
#
# install.sh — Install Stalwart Mail Server natively on macOS.
#
# Stalwart runs natively (not Docker) for best I/O performance and
# direct filesystem access for mail storage.
#
# Usage: ./services/stalwart/install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"

STALWART_DATA=$(yq eval '.services.stalwart.data_path // "/opt/rainbow/stalwart"' "$CONFIG_FILE")

echo "Installing Stalwart Mail Server..."

# ─── Install via Homebrew ────────────────────────────────────────
if ! command -v stalwart-mail &>/dev/null; then
    echo "Installing stalwart-mail via Homebrew..."
    brew install stalwart-mail
else
    echo "Stalwart is already installed: $(stalwart-mail --version 2>/dev/null || echo 'unknown version')"
fi

# ─── Create data directories ────────────────────────────────────
echo "Creating data directories at $STALWART_DATA..."
sudo mkdir -p "$STALWART_DATA"/{data,blob,fts,certs,logs}
sudo chown -R "$(whoami)" "$STALWART_DATA"

# ─── Generate initial config ────────────────────────────────────
echo "Generating Stalwart configuration..."
bash "$SCRIPT_DIR/configure.sh"

# ─── Install launchd plist ───────────────────────────────────────
echo "Installing launchd service..."
PLIST_SRC="$SCRIPT_DIR/launchd/art.stalw.mail.plist"
PLIST_DST="$HOME/Library/LaunchAgents/art.stalw.mail.plist"

if [ -f "$PLIST_DST" ]; then
    launchctl unload "$PLIST_DST" 2>/dev/null || true
fi

cp "$PLIST_SRC" "$PLIST_DST"
# Update paths in the plist
sed -i '' "s|/opt/rainbow/stalwart|$STALWART_DATA|g" "$PLIST_DST"

# ─── Set up DNS records in Cloudflare ────────────────────────────
echo ""
echo "Setting up email DNS records..."
bash "$SCRIPT_DIR/setup-dns.sh" || {
    echo "WARNING: Automatic DNS setup failed. You can run it manually later:"
    echo "  ./services/stalwart/setup-dns.sh"
}

echo ""
echo "Stalwart Mail Server installed."
echo ""
echo "Next steps:"
echo "  1. Start: brew services start stalwart-mail"
echo "  2. Access admin: https://mail.$(yq eval '.domain.primary' "$CONFIG_FILE")/"
echo "  3. Test email deliverability: https://www.mail-tester.com"
