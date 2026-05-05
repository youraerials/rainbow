#!/usr/bin/env bash
#
# apply.sh — Push the Rainbow brand CSS into each bundled service via
# its admin API. Idempotent. Skips any service whose creds aren't yet
# provisioned (so it's safe to run from start_minimum before Immich
# has been bootstrapped, etc.).
#
# Source CSS lives at config/brand/<service>.css. Edit those files
# (or the shared _base.css) and re-run this script — no container
# restarts needed for any of the API-driven targets.
#
# Targets:
#   Immich     — PUT /api/system-config (theme.customCss)
#   Authentik  — PATCH /api/v3/core/brands/<default>/  (branding_custom_css)
#   Jellyfin   — POST /Branding/Configuration         (CustomCss)
#
# CryptPad is file-mount-only (customize/customize.css) and is wired
# in via the orchestrator's init container — see start_cryptpad in
# services/orchestrator.sh.
#
# Usage: ./services/brand/apply.sh [--quiet]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"
BRAND_DIR="$PROJECT_ROOT/config/brand"

QUIET=false
[ "${1:-}" = "--quiet" ] && QUIET=true

log() { $QUIET || echo "[brand] $*"; }
warn() { echo "[brand] $*" >&2; }

PREFIX=$(yq eval '.domain.prefix // ""' "$CONFIG_FILE")
ZONE=$(yq eval '.domain.zone' "$CONFIG_FILE")
[ "$PREFIX" = "null" ] && PREFIX=""
HOST_PREFIX=""
[ -n "$PREFIX" ] && HOST_PREFIX="${PREFIX}-"

read_css() {
    local file="$BRAND_DIR/$1"
    if [ ! -f "$file" ]; then
        warn "missing $file — skipping"
        return 1
    fi
    cat "$file"
}

# ─── Immich ──────────────────────────────────────────────────────
apply_immich() {
    local css
    css=$(read_css "immich.css") || return 0
    local immich="https://${HOST_PREFIX}photos.${ZONE}/api"
    local email password token current new
    email=$(yq eval '.admin.email' "$CONFIG_FILE")
    password=$(security find-generic-password -s rainbow-immich-admin-password -w 2>/dev/null || echo "")
    if [ -z "$password" ]; then
        log "immich: admin password not yet in Keychain — skipping"
        return 0
    fi
    token=$(curl -sS -m 10 -X POST "$immich/auth/login" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg e "$email" --arg p "$password" '{email:$e,password:$p}')" \
        | jq -r '.accessToken // empty')
    if [ -z "$token" ]; then
        log "immich: login failed — skipping (run services/immich/setup.sh first?)"
        return 0
    fi
    current=$(curl -sS -m 10 -H "Authorization: Bearer $token" "$immich/system-config")
    new=$(echo "$current" | jq --arg css "$css" '.theme.customCss = $css')
    if [ "$current" = "$new" ]; then
        log "immich: brand CSS already up to date"
        return 0
    fi
    if curl -sS -m 10 -X PUT "$immich/system-config" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "$new" \
        | jq -e '.theme.customCss' >/dev/null 2>&1; then
        log "immich: brand CSS applied"
    else
        warn "immich: PUT didn't stick"
    fi
}

# ─── Authentik ───────────────────────────────────────────────────
apply_authentik() {
    local css
    css=$(read_css "authentik.css") || return 0
    local authentik="https://${HOST_PREFIX}auth.${ZONE}"
    local token brand_pk current new_css
    token=$(security find-generic-password -s rainbow-authentik-api-token -w 2>/dev/null || echo "")
    if [ -z "$token" ]; then
        log "authentik: API token not yet in Keychain — skipping"
        return 0
    fi
    # Authentik ships a default brand whose `default` flag is true. Find it.
    brand_pk=$(curl -sS -m 10 -H "Authorization: Bearer $token" \
        "$authentik/api/v3/core/brands/?default=true" \
        | jq -r '.results[0].brand_uuid // .results[0].pk // empty')
    if [ -z "$brand_pk" ]; then
        warn "authentik: couldn't find default brand"
        return 0
    fi
    current=$(curl -sS -m 10 -H "Authorization: Bearer $token" \
        "$authentik/api/v3/core/brands/$brand_pk/")
    new_css=$(echo "$current" | jq -r '.branding_custom_css // ""')
    if [ "$new_css" = "$css" ]; then
        log "authentik: brand CSS already up to date"
        return 0
    fi
    if curl -sS -m 10 -X PATCH "$authentik/api/v3/core/brands/$brand_pk/" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg css "$css" '{branding_custom_css: $css}')" \
        | jq -e '.brand_uuid // .pk' >/dev/null 2>&1; then
        log "authentik: brand CSS applied"
    else
        warn "authentik: PATCH didn't stick"
    fi
}

# ─── Jellyfin ────────────────────────────────────────────────────
apply_jellyfin() {
    local css
    css=$(read_css "jellyfin.css") || return 0
    local jellyfin="https://${HOST_PREFIX}media.${ZONE}"
    local token current new_css
    token=$(security find-generic-password -s rainbow-jellyfin-api-key -w 2>/dev/null || echo "")
    if [ -z "$token" ]; then
        log "jellyfin: API token not yet in Keychain — skipping"
        return 0
    fi
    current=$(curl -sS -m 10 -H "X-Emby-Token: $token" \
        "$jellyfin/Branding/Configuration")
    new_css=$(echo "$current" | jq -r '.CustomCss // ""')
    if [ "$new_css" = "$css" ]; then
        log "jellyfin: brand CSS already up to date"
        return 0
    fi
    local payload
    payload=$(echo "$current" | jq --arg css "$css" '.CustomCss = $css')
    if curl -sS -m 10 -X POST "$jellyfin/System/Configuration/branding" \
        -H "X-Emby-Token: $token" \
        -H "Content-Type: application/json" \
        -d "$payload" -o /dev/null -w '%{http_code}' \
        | grep -qE '^2[0-9][0-9]$'; then
        log "jellyfin: brand CSS applied"
    else
        warn "jellyfin: POST didn't return 2xx"
    fi
}

apply_immich    || warn "immich brand step failed (non-fatal)"
apply_authentik || warn "authentik brand step failed (non-fatal)"
apply_jellyfin  || warn "jellyfin brand step failed (non-fatal)"
