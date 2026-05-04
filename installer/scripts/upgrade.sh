#!/usr/bin/env bash
#
# upgrade.sh — In-place upgrade of Rainbow.
#
# Runs as a user-space script (no sudo) triggered by the dashboard's
# Update banner. The dashboard hits POST /api/updates/apply on the
# rainbow-web backend, which proxies to the daemon's /run/upgrade
# endpoint, which executes this script and streams the output back as
# Server-Sent Events.
#
# Sequence:
#   1. Resolve the latest release tag from the GitHub Releases API.
#   2. Download rainbow-tree-<version>.tar.gz from that release.
#   3. Extract over /Applications/Rainbow/ (rsync, no --delete — user
#      data dirs live elsewhere; install tree gets refreshed in place).
#   4. Pull the matching rainbow-web image from GHCR and tag it locally
#      as rainbow-web:latest.
#   5. If the rainbow-web container is already running, recreate it via
#      orchestrator's restart-container so it picks up the new image.
#   6. Stamp /Applications/Rainbow/.installed-version with the new
#      version so the dashboard knows we're current.
#
# What this script DOESN'T do:
#   • Bump Apple Container itself (sudo required — separate flow).
#   • Restart the control daemon (would kill the SSE connection
#     reporting our progress). Touch a marker file if the daemon
#     binary changed; the dashboard prompts the user to reload.
#   • Touch user data (~/Library/Application Support/Rainbow/* or
#     anything under ~/.cloudflared).
#
# Idempotent: running while already on latest is a no-op.

set -euo pipefail

INSTALL_DIR="${RAINBOW_ROOT:-/Applications/Rainbow}"
BIN_DIR="$INSTALL_DIR/bin"
REPO="${RAINBOW_REPO:-youraerials/rainbow}"
IMAGE_REPO="${RAINBOW_IMAGE_REPO:-ghcr.io/youraerials/rainbow-web}"

step() { echo "[$(date '+%H:%M:%S')] $*"; }

# ─── 1. Resolve target version ──────────────────────────────────
step "Resolving latest release on $REPO..."
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")
TAG=$(echo "$RELEASE_JSON" | "$BIN_DIR/jq" -r '.tag_name')
[ -n "$TAG" ] && [ "$TAG" != "null" ] || {
    echo "ERROR: couldn't resolve latest tag for $REPO" >&2
    exit 1
}
TARGET_VERSION="${TAG#v}"

CURRENT_VERSION=$(cat "$INSTALL_DIR/.installed-version" 2>/dev/null || echo "unknown")
step "Current: $CURRENT_VERSION"
step "Target:  $TARGET_VERSION"

if [ "$CURRENT_VERSION" = "$TARGET_VERSION" ]; then
    step "Already on $TARGET_VERSION — nothing to do."
    exit 0
fi

# ─── 2. Download the release tarball ────────────────────────────
TARBALL_URL="https://github.com/$REPO/releases/download/$TAG/rainbow-tree-$TARGET_VERSION.tar.gz"
WORK_DIR=$(mktemp -d -t rainbow-upgrade)
trap 'rm -rf "$WORK_DIR"' EXIT

step "Downloading $TARBALL_URL..."
curl -fsSL --retry 3 -o "$WORK_DIR/tree.tar.gz" "$TARBALL_URL"

# ─── 3. Extract + lay over the install dir ──────────────────────
step "Extracting source tree..."
tar -xzf "$WORK_DIR/tree.tar.gz" -C "$WORK_DIR"
EXTRACTED="$WORK_DIR/Applications/Rainbow"
[ -d "$EXTRACTED" ] || {
    echo "ERROR: tarball is missing Applications/Rainbow/ at the top" >&2
    exit 1
}

step "Refreshing $INSTALL_DIR..."
# No --delete: leave .wizard-url, .subdomain-api-secret, anything else
# the user may have created. Stale files from a prior version (a script
# that's been removed in the new release) will linger but are harmless.
rsync -a "$EXTRACTED/" "$INSTALL_DIR/"

# ─── 4. Pull the matching rainbow-web image ─────────────────────
IMAGE_REF="$IMAGE_REPO:$TARGET_VERSION"
step "Pulling $IMAGE_REF..."
"$BIN_DIR/container" image pull "$IMAGE_REF"
"$BIN_DIR/container" image tag "$IMAGE_REF" rainbow-web:latest

# ─── 5. Recreate rainbow-web (if it was running) ────────────────
# Use the orchestrator's restart-container, NOT a plain
# `container restart`. The orchestrator re-reads the env from
# Keychain + .env and recreates the container with the new image —
# `container restart` reuses the original image reference and env
# baked in at first run.
if "$BIN_DIR/container" inspect rainbow-web >/dev/null 2>&1; then
    step "Recreating rainbow-web with new image..."
    bash "$INSTALL_DIR/services/orchestrator.sh" restart-container rainbow-web
else
    step "rainbow-web not currently running — skipping recreate."
fi

# ─── 6. Note daemon-reload requirement (if applicable) ──────────
NEW_DAEMON="$EXTRACTED/bin/Rainbow-Control-Daemon"
INSTALLED_DAEMON="$INSTALL_DIR/bin/Rainbow-Control-Daemon"
if [ -x "$NEW_DAEMON" ]; then
    new_hash=$(shasum -a 256 "$NEW_DAEMON" | awk '{print $1}')
    cur_hash=$(shasum -a 256 "$INSTALLED_DAEMON" 2>/dev/null | awk '{print $1}' || echo "")
    if [ "$new_hash" != "$cur_hash" ]; then
        step "Control daemon binary changed — needs reload for new code."
        # Marker file the dashboard checks. We don't kickstart from
        # here — that would terminate the SSE connection reporting
        # this very upgrade. Dashboard offers a one-click reload
        # button after the upgrade completes.
        touch "$INSTALL_DIR/.daemon-reload-pending"
    fi
fi

# ─── 7. Stamp the new version ───────────────────────────────────
echo "$TARGET_VERSION" > "$INSTALL_DIR/.installed-version"
chmod 644 "$INSTALL_DIR/.installed-version"

step "Upgrade to $TARGET_VERSION complete."
