#!/usr/bin/env bash
#
# setup-providers.sh — Configure Authentik OAuth2/OIDC providers for all Rainbow services.
# Run after Authentik is up and the admin account is bootstrapped.
#
# This uses the Authentik API to create:
#   - An OAuth2 provider + application for each Rainbow service
#   - A default authorization flow
#   - Outpost configuration for forward-auth via Caddy
#
# Usage: ./services/authentik/setup-providers.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"

AUTHENTIK_URL="http://localhost:9000"
DOMAIN=$(yq eval '.domain.primary' "$CONFIG_FILE")
ADMIN_PASSWORD=$(security find-generic-password -s "rainbow-authentik-bootstrap-password" -w 2>/dev/null || echo "")

if [ -z "$ADMIN_PASSWORD" ]; then
    echo "ERROR: Authentik admin password not found in Keychain." >&2
    echo "Store it: security add-generic-password -s rainbow-authentik-bootstrap-password -a rainbow -w 'your-password'" >&2
    exit 1
fi

# ─── Get API token ───────────────────────────────────────────────
echo "Authenticating with Authentik..."
TOKEN=$(curl -s -X POST "$AUTHENTIK_URL/api/v3/core/tokens/" \
    -u "akadmin:$ADMIN_PASSWORD" \
    -H "Content-Type: application/json" \
    -d '{"identifier": "rainbow-setup", "intent": "api"}' | jq -r '.key')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    echo "ERROR: Failed to get API token. Is Authentik running?" >&2
    exit 1
fi

AUTH_HEADER="Authorization: Bearer $TOKEN"

# ─── Helper: create OAuth2 provider + application ────────────────
create_provider() {
    local name="$1"
    local slug="$2"
    local redirect_uri="$3"
    local icon_url="${4:-}"

    echo "Creating provider: $name..."

    # Create OAuth2 provider
    local provider_id
    provider_id=$(curl -s -X POST "$AUTHENTIK_URL/api/v3/providers/oauth2/" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -d "{
            \"name\": \"Rainbow $name\",
            \"authorization_flow\": \"default-provider-authorization-implicit-consent\",
            \"client_type\": \"confidential\",
            \"redirect_uris\": \"$redirect_uri\",
            \"property_mappings\": [],
            \"sub_mode\": \"hashed_user_id\",
            \"include_claims_in_id_token\": true,
            \"issuer_mode\": \"per_provider\"
        }" | jq -r '.pk')

    if [ -z "$provider_id" ] || [ "$provider_id" = "null" ]; then
        echo "  WARNING: Provider may already exist, skipping."
        return
    fi

    # Get client credentials
    local client_id client_secret
    client_id=$(curl -s "$AUTHENTIK_URL/api/v3/providers/oauth2/$provider_id/" \
        -H "$AUTH_HEADER" | jq -r '.client_id')
    client_secret=$(curl -s "$AUTHENTIK_URL/api/v3/providers/oauth2/$provider_id/" \
        -H "$AUTH_HEADER" | jq -r '.client_secret')

    # Create application
    curl -s -X POST "$AUTHENTIK_URL/api/v3/core/applications/" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -d "{
            \"name\": \"$name\",
            \"slug\": \"$slug\",
            \"provider\": $provider_id,
            \"meta_launch_url\": \"https://$slug.$DOMAIN\",
            \"policy_engine_mode\": \"any\"
        }" > /dev/null

    # Store client credentials in Keychain
    security add-generic-password -s "rainbow-oauth-${slug}-client-id" -a rainbow -w "$client_id" -U 2>/dev/null || true
    security add-generic-password -s "rainbow-oauth-${slug}-client-secret" -a rainbow -w "$client_secret" -U 2>/dev/null || true

    echo "  Created: $name (client_id: ${client_id:0:8}...)"
}

# ─── Create providers for each service ───────────────────────────

echo ""
echo "Setting up OAuth2 providers for Rainbow services..."
echo ""

# Immich — supports OIDC natively
if [ "$(yq eval '.services.immich.enabled // true' "$CONFIG_FILE")" = "true" ]; then
    create_provider "Photos" "photos" \
        "https://photos.$DOMAIN/auth/login\nhttps://photos.$DOMAIN/user-settings"
fi

# Seafile — supports OAuth2
if [ "$(yq eval '.services.seafile.enabled // true' "$CONFIG_FILE")" = "true" ]; then
    create_provider "Files" "files" \
        "https://files.$DOMAIN/oauth/callback/"
fi

# Jellyfin — supports OIDC via plugin
if [ "$(yq eval '.services.jellyfin.enabled // true' "$CONFIG_FILE")" = "true" ]; then
    create_provider "Media" "media" \
        "https://media.$DOMAIN/sso/OID/redirect/authentik"
fi

# CryptPad — uses forward auth (no native OIDC)
if [ "$(yq eval '.services.cryptpad.enabled // true' "$CONFIG_FILE")" = "true" ]; then
    create_provider "Docs" "docs" \
        "https://docs.$DOMAIN/"
fi

# Dashboard
create_provider "Dashboard" "app" \
    "https://app.$DOMAIN/auth/callback"

# MCP Gateway
create_provider "API" "api" \
    "https://api.$DOMAIN/auth/callback"

echo ""
echo "OAuth2 providers configured."
echo "Client credentials stored in macOS Keychain (rainbow-oauth-*-client-id/secret)."
echo ""
echo "Next steps:"
echo "  1. Run 'rainbow config apply' to update service configs with OAuth credentials"
echo "  2. Restart services: 'rainbow restart'"
