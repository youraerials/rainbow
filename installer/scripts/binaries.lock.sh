#!/usr/bin/env bash
# binaries.lock.sh — Pinned versions + URLs for every host-side binary
# the installer fetches. Sourced by postinstall.sh; never executed
# standalone. Bumping a version is a single-line edit here, then run
# `installer/scripts/binaries.lock.sh --refresh-checksums` to update
# the SHA-256 column (TODO).
#
# Format: each tool exports two arrays:
#   <TOOL>_VERSION    — semver string used in cache filenames
#   <TOOL>_URL        — full download URL (use ${VERSION} placeholder)
#   <TOOL>_MEMBER     — optional path inside an archive (empty if direct)
#   <TOOL>_SHA256     — optional SHA-256 of the downloaded asset
#
# Where SHAs are blank we fall back to HTTPS-trust. Fill them in before
# any release we tell people to actually run.

# ─── Apple Container ───────────────────────────────────────────
# Apple ships container as a signed .pkg installer. Our fetch helper
# detects the .pkg suffix and runs `installer` against it, then
# symlinks the resulting `/usr/local/bin/container` into our bin dir.
CONTAINER_VERSION="0.12.3"
CONTAINER_URL="https://github.com/apple/container/releases/download/${CONTAINER_VERSION}/container-${CONTAINER_VERSION}-installer-signed.pkg"
CONTAINER_MEMBER=""
CONTAINER_SHA256=""

# ─── yq (Mike Farah, Go) ───────────────────────────────────────
YQ_VERSION="v4.45.1"
YQ_URL="https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_darwin_arm64"
YQ_MEMBER=""
YQ_SHA256=""

# ─── jq ────────────────────────────────────────────────────────
JQ_VERSION="jq-1.7.1"
JQ_URL="https://github.com/jqlang/jq/releases/download/${JQ_VERSION}/jq-macos-arm64"
JQ_MEMBER=""
JQ_SHA256=""

# ─── cloudflared ───────────────────────────────────────────────
CLOUDFLARED_VERSION="2026.3.0"
CLOUDFLARED_URL="https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-darwin-arm64.tgz"
CLOUDFLARED_MEMBER="cloudflared"
CLOUDFLARED_SHA256=""

# ─── restic ────────────────────────────────────────────────────
RESTIC_VERSION="0.18.0"
RESTIC_URL="https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_darwin_arm64.bz2"
RESTIC_MEMBER=""
RESTIC_SHA256=""
