#!/usr/bin/env bash
#
# uninstall.sh — Clean removal of Rainbow.
#
# This stops all services and removes Rainbow files.
# User data (photos, emails, files) is NOT deleted unless --all is passed.

set -euo pipefail

INSTALL_DIR="/opt/rainbow"
REMOVE_DATA=false

if [ "${1:-}" = "--all" ]; then
    REMOVE_DATA=true
    echo "WARNING: This will delete ALL Rainbow data including photos, emails, and files."
    read -p "Type 'yes' to confirm: " confirm
    if [ "$confirm" != "yes" ]; then
        echo "Cancelled."
        exit 0
    fi
fi

echo "Uninstalling Rainbow..."

# Stop all services
if command -v rainbow &>/dev/null; then
    rainbow stop 2>/dev/null || true
fi

# Remove containers and volumes
if command -v container-compose &>/dev/null; then
    container-compose -f "$INSTALL_DIR/infrastructure/docker-compose.yml" down -v 2>/dev/null || true
elif command -v docker &>/dev/null; then
    docker compose -f "$INSTALL_DIR/infrastructure/docker-compose.yml" down -v 2>/dev/null || true
fi

# Remove launchd services
for plist in \
    "$HOME/Library/LaunchAgents/art.stalw.mail.plist" \
    "$HOME/Library/LaunchAgents/org.jellyfin.server.plist" \
    "$HOME/Library/LaunchAgents/io.papermc.server.plist" \
    "$HOME/Library/LaunchAgents/rocks.rainbow.backup.plist" \
; do
    if [ -f "$plist" ]; then
        launchctl unload "$plist" 2>/dev/null || true
        rm -f "$plist"
    fi
done

# Remove CLI symlink
sudo rm -f /usr/local/bin/rainbow

# Remove Keychain entries
for key in \
    postgres-password authentik-secret authentik-bootstrap-password \
    stalwart-admin-password seafile-admin-password cloudflare-tunnel-token \
    restic-password aws-access-key aws-secret-key cryptpad-admin-key \
    minecraft-rcon-password \
; do
    security delete-generic-password -s "rainbow-$key" 2>/dev/null || true
done

# Remove OAuth Keychain entries
for slug in photos files media docs app api; do
    security delete-generic-password -s "rainbow-oauth-${slug}-client-id" 2>/dev/null || true
    security delete-generic-password -s "rainbow-oauth-${slug}-client-secret" 2>/dev/null || true
done

if $REMOVE_DATA; then
    echo "Removing all data..."
    sudo rm -rf "$INSTALL_DIR"
else
    # Remove application files but keep user data
    echo "Removing application files (keeping user data)..."
    rm -rf "$INSTALL_DIR/cli"
    rm -rf "$INSTALL_DIR/scripts"
    rm -rf "$INSTALL_DIR/config/templates"
    rm -rf "$INSTALL_DIR/cloudflare"
    rm -rf "$INSTALL_DIR/mcp"
    rm -rf "$INSTALL_DIR/dashboard"
    rm -rf "$INSTALL_DIR/app-builder/src"
    echo "User data preserved at $INSTALL_DIR"
fi

echo "Rainbow has been uninstalled."
