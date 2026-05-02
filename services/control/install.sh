#!/usr/bin/env bash
#
# install.sh — Install the Rainbow control daemon on the macOS host.
#
# Provisions a shared bearer token in macOS Keychain, renders the launchd
# plist with absolute paths, and loads it. The web tier reads the same
# token from Keychain and uses it as the Bearer for /restart, /logs, etc.
#
# Idempotent: re-running upgrades the plist and re-loads.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

LAUNCHD_DIR="$HOME/Library/LaunchAgents"
LAUNCHD_LABEL="rocks.rainbow.control"
LAUNCHD_PLIST="$LAUNCHD_DIR/${LAUNCHD_LABEL}.plist"

# ─── Provision token ─────────────────────────────────────────────
if ! security find-generic-password -s rainbow-control-token -a rainbow -w >/dev/null 2>&1; then
    echo "[control-install] minting rainbow-control-token..."
    security add-generic-password \
        -s rainbow-control-token -a rainbow \
        -w "$(openssl rand -hex 32)" -U
fi

# ─── Find node binary ────────────────────────────────────────────
NODE_BIN=$(command -v node || true)
if [ -z "$NODE_BIN" ]; then
    echo "ERROR: node not found in PATH; install with 'brew install node'" >&2
    exit 1
fi

# ─── Render plist ────────────────────────────────────────────────
mkdir -p "$LAUNCHD_DIR"
mkdir -p "$HOME/Library/Logs"
sed \
    -e "s|/usr/local/bin/node|${NODE_BIN}|" \
    -e "s|__RAINBOW_ROOT__|${PROJECT_ROOT}|g" \
    -e "s|__RAINBOW_HOME__|${HOME}|g" \
    "$SCRIPT_DIR/launchd/rocks.rainbow.control.plist" > "$LAUNCHD_PLIST"

# ─── Reload ──────────────────────────────────────────────────────
launchctl bootout gui/$(id -u) "$LAUNCHD_PLIST" 2>/dev/null || true
launchctl bootstrap gui/$(id -u) "$LAUNCHD_PLIST"

sleep 1
echo ""
echo "Control daemon status:"
if curl -sS -m 3 http://localhost:9001/healthz >/dev/null 2>&1; then
    echo "  http://localhost:9001/healthz OK"
else
    echo "  not yet responding — check $HOME/Library/Logs/rainbow-control.err.log"
fi
echo ""
echo "From the rainbow-web container, reach it at:"
echo "  http://host.docker.internal:9001"
