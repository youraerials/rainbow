#!/usr/bin/env bash
#
# install.sh — Install the Rainbow control daemon on the macOS host.
#
# Provisions a shared bearer token in macOS Keychain, points launchd at
# the precompiled Swift daemon binary, loads it. The web tier reads the
# same token from Keychain and uses it as the Bearer for /restart, /run,
# /keychain etc.
#
# Compiled binary location preference, in order:
#   1. $RAINBOW_BIN_DIR/Rainbow-Control-Daemon (set by the .pkg postinstall
#      to /Applications/Rainbow/bin/)
#   2. <repo>/services/control/Rainbow-Control-Daemon (compiled in-place
#      during dev with `swiftc -O Daemon.swift -o Rainbow-Control-Daemon`)
#   3. Compile on-demand via swiftc if it's available
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

# ─── Locate or build the daemon binary ───────────────────────────
DAEMON_BIN=""
if [ -n "${RAINBOW_BIN_DIR:-}" ] && [ -x "$RAINBOW_BIN_DIR/Rainbow-Control-Daemon" ]; then
    DAEMON_BIN="$RAINBOW_BIN_DIR/Rainbow-Control-Daemon"
elif [ -x "$SCRIPT_DIR/Rainbow-Control-Daemon" ]; then
    DAEMON_BIN="$SCRIPT_DIR/Rainbow-Control-Daemon"
elif command -v swiftc >/dev/null 2>&1; then
    echo "[control-install] compiling Daemon.swift..."
    swiftc -O "$SCRIPT_DIR/Daemon.swift" -o "$SCRIPT_DIR/Rainbow-Control-Daemon"
    DAEMON_BIN="$SCRIPT_DIR/Rainbow-Control-Daemon"
else
    echo "ERROR: no Rainbow-Control-Daemon binary found and swiftc unavailable." >&2
    echo "  Looked at:" >&2
    echo "    \$RAINBOW_BIN_DIR/Rainbow-Control-Daemon" >&2
    echo "    $SCRIPT_DIR/Rainbow-Control-Daemon" >&2
    exit 1
fi
echo "[control-install] using daemon binary: $DAEMON_BIN"

# ─── Render plist ────────────────────────────────────────────────
mkdir -p "$LAUNCHD_DIR"
mkdir -p "$HOME/Library/Logs"
sed \
    -e "s|__RAINBOW_DAEMON_BIN__|${DAEMON_BIN}|" \
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
