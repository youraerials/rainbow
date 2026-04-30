#!/usr/bin/env bash
#
# setup-providers.sh — Create OAuth2 providers + applications in Authentik for
# the Rainbow services that support OIDC. Resulting client_id/client_secret are
# stored in macOS Keychain so generate-config.sh can wire them into each
# service's config.
#
# Idempotent: re-running fetches existing provider credentials instead of
# re-creating.
#
# Prerequisites:
#   1. Authentik is running and reachable at https://<prefix>-auth.<zone>
#   2. You've created an API token in Authentik:
#        Directory → Tokens & App passwords → Create
#          Identifier: rainbow-setup
#          User: akadmin
#          Intent: API Token
#        and stored it in Keychain:
#        security add-generic-password -s rainbow-authentik-api-token -a rainbow -w '<token>'
#
# Usage: ./services/authentik/setup-providers.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"

# ─── Resolve hostnames from config ───────────────────────────────
PREFIX=$(yq eval '.domain.prefix // ""' "$CONFIG_FILE")
ZONE=$(yq eval '.domain.zone' "$CONFIG_FILE")
[ "$PREFIX" = "null" ] && PREFIX=""
HOST_PREFIX=""
[ -n "$PREFIX" ] && HOST_PREFIX="${PREFIX}-"

AUTH_HOST="${HOST_PREFIX}auth.${ZONE}"
AUTHENTIK_URL="https://${AUTH_HOST}"

# ─── Read API token from Keychain ────────────────────────────────
TOKEN=$(security find-generic-password -s "rainbow-authentik-api-token" -w 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
    cat >&2 <<EOF
ERROR: Authentik API token not in Keychain.

Create one in the Authentik UI at https://${AUTH_HOST}/if/admin/:
  Directory → Tokens & App passwords → Create
    Identifier: rainbow-setup
    User: akadmin
    Intent: API Token

Then store it:
  security add-generic-password -s rainbow-authentik-api-token -a rainbow -w '<paste-token>'

Then re-run this script.
EOF
    exit 1
fi

AUTH_HEADER="Authorization: Bearer $TOKEN"

# ─── Sanity check: API reachable ─────────────────────────────────
echo "Checking Authentik at $AUTHENTIK_URL..."
me=$(curl -sS -m 10 -H "$AUTH_HEADER" "$AUTHENTIK_URL/api/v3/core/users/me/" \
    | jq -r '.user.username // empty' 2>/dev/null || echo "")
if [ -z "$me" ]; then
    echo "ERROR: Could not authenticate to Authentik. Check the token." >&2
    exit 1
fi
echo "  Authenticated as: $me"

# ─── Helpers ─────────────────────────────────────────────────────

# Look up the default authorization flow's PK by slug. Authentik ships this flow
# preconfigured: it issues an authorization code with implicit (no-prompt) consent.
auth_flow_pk() {
    curl -sS -m 10 -H "$AUTH_HEADER" \
        "$AUTHENTIK_URL/api/v3/flows/instances/?slug=default-provider-authorization-implicit-consent" \
        | jq -r '.results[0].pk'
}

# Authentik 2024.10+ requires an explicit invalidation (logout) flow on every
# OAuth2 provider. The default ships under this slug.
invalidation_flow_pk() {
    curl -sS -m 10 -H "$AUTH_HEADER" \
        "$AUTHENTIK_URL/api/v3/flows/instances/?slug=default-provider-invalidation-flow" \
        | jq -r '.results[0].pk'
}

# Default self-signed cert ships with Authentik. Used to sign id_tokens with
# RS256 — without a signing_key, Authentik falls back to HS256, which most
# OIDC clients (Immich's oauth4webapi, etc.) reject as too weak.
signing_cert_pk() {
    curl -sS -m 10 -H "$AUTH_HEADER" \
        "$AUTHENTIK_URL/api/v3/crypto/certificatekeypairs/?name=authentik%20Self-signed%20Certificate" \
        | jq -r '.results[0].pk'
}

# Get the PKs of the default openid/email/profile scope mappings, looked up by
# their stable `managed` slugs. Without these attached, Authentik returns
# `insufficient_scope` from the userinfo endpoint, breaking OIDC clients that
# expect standard claims.
oidc_scope_mapping_pks() {
    curl -sS -m 10 -H "$AUTH_HEADER" \
        "$AUTHENTIK_URL/api/v3/propertymappings/provider/scope/" \
        | jq -r '[
            .results[]
            | select(.managed == "goauthentik.io/providers/oauth2/scope-openid"
                  or .managed == "goauthentik.io/providers/oauth2/scope-email"
                  or .managed == "goauthentik.io/providers/oauth2/scope-profile")
            | .pk
          ]'
}

# Find an existing OAuth2 provider by name. Echoes its PK or empty string.
find_provider() {
    local name="$1"
    curl -sS -m 10 -H "$AUTH_HEADER" \
        "$AUTHENTIK_URL/api/v3/providers/oauth2/?name=$(jq -rn --arg n "$name" '$n|@uri')" \
        | jq -r '.results[0].pk // empty'
}

# Build the redirect_uris JSON array from a newline-separated URI list.
# Authentik 2024.10+ expects an array of {matching_mode, url} objects, not the
# legacy single-string-with-newlines format.
redirect_uris_json() {
    local uris="$1"
    echo "$uris" | jq -R --slurp '
        split("\n")
        | map(select(. != ""))
        | map({matching_mode: "strict", url: .})
    '
}

# Create or fetch an OAuth2 provider, then create or fetch its Application.
# Stores credentials in Keychain. Args: <slug> <display-name> <redirect-uris>
configure_provider() {
    local slug="$1"
    local display="$2"
    local redirect_uris="$3"
    local provider_name="Rainbow $display"

    echo ""
    echo "Configuring: $display ($slug)"

    local flow_pk inv_flow_pk cert_pk scope_pks
    flow_pk=$(auth_flow_pk)
    inv_flow_pk=$(invalidation_flow_pk)
    cert_pk=$(signing_cert_pk)
    scope_pks=$(oidc_scope_mapping_pks)
    if [ -z "$flow_pk" ] || [ "$flow_pk" = "null" ]; then
        echo "  ERROR: default authorization flow not found" >&2
        return 1
    fi
    if [ -z "$inv_flow_pk" ] || [ "$inv_flow_pk" = "null" ]; then
        echo "  ERROR: default invalidation flow not found" >&2
        return 1
    fi
    if [ -z "$cert_pk" ] || [ "$cert_pk" = "null" ]; then
        echo "  ERROR: default signing certificate not found" >&2
        return 1
    fi
    if [ "$(echo "$scope_pks" | jq 'length')" -lt 3 ]; then
        echo "  ERROR: default OIDC scope mappings not found" >&2
        return 1
    fi

    local uris_json
    uris_json=$(redirect_uris_json "$redirect_uris")

    local provider_pk
    provider_pk=$(find_provider "$provider_name")
    if [ -n "$provider_pk" ]; then
        echo "  Provider exists (pk=$provider_pk) — updating fields"
        curl -sS -m 10 -H "$AUTH_HEADER" -H "Content-Type: application/json" \
            -X PATCH "$AUTHENTIK_URL/api/v3/providers/oauth2/$provider_pk/" \
            -d "$(jq -n \
                --argjson uris "$uris_json" \
                --arg cert "$cert_pk" \
                --argjson scopes "$scope_pks" \
                '{
                    redirect_uris: $uris,
                    signing_key: $cert,
                    signature_alg: "RS256",
                    property_mappings: $scopes
                }')" >/dev/null
    else
        echo "  Creating provider..."
        provider_pk=$(curl -sS -m 10 -H "$AUTH_HEADER" -H "Content-Type: application/json" \
            -X POST "$AUTHENTIK_URL/api/v3/providers/oauth2/" \
            -d "$(jq -n \
                --arg name "$provider_name" \
                --arg flow "$flow_pk" \
                --arg inv_flow "$inv_flow_pk" \
                --arg cert "$cert_pk" \
                --argjson uris "$uris_json" \
                --argjson scopes "$scope_pks" \
                '{
                    name: $name,
                    authorization_flow: $flow,
                    invalidation_flow: $inv_flow,
                    signing_key: $cert,
                    signature_alg: "RS256",
                    client_type: "confidential",
                    redirect_uris: $uris,
                    property_mappings: $scopes,
                    sub_mode: "hashed_user_id",
                    include_claims_in_id_token: true,
                    issuer_mode: "per_provider"
                }')" \
            | jq -r '.pk')
        if [ -z "$provider_pk" ] || [ "$provider_pk" = "null" ]; then
            echo "  ERROR: failed to create provider" >&2
            return 1
        fi
        echo "  Created provider pk=$provider_pk"
    fi

    # Fetch credentials
    local resp client_id client_secret
    resp=$(curl -sS -m 10 -H "$AUTH_HEADER" "$AUTHENTIK_URL/api/v3/providers/oauth2/$provider_pk/")
    client_id=$(echo "$resp" | jq -r '.client_id')
    client_secret=$(echo "$resp" | jq -r '.client_secret')

    # Create application if missing
    local app_pk
    app_pk=$(curl -sS -m 10 -H "$AUTH_HEADER" \
        "$AUTHENTIK_URL/api/v3/core/applications/?slug=$slug" \
        | jq -r '.results[0].pk // empty')
    if [ -z "$app_pk" ]; then
        echo "  Creating application..."
        curl -sS -m 10 -H "$AUTH_HEADER" -H "Content-Type: application/json" \
            -X POST "$AUTHENTIK_URL/api/v3/core/applications/" \
            -d "$(jq -n \
                --arg name "$display" \
                --arg slug "$slug" \
                --argjson provider "$provider_pk" \
                --arg launch "https://${HOST_PREFIX}${slug}.${ZONE}" \
                '{
                    name: $name,
                    slug: $slug,
                    provider: $provider,
                    meta_launch_url: $launch,
                    policy_engine_mode: "any",
                    open_in_new_tab: false
                }')" >/dev/null
    else
        echo "  Application exists (pk=$app_pk)"
    fi

    # Stash in Keychain (-U updates if entry exists)
    security add-generic-password -s "rainbow-oauth-${slug}-client-id" -a rainbow -w "$client_id" -U
    security add-generic-password -s "rainbow-oauth-${slug}-client-secret" -a rainbow -w "$client_secret" -U
    echo "  Credentials stored: rainbow-oauth-${slug}-client-id / -client-secret"
}

# ─── Configure providers for each service ────────────────────────

# Photos (Immich): Immich's OIDC config uses the issuer URL plus its own
# /auth/login callback. Two redirect URIs cover both first login and
# user settings re-link.
configure_provider "photos" "Photos" \
    "https://${HOST_PREFIX}photos.${ZONE}/auth/login
https://${HOST_PREFIX}photos.${ZONE}/user-settings"

# Files (Seafile): standard Seahub OAuth callback path.
configure_provider "files" "Files" \
    "https://${HOST_PREFIX}files.${ZONE}/oauth/callback/"

echo ""
echo "Done. Next steps:"
echo "  1. make config            # render service .env files with the credentials"
echo "  2. make stop && make start  # restart so backends pick up the new env"
