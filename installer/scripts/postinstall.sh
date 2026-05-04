#!/usr/bin/env bash
#
# postinstall.sh — Phase A. Runs as root inside the .pkg sandbox.
# Fetches host binaries, initializes Apple Container, installs the
# host control daemon, then hands off to Phase B (a one-shot
# LaunchAgent in the user's session) which builds the rainbow-web
# image and starts the setup wizard.
#
# Why split? .pkg postinstall has a hard 10-minute timeout enforced
# by installd, and Apple Container's `container run` can easily hang
# longer than that on first start (cold VM, virtiofs setup, image
# extraction). The container apiserver also runs as the user (not
# root), so driving it from the .pkg sandbox crosses session
# boundaries unnecessarily. Phase B runs in the user's launchd
# session where neither problem exists.
#
# Sequence (Phase A, fast — well under 60s):
#   1. Fetch host binaries (container, yq, jq, cloudflared, restic)
#      from upstream GitHub releases. Apple Container ships as a
#      .pkg that needs root to install — that's why this phase has
#      to run as root.
#   2. Initialize Apple Container (one-time kernel install).
#   3. Install + start the host control daemon as a user LaunchAgent.
#   4. Drop the Phase B LaunchAgent and bootstrap it into the user's
#      GUI session.

set -euo pipefail

INSTALL_DIR="/Applications/Rainbow"
BIN_DIR="$INSTALL_DIR/bin"
LOG_FILE="/tmp/rainbow-install.log"
PRIMARY_USER="${USER:-$(stat -f '%Su' /dev/console)}"
USER_HOME=$(eval echo "~$PRIMARY_USER")
USER_ID=$(id -u "$PRIMARY_USER")

# Helpers
log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
toast() {
    sudo -u "$PRIMARY_USER" osascript \
        -e "display notification \"$2\" with title \"$1\"" \
        2>/dev/null || true
}
fail() {
    log "FATAL: $*"
    toast "Rainbow" "Install failed - see /tmp/rainbow-install.log"
    exit 1
}

log "Rainbow postinstall (Phase A) starting (user=$PRIMARY_USER)"

# Source the binary registry + fetch helper. These live alongside this
# script in the .pkg payload at /Applications/Rainbow/installer/scripts.
SCRIPTS_DIR="$INSTALL_DIR/installer/scripts"
if [ ! -f "$SCRIPTS_DIR/lib/fetch-binary.sh" ]; then
    fail "fetch-binary.sh missing - payload incomplete"
fi
# shellcheck disable=SC1091
source "$SCRIPTS_DIR/lib/fetch-binary.sh"
# shellcheck disable=SC1091
source "$SCRIPTS_DIR/binaries.lock.sh"

mkdir -p "$BIN_DIR"
chown -R "$PRIMARY_USER" "$INSTALL_DIR"

toast "Rainbow" "Fetching tools (~110 MB, takes a couple of minutes)"

# ─── Fetch host binaries ────────────────────────────────────────
# Run AS ROOT (we already are inside .pkg postinstall) so the .pkg
# installer that ships Apple Container can run with `-target /`
# without a prompt. Binaries land at $BIN_DIR owned by root, mode
# 0755 — that's the standard pattern for /Applications/* tools.
log "Fetching host binaries…"
RAINBOW_BIN_DIR="$BIN_DIR" \
    bash "$SCRIPTS_DIR/lib/fetch-all.sh" \
    >> "$LOG_FILE" 2>&1 || fail "binary fetch step failed - see log"

export PATH="$BIN_DIR:$PATH"

toast "Rainbow" "Initializing container runtime"

# ─── Initialize Apple Container ─────────────────────────────────
# IMPORTANT: invoke the CLI at /usr/local/bin/container (where Apple's
# .pkg actually installs it), NOT via our $BIN_DIR symlink. The CLI
# derives CONTAINER_INSTALL_ROOT from its own argv[0] when generating
# the apiserver's launchd plist — so calling it via a symlink under
# /Applications/Rainbow/ produces a plist that looks for the apiserver
# binary + plugins under /Applications/Rainbow/, where they don't
# exist. That bakes in a broken apiserver state for the rest of the
# install. See incident notes 2026-05-03.
log "Starting container system…"

# Clean restart of the container system. Two reasons:
#   1. If a prior install (or a brew-installed `container`) left an
#      apiserver loaded from a different path, we need it gone so our
#      .pkg's apiserver at /usr/local/bin/container-apiserver can take
#      over with correct paths. Common case: brew uninstall left the
#      apiserver process running with its binary deleted in memory.
#   2. Each install needs the network plugins (container-network-vmnet
#      for default/frontend/backend) to come up fresh. If they're stale
#      from a prior run, the host-side bridge interface (bridge100,
#      etc.) doesn't get configured, and host->container traffic
#      silently fails. Confirmed via repro 2026-05-03.
sudo -u "$PRIMARY_USER" /usr/local/bin/container system stop \
    >> "$LOG_FILE" 2>&1 || true
sudo -u "$PRIMARY_USER" launchctl bootout \
    "gui/$USER_ID/com.apple.container.apiserver" >/dev/null 2>&1 || true
for plugin in default backend frontend; do
    sudo -u "$PRIMARY_USER" launchctl bootout \
        "gui/$USER_ID/com.apple.container.container-network-vmnet.$plugin" \
        >/dev/null 2>&1 || true
done
sleep 2

sudo -u "$PRIMARY_USER" /usr/local/bin/container system start --enable-kernel-install \
    >> "$LOG_FILE" 2>&1 || true
for _ in $(seq 1 20); do
    if sudo -u "$PRIMARY_USER" /usr/local/bin/container system status >/dev/null 2>&1; then
        break
    fi
    sleep 2
done
sudo -u "$PRIMARY_USER" /usr/local/bin/container system status >/dev/null 2>&1 \
    || fail "container system never came up"

toast "Rainbow" "Installing host control daemon"

# ─── Install host control daemon ────────────────────────────────
# The daemon binary is precompiled by the release workflow and ships
# in the .pkg payload at $BIN_DIR/Rainbow-Control-Daemon.
log "Installing host control daemon…"
sudo -u "$PRIMARY_USER" -E bash -c "
    export RAINBOW_BIN_DIR='$BIN_DIR'
    bash '$INSTALL_DIR/services/control/install.sh'
" >> "$LOG_FILE" 2>&1 || fail "control daemon install failed"

# ─── Hand off to Phase B ────────────────────────────────────────
# Phase B (image build + wizard container start) runs as a one-shot
# LaunchAgent in the user's GUI session — that's where Apple
# Container's apiserver lives, and there's no .pkg timeout to fight.
log "Installing Phase B LaunchAgent…"
USER_LAUNCH_AGENTS="$USER_HOME/Library/LaunchAgents"
PHASE_B_PLIST="$USER_LAUNCH_AGENTS/rocks.rainbow.setup.plist"

sudo -u "$PRIMARY_USER" mkdir -p "$USER_LAUNCH_AGENTS"
cp "$INSTALL_DIR/installer/resources/rocks.rainbow.setup.plist" "$PHASE_B_PLIST"
chown "$PRIMARY_USER" "$PHASE_B_PLIST"

# The log file was created by Phase A running as root. Hand ownership
# to the user so Phase B (running in the user's launchd session) can
# append to it without permission errors.
chown "$PRIMARY_USER" "$LOG_FILE" 2>/dev/null || true

# Bootstrap into the user's GUI domain so Phase B can run osascript
# (toasts) and `open` against the user's display. Must be invoked as
# the user — root can't bootstrap into another session's gui domain.
sudo -u "$PRIMARY_USER" launchctl bootout "gui/$USER_ID/rocks.rainbow.setup" \
    >/dev/null 2>&1 || true
sudo -u "$PRIMARY_USER" launchctl bootstrap "gui/$USER_ID" "$PHASE_B_PLIST" \
    >> "$LOG_FILE" 2>&1 || fail "failed to bootstrap Phase B agent"

# ─── Open the progress page ─────────────────────────────────────
# The control daemon serves a brand-styled progress page at /setup-progress
# that polls /wizard-status. This gives the user something to watch
# during the 3-5 minute Phase B work — far less ambiguous than a
# silent wait punctuated by Notification Center toasts. The page
# auto-redirects to the wizard once Phase B writes /Applications/
# Rainbow/.wizard-url.
log "Opening setup progress page…"
sudo -u "$PRIMARY_USER" /usr/bin/open "http://localhost:9001/setup-progress" \
    >/dev/null 2>&1 || true

# The .pkg payload already carries /Applications/Rainbow/.installed-version
# (build-pkg.sh writes it from the release tag). Just make sure ownership
# matches the primary user — chown -R further up handled the install
# tree but the version file is small + cheap to repeat.
VERSION_FILE="$INSTALL_DIR/.installed-version"
if [ -f "$VERSION_FILE" ]; then
    chown "$PRIMARY_USER" "$VERSION_FILE"
    chmod 644 "$VERSION_FILE"
    log "Installed version: $(cat "$VERSION_FILE")"
fi

log "Postinstall (Phase A) complete. Phase B running via LaunchAgent."

exit 0
