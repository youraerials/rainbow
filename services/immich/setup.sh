#!/usr/bin/env bash
#
# setup.sh — Idempotent post-start configuration for Immich.
#
# Bootstraps the admin account from Keychain on first run, then writes the
# OAuth config to Immich's system-config so the "Login with Rainbow" button
# appears without anyone clicking through the admin UI.
#
# Re-running is safe: if the admin already exists, we log in with the same
# password and re-apply the config (PUT is idempotent for the same body).
#
# Required Keychain entries:
#   rainbow-immich-admin-password  — Immich admin password
#   rainbow-oauth-photos-client-id, -client-secret  — produced by
#       services/authentik/setup-providers.sh
#
# Usage: ./services/immich/setup.sh [--quiet]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"

QUIET=false
[ "${1:-}" = "--quiet" ] && QUIET=true

log() { $QUIET || echo "[immich-setup] $*"; }
err() { echo "[immich-setup] $*" >&2; }

# ─── Resolve hostnames + creds ───────────────────────────────────
PREFIX=$(yq eval '.domain.prefix // ""' "$CONFIG_FILE")
ZONE=$(yq eval '.domain.zone' "$CONFIG_FILE")
[ "$PREFIX" = "null" ] && PREFIX=""
HOST_PREFIX=""
[ -n "$PREFIX" ] && HOST_PREFIX="${PREFIX}-"

IMMICH="https://${HOST_PREFIX}photos.${ZONE}/api"
AUTH_HOST="${HOST_PREFIX}auth.${ZONE}"
ISSUER_URL="https://${AUTH_HOST}/application/o/photos/"

ADMIN_EMAIL=$(yq eval '.admin.email' "$CONFIG_FILE")
ADMIN_NAME=$(yq eval '.admin.name // "Rainbow Admin"' "$CONFIG_FILE")
ADMIN_PASSWORD=$(security find-generic-password -s rainbow-immich-admin-password -w 2>/dev/null || echo "")
CLIENT_ID=$(security find-generic-password -s rainbow-oauth-photos-client-id -w 2>/dev/null || echo "")
CLIENT_SECRET=$(security find-generic-password -s rainbow-oauth-photos-client-secret -w 2>/dev/null || echo "")

if [ -z "$ADMIN_PASSWORD" ]; then
    err "Missing Keychain entry rainbow-immich-admin-password — generate one and re-run"
    err "  security add-generic-password -s rainbow-immich-admin-password -a rainbow -w \"\$(openssl rand -hex 24)\""
    exit 1
fi

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
    err "Missing OAuth credentials — run services/authentik/setup-providers.sh first"
    exit 1
fi

# ─── Wait for Immich to be ready ─────────────────────────────────
log "Waiting for Immich at $IMMICH..."
for i in $(seq 1 60); do
    if curl -sS -m 3 "$IMMICH/server/ping" 2>/dev/null | grep -q pong; then
        log "  Immich is up"
        break
    fi
    sleep 2
    if [ "$i" -eq 60 ]; then
        err "Immich didn't respond on /server/ping after 2 min"
        exit 1
    fi
done

# ─── Get an access token (signup-or-login) ───────────────────────
get_token() {
    local body
    body=$(curl -sS -m 10 -X POST "$IMMICH/auth/login" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')")
    echo "$body" | jq -r '.accessToken // empty'
}

TOKEN=$(get_token)
if [ -z "$TOKEN" ]; then
    log "No existing admin — bootstrapping..."
    SIGNUP=$(curl -sS -m 10 -X POST "$IMMICH/auth/admin-sign-up" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
            --arg e "$ADMIN_EMAIL" \
            --arg p "$ADMIN_PASSWORD" \
            --arg n "$ADMIN_NAME" \
            '{email:$e,password:$p,name:$n}')")
    if ! echo "$SIGNUP" | jq -e '.id' >/dev/null 2>&1; then
        err "admin-sign-up failed: $SIGNUP"
        err "If an admin exists with a different password, update Keychain or reset Immich's DB."
        exit 1
    fi
    log "  Admin created: $ADMIN_EMAIL"
    TOKEN=$(get_token)
    if [ -z "$TOKEN" ]; then
        err "Login failed even after signup — something is wrong"
        exit 1
    fi
fi
log "  Logged in as $ADMIN_EMAIL"

# ─── Apply OAuth config ──────────────────────────────────────────
AUTH="Authorization: Bearer $TOKEN"
log "Reading current system-config..."
CURRENT=$(curl -sS -m 10 -H "$AUTH" "$IMMICH/system-config")

NEW=$(echo "$CURRENT" | jq \
    --arg issuer "$ISSUER_URL" \
    --arg cid "$CLIENT_ID" \
    --arg secret "$CLIENT_SECRET" \
    '.oauth.enabled = true
     | .oauth.autoRegister = true
     | .oauth.buttonText = "Login with Rainbow"
     | .oauth.clientId = $cid
     | .oauth.clientSecret = $secret
     | .oauth.issuerUrl = $issuer
     | .oauth.scope = "openid email profile"')

if [ "$CURRENT" = "$NEW" ]; then
    log "  OAuth config already up to date — nothing to write"
else
    log "Writing OAuth config..."
    RESP=$(curl -sS -m 10 -X PUT -H "$AUTH" -H "Content-Type: application/json" \
        "$IMMICH/system-config" -d "$NEW")
    if ! echo "$RESP" | jq -e '.oauth.enabled == true' >/dev/null 2>&1; then
        err "system-config PUT did not stick: $RESP"
        exit 1
    fi
    log "  OAuth enabled. Issuer: $ISSUER_URL"
fi

log "Done. The 'Login with Rainbow' button should appear at https://${HOST_PREFIX}photos.${ZONE}"

# ─── Provision an API key for the rainbow-web MCP tools ──────────
# Stored in Keychain as `rainbow-immich-api-key`. The web tier passes it
# to mcp-photos tools as the `x-api-key` header. We always create a fresh
# key on each run rather than re-using because Immich's API doesn't expose
# the secret of an existing key (only on creation), and we'd rather rotate
# than carry stale state.
log "Provisioning Immich API key for rainbow-web MCP tools..."

# Delete any existing "rainbow-web" keys to keep things tidy.
EXISTING=$(curl -sS -m 10 -H "$AUTH" "$IMMICH/api-keys" \
    | jq -r '.[] | select(.name == "rainbow-web") | .id // empty')
for kid in $EXISTING; do
    curl -sS -m 10 -X DELETE -H "$AUTH" "$IMMICH/api-keys/$kid" >/dev/null
done

# Create a new key. `permissions: ["all"]` is the Immich shortcut for
# every available scope; the tools will use a small subset.
CREATED=$(curl -sS -m 10 -X POST "$IMMICH/api-keys" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"name":"rainbow-web","permissions":["all"]}')
SECRET=$(echo "$CREATED" | jq -r '.secret // empty')
if [ -z "$SECRET" ] || [ "$SECRET" = "null" ]; then
    err "Failed to mint Immich API key: $CREATED"
    exit 1
fi

security add-generic-password -s rainbow-immich-api-key -a rainbow -w "$SECRET" -U
log "  API key stored: rainbow-immich-api-key"
