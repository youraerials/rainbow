#!/usr/bin/env bash
#
# postinstall.sh — Runs after the .pkg copies the Rainbow payload to
# /Applications/Rainbow/. Sets up everything the wizard needs without
# requiring Homebrew or Xcode Command Line Tools — every host binary
# we depend on is fetched directly from upstream GitHub releases.
#
# Sequence:
#   1. Fetch host binaries (container, yq, jq, cloudflared, restic) into
#      /Applications/Rainbow/bin via curl + signature/checksum verify.
#   2. Initialize Apple Container (one-time kernel install).
#   3. Install + start the precompiled host control daemon.
#   4. Build the rainbow-web image inside the container VM.
#   5. Spin up the rainbow-setup container and open the wizard in the
#      user's browser.
#
# The .pkg progress bar tracks file copying; this postinstall takes
# ~2-5 minutes more for the binary downloads + image build, so we tee
# everything to /tmp/rainbow-install.log and emit Notification Center
# toasts at each major phase.

set -euo pipefail

INSTALL_DIR="/Applications/Rainbow"
BIN_DIR="$INSTALL_DIR/bin"
LOG_FILE="/tmp/rainbow-install.log"
PRIMARY_USER="${USER:-$(stat -f '%Su' /dev/console)}"
USER_HOME=$(eval echo "~$PRIMARY_USER")

# Helpers
log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
toast() {
    sudo -u "$PRIMARY_USER" osascript \
        -e "display notification \"$2\" with title \"$1\"" \
        2>/dev/null || true
}
fail() {
    log "FATAL: $*"
    toast "Rainbow" "Install failed — see /tmp/rainbow-install.log"
    exit 1
}

log "Rainbow postinstall starting (user=$PRIMARY_USER)"

# Source the binary registry + fetch helper. These live alongside this
# script in the .pkg payload at /Applications/Rainbow/installer/scripts.
SCRIPTS_DIR="$INSTALL_DIR/installer/scripts"
if [ ! -f "$SCRIPTS_DIR/lib/fetch-binary.sh" ]; then
    fail "fetch-binary.sh missing — payload incomplete"
fi
# shellcheck disable=SC1091
source "$SCRIPTS_DIR/lib/fetch-binary.sh"
# shellcheck disable=SC1091
source "$SCRIPTS_DIR/binaries.lock.sh"

mkdir -p "$BIN_DIR"
chown -R "$PRIMARY_USER" "$INSTALL_DIR"

toast "Rainbow" "Fetching tools (~110 MB, takes a couple of minutes)"

# ─── Fetch host binaries ────────────────────────────────────────
log "Fetching host binaries…"
sudo -u "$PRIMARY_USER" -E bash -c "
    source '$SCRIPTS_DIR/lib/fetch-binary.sh'
    source '$SCRIPTS_DIR/binaries.lock.sh'
    export RAINBOW_BIN_DIR='$BIN_DIR'
    fetch_binary container   '\$CONTAINER_VERSION'   '\$CONTAINER_URL'   '\$CONTAINER_MEMBER'   '\$CONTAINER_SHA256'
    fetch_binary yq          '\$YQ_VERSION'          '\$YQ_URL'          '\$YQ_MEMBER'          '\$YQ_SHA256'
    fetch_binary jq          '\$JQ_VERSION'          '\$JQ_URL'          '\$JQ_MEMBER'          '\$JQ_SHA256'
    fetch_binary cloudflared '\$CLOUDFLARED_VERSION' '\$CLOUDFLARED_URL' '\$CLOUDFLARED_MEMBER' '\$CLOUDFLARED_SHA256'
    fetch_binary restic      '\$RESTIC_VERSION'      '\$RESTIC_URL'      '\$RESTIC_MEMBER'      '\$RESTIC_SHA256'
" >> "$LOG_FILE" 2>&1 || fail "binary fetch step failed — see log"

export PATH="$BIN_DIR:$PATH"

toast "Rainbow" "Initializing container runtime"

# ─── Initialize Apple Container ─────────────────────────────────
log "Starting container system…"
sudo -u "$PRIMARY_USER" "$BIN_DIR/container" system start --enable-kernel-install \
    >> "$LOG_FILE" 2>&1 || true
for _ in $(seq 1 20); do
    if sudo -u "$PRIMARY_USER" "$BIN_DIR/container" system status >/dev/null 2>&1; then
        break
    fi
    sleep 2
done
sudo -u "$PRIMARY_USER" "$BIN_DIR/container" system status >/dev/null 2>&1 \
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

toast "Rainbow" "Building Rainbow image (3-5 minutes)"

# ─── Build rainbow-web image ────────────────────────────────────
# Pure container-side build — Apple Container's VM pulls node:22-alpine
# from Docker Hub and runs npm ci + tsc inside. The user's host doesn't
# need Node or any build tooling.
log "Building rainbow-web image…"
sudo -u "$PRIMARY_USER" -E bash -c "
    export PATH='$BIN_DIR:\$PATH'
    cd '$INSTALL_DIR/web'
    container build -t rainbow-web:latest .
" >> "$LOG_FILE" 2>&1 || fail "rainbow-web build failed"

toast "Rainbow" "Starting setup wizard"

# ─── Bind-mount dirs + start setup container ────────────────────
sudo -u "$PRIMARY_USER" mkdir -p \
    "$USER_HOME/Library/Application Support/Rainbow/setup" \
    "$USER_HOME/.cloudflared"

SUBDOMAIN_WORKER_URL="${RAINBOW_SUBDOMAIN_WORKER_URL:-https://rainbow-subdomain-manager.misteranderson.workers.dev}"

# The subdomain API secret is normally embedded in the .pkg payload by
# the release workflow — same value across every install, used to talk
# to rainbow.rocks's Worker. See docs/installer-architecture.md.
# Allow override via env so dev builds without the secret can still set
# one on the command line.
SUBDOMAIN_API_SECRET="${RAINBOW_SUBDOMAIN_API_SECRET:-}"
SECRET_FILE="$INSTALL_DIR/installer/.subdomain-api-secret"
if [ -z "$SUBDOMAIN_API_SECRET" ] && [ -f "$SECRET_FILE" ]; then
    SUBDOMAIN_API_SECRET=$(cat "$SECRET_FILE")
    log "Loaded subdomain API secret from .pkg payload."
fi
if [ -z "$SUBDOMAIN_API_SECRET" ]; then
    log "WARN: subdomain API secret missing — wizard will say 'not configured' at provision."
fi

CONTROL_TOKEN=$(sudo -u "$PRIMARY_USER" /usr/bin/security find-generic-password \
    -s rainbow-control-token -w 2>/dev/null || echo "")

log "Starting setup wizard container…"
sudo -u "$PRIMARY_USER" "$BIN_DIR/container" network create frontend \
    >/dev/null 2>&1 || true
sudo -u "$PRIMARY_USER" "$BIN_DIR/container" delete --force rainbow-setup \
    >/dev/null 2>&1 || true

sudo -u "$PRIMARY_USER" "$BIN_DIR/container" run -d --name rainbow-setup \
    --network frontend \
    --env RAINBOW_SETUP_MODE=1 \
    --env "RAINBOW_SUBDOMAIN_WORKER_URL=$SUBDOMAIN_WORKER_URL" \
    --env "RAINBOW_SUBDOMAIN_API_SECRET=$SUBDOMAIN_API_SECRET" \
    --env RAINBOW_CONTROL_URL=http://host.docker.internal:9001 \
    --env "RAINBOW_CONTROL_TOKEN=$CONTROL_TOKEN" \
    --env "RAINBOW_ROOT=$INSTALL_DIR" \
    --volume "$USER_HOME/Library/Application Support/Rainbow/setup:/var/lib/rainbow/setup" \
    --volume "$USER_HOME/.cloudflared:/var/lib/rainbow/cloudflared" \
    --volume "$INSTALL_DIR/dashboard/dist:/usr/share/web/dashboard:ro" \
    --volume "$INSTALL_DIR:$INSTALL_DIR" \
    rainbow-web:latest >> "$LOG_FILE" 2>&1 \
    || fail "setup container failed to start"

# Wait for an IP
SETUP_IP=""
for _ in $(seq 1 20); do
    SETUP_IP=$(sudo -u "$PRIMARY_USER" "$BIN_DIR/container" inspect rainbow-setup \
        2>/dev/null | "$BIN_DIR/yq" -p=json '.[0].networks[0].ipv4Address // ""' \
        2>/dev/null | sed 's|/.*||')
    if [ -n "$SETUP_IP" ]; then break; fi
    sleep 1
done
[ -n "$SETUP_IP" ] || fail "setup container never got an IP"

WIZARD_URL="http://$SETUP_IP:3000/"
echo "$WIZARD_URL" > "$INSTALL_DIR/.wizard-url"
chmod 644 "$INSTALL_DIR/.wizard-url"

log "Postinstall complete. Wizard at $WIZARD_URL"
toast "Rainbow" "Setup is ready — opening your browser."
sudo -u "$PRIMARY_USER" /usr/bin/open "$WIZARD_URL"

exit 0
