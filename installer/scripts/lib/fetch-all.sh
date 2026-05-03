#!/usr/bin/env bash
#
# fetch-all.sh — Pull every host-side binary the installer needs into
# /Applications/Rainbow/bin. Sources binaries.lock.sh for pinned
# versions + URLs and fetch-binary.sh for the download/verify logic.
#
# Called by installer/scripts/postinstall.sh as the user (NOT root) so
# any temp files end up under /tmp owned correctly. RAINBOW_BIN_DIR
# must be exported by the caller.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/fetch-binary.sh"
# shellcheck disable=SC1091
source "$SCRIPTS_DIR/binaries.lock.sh"

: "${RAINBOW_BIN_DIR:?must be set by caller}"
export RAINBOW_BIN_DIR

fetch_binary container   "$CONTAINER_VERSION"   "$CONTAINER_URL"   "$CONTAINER_MEMBER"   "$CONTAINER_SHA256"
fetch_binary yq          "$YQ_VERSION"          "$YQ_URL"          "$YQ_MEMBER"          "$YQ_SHA256"
fetch_binary jq          "$JQ_VERSION"          "$JQ_URL"          "$JQ_MEMBER"          "$JQ_SHA256"
fetch_binary cloudflared "$CLOUDFLARED_VERSION" "$CLOUDFLARED_URL" "$CLOUDFLARED_MEMBER" "$CLOUDFLARED_SHA256"
fetch_binary restic      "$RESTIC_VERSION"      "$RESTIC_URL"      "$RESTIC_MEMBER"      "$RESTIC_SHA256"
