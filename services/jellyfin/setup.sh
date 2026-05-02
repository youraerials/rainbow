#!/usr/bin/env bash
#
# setup.sh — Post-start initializer for Jellyfin.
#
# Drives the first-run setup wizard via the /Startup/* API so the user never
# sees the wizard's web UI. Then authenticates as the new admin and stores
# the resulting access token in macOS Keychain as `rainbow-jellyfin-api-key`.
#
# Idempotent: skips wizard steps that have already completed; refreshes the
# stored token on each run.
#
# Required Keychain entries:
#   rainbow-jellyfin-admin-password  — admin password for the bootstrap user
#
# Pulls admin email/name from config/rainbow.yaml.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"

LOG="[jellyfin-setup]"
log() { echo "$LOG $*"; }
err() { echo "$LOG $*" >&2; }

PREFIX=$(yq eval '.domain.prefix // ""' "$CONFIG_FILE")
ZONE=$(yq eval '.domain.zone' "$CONFIG_FILE")
[ "$PREFIX" = "null" ] && PREFIX=""
HOST_PREFIX=""
[ -n "$PREFIX" ] && HOST_PREFIX="${PREFIX}-"
JELLYFIN="https://${HOST_PREFIX}media.${ZONE}"

ADMIN_NAME_RAW=$(yq eval '.admin.name // "rainbow"' "$CONFIG_FILE")
# Jellyfin 10.11's /Startup/User silently 500s on names containing capital
# letters (the request commits the change but the response handler throws).
# Coerce to lowercase to dodge that.
ADMIN_NAME=$(echo "$ADMIN_NAME_RAW" | tr '[:upper:]' '[:lower:]')
ADMIN_PASSWORD=$(security find-generic-password -s rainbow-jellyfin-admin-password -w 2>/dev/null || echo "")

# X-Emby-Authorization header is required on /Users/AuthenticateByName even
# without an existing session — it identifies the calling client.
EMBY_AUTH='MediaBrowser Client="rainbow-setup", Device="setup-script", DeviceId="rainbow-setup-1", Version="0.1.0"'

if [ -z "$ADMIN_PASSWORD" ]; then
    err "rainbow-jellyfin-admin-password not in Keychain — generate one and re-run"
    exit 1
fi

# ─── Wait for Jellyfin to be reachable ───────────────────────────
log "Waiting for Jellyfin at $JELLYFIN..."
for _ in $(seq 1 60); do
    if curl -sS -m 3 "$JELLYFIN/System/Info/Public" 2>/dev/null | grep -q '"ProductName"'; then
        log "  Jellyfin is up"
        break
    fi
    sleep 2
done

# ─── Drive the startup wizard if not yet completed ───────────────
INFO=$(curl -sS -m 5 "$JELLYFIN/System/Info/Public")
WIZARD_DONE=$(echo "$INFO" | yq -p=json '.StartupWizardCompleted // false' 2>/dev/null)

if [ "$WIZARD_DONE" != "true" ]; then
    log "Running first-run wizard..."
    # Step 1: initial config (defaults)
    curl -sS -m 10 -X POST "$JELLYFIN/Startup/Configuration" \
        -H "X-Emby-Authorization: $EMBY_AUTH" \
        -H "Content-Type: application/json" \
        -d '{"UICulture":"en-US","MetadataCountryCode":"US","PreferredMetadataLanguage":"en"}' >/dev/null
    # Step 2: create admin user
    curl -sS -m 10 -X POST "$JELLYFIN/Startup/User" \
        -H "X-Emby-Authorization: $EMBY_AUTH" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
            --arg name "$ADMIN_NAME" \
            --arg pw "$ADMIN_PASSWORD" \
            '{Name:$name, Password:$pw}')" >/dev/null
    # Step 3: skip remote-access prompt with defaults
    curl -sS -m 10 -X POST "$JELLYFIN/Startup/RemoteAccess" \
        -H "X-Emby-Authorization: $EMBY_AUTH" \
        -H "Content-Type: application/json" \
        -d '{"EnableRemoteAccess":true,"EnableAutomaticPortMapping":false}' >/dev/null
    # Step 4: mark complete
    curl -sS -m 10 -X POST "$JELLYFIN/Startup/Complete" \
        -H "X-Emby-Authorization: $EMBY_AUTH" >/dev/null
    log "  Wizard complete"
fi

# ─── Authenticate as admin and store access token ────────────────
log "Authenticating as $ADMIN_NAME..."
AUTH_RESP=$(curl -sS -m 10 -X POST "$JELLYFIN/Users/AuthenticateByName" \
    -H "X-Emby-Authorization: $EMBY_AUTH" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg name "$ADMIN_NAME" --arg pw "$ADMIN_PASSWORD" \
        '{Username:$name, Pw:$pw}')")
TOKEN=$(echo "$AUTH_RESP" | yq -p=json '.AccessToken // ""' 2>/dev/null)
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    err "Authentication failed: $AUTH_RESP"
    exit 1
fi
security add-generic-password -s rainbow-jellyfin-api-key -a rainbow -w "$TOKEN" -U
log "  Access token stored: rainbow-jellyfin-api-key"
