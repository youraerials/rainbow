#!/usr/bin/env bash
#
# phase-b-setup.sh — Runs in the user's launchd session after the .pkg
# postinstall completes. Does the slow work that doesn't fit inside
# the .pkg's 10-minute postinstall timeout: build the rainbow-web
# image, start the setup wizard container, open the user's browser.
#
# Triggered by a one-shot LaunchAgent at rocks.rainbow.setup. Removes
# its own plist on exit so it doesn't fire again on next login.

set -euo pipefail

INSTALL_DIR="/Applications/Rainbow"
BIN_DIR="$INSTALL_DIR/bin"
LOG_FILE="/tmp/rainbow-install.log"
PLIST="$HOME/Library/LaunchAgents/rocks.rainbow.setup.plist"

# Plain echo — launchd's StandardOutPath in rocks.rainbow.setup.plist
# already routes stdout to $LOG_FILE. Don't tee or you'll get duplicate
# lines.
log() { echo "[$(date '+%H:%M:%S')] $*"; }
toast() {
    osascript -e "display notification \"$2\" with title \"$1\"" \
        2>/dev/null || true
}

# Prevent the agent from firing on next login. Safe to remove the
# plist while the agent is still running — launchd has it loaded
# in-memory; the file is only consulted at load time.
cleanup_plist() { rm -f "$PLIST"; }

fail() {
    log "FATAL: $*"
    toast "Rainbow" "Setup failed - see /tmp/rainbow-install.log"
    cleanup_plist
    exit 1
}

log "Phase B starting (user=$USER)"

# ─── Pull rainbow-web image from GHCR ─────────────────────────────
# The image is pre-built per-release in CI and pushed to ghcr.io. We
# used to `container build` it on the user's Mac, but Apple Container
# 0.11/0.12's buildkit hits a hard ~140s deadline somewhere in the
# `npm ci` step that we couldn't get around. Pulling a prebuilt image
# is more reliable, faster (~30 s on a typical connection vs 3-5 min
# build), and matches what every other service we orchestrate does.
#
# The image reference below is sed-replaced at .pkg build time by
# installer/build-pkg.sh from $RAINBOW_WEB_IMAGE. Default in dev is
# ghcr.io/<repo-owner>/rainbow-web:<version>.
RAINBOW_WEB_IMAGE="__RAINBOW_WEB_IMAGE__"

toast "Rainbow" "Pulling Rainbow image"
log "Pulling $RAINBOW_WEB_IMAGE..."
"$BIN_DIR/container" image pull "$RAINBOW_WEB_IMAGE" \
    >> "$LOG_FILE" 2>&1 || fail "failed to pull $RAINBOW_WEB_IMAGE"

# Tag it as rainbow-web:latest so the rest of the orchestration (this
# script's run command, the orchestrator's start_* functions) can
# reference a stable local name regardless of the registry path.
"$BIN_DIR/container" image tag "$RAINBOW_WEB_IMAGE" rainbow-web:latest \
    >> "$LOG_FILE" 2>&1 || fail "failed to tag rainbow-web:latest"

# ─── Setup wizard container ───────────────────────────────────────
toast "Rainbow" "Starting setup wizard"

mkdir -p \
    "$HOME/Library/Application Support/Rainbow/setup" \
    "$HOME/.cloudflared"

SUBDOMAIN_WORKER_URL="${RAINBOW_SUBDOMAIN_WORKER_URL:-https://rainbow-subdomain-manager.misteranderson.workers.dev}"
SUBDOMAIN_API_SECRET=""
SECRET_FILE="$INSTALL_DIR/installer/.subdomain-api-secret"
if [ -f "$SECRET_FILE" ]; then
    SUBDOMAIN_API_SECRET=$(cat "$SECRET_FILE")
    log "Loaded subdomain API secret from .pkg payload."
else
    log "WARN: subdomain API secret missing - wizard will say 'not configured' at provision."
fi

CONTROL_TOKEN=$(/usr/bin/security find-generic-password \
    -s rainbow-control-token -w 2>/dev/null || echo "")

log "Starting setup wizard container..."
"$BIN_DIR/container" network create frontend >/dev/null 2>&1 || true
"$BIN_DIR/container" delete --force rainbow-setup >/dev/null 2>&1 || true

"$BIN_DIR/container" run -d --name rainbow-setup \
    --network frontend \
    --env RAINBOW_SETUP_MODE=1 \
    --env "RAINBOW_SUBDOMAIN_WORKER_URL=$SUBDOMAIN_WORKER_URL" \
    --env "RAINBOW_SUBDOMAIN_API_SECRET=$SUBDOMAIN_API_SECRET" \
    --env RAINBOW_CONTROL_URL=http://host.docker.internal:9001 \
    --env "RAINBOW_CONTROL_TOKEN=$CONTROL_TOKEN" \
    --env "RAINBOW_ROOT=$INSTALL_DIR" \
    --volume "$HOME/Library/Application Support/Rainbow/setup:/var/lib/rainbow/setup" \
    --volume "$HOME/.cloudflared:/var/lib/rainbow/cloudflared" \
    --volume "$INSTALL_DIR/dashboard/dist:/usr/share/web/dashboard:ro" \
    --volume "$INSTALL_DIR:$INSTALL_DIR" \
    rainbow-web:latest >> "$LOG_FILE" 2>&1 \
    || fail "setup container failed to start"

# ─── Wait for IP ──────────────────────────────────────────────────
SETUP_IP=""
for _ in $(seq 1 60); do
    SETUP_IP=$("$BIN_DIR/container" inspect rainbow-setup 2>/dev/null \
        | "$BIN_DIR/yq" -p=json '.[0].networks[0].ipv4Address // ""' 2>/dev/null \
        | sed 's|/.*||')
    if [ -n "$SETUP_IP" ]; then break; fi
    sleep 1
done
[ -n "$SETUP_IP" ] || fail "setup container never got an IP"

WIZARD_URL="http://$SETUP_IP:3000/"

# Wait for the wizard to actually serve HTTP. The container can have
# an IP a few seconds before node is listening on :3000, and the
# progress page redirects the moment .wizard-url appears — so we
# don't write that file until a real HTTP response comes back.
log "Waiting for wizard HTTP at $WIZARD_URL…"
for _ in $(seq 1 60); do
    if /usr/bin/curl -sSf -m 2 -o /dev/null "$WIZARD_URL"; then
        break
    fi
    sleep 1
done

echo "$WIZARD_URL" > "$INSTALL_DIR/.wizard-url"
chmod 644 "$INSTALL_DIR/.wizard-url"

log "Phase B complete. Wizard at $WIZARD_URL"
toast "Rainbow" "Setup is ready - opening your browser."
/usr/bin/open "$WIZARD_URL"

cleanup_plist
exit 0
