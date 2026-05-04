#!/usr/bin/env bash
#
# bootstrap-admin.sh — Create the user's actual admin account in Authentik.
#
# Runs after setup-providers.sh has wired up OIDC clients. Reads:
#   - rainbow.yaml for the user's email + name (collected by the wizard)
#   - rainbow-admin-password from Keychain (the password the user typed)
#   - rainbow-authentik-api-token from Keychain (also AUTHENTIK_BOOTSTRAP_TOKEN
#     so it works on first boot before any human has touched Authentik)
#
# Then via Authentik's API:
#   1. Check if a user with that email already exists (idempotent re-run).
#   2. Create the user with username = email, name, email, active.
#   3. Set their password via the dedicated /set_password/ endpoint
#      (POST users/ doesn't accept passwords directly).
#   4. Add them to the "authentik Admins" group.
#
# At the end, the user can sign in at the dashboard with their email
# and password. akadmin remains as a hidden rescue admin with the
# random rainbow-authentik-bootstrap-password.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"

# ─── Resolve hostnames + identity from config ────────────────────
PREFIX=$(yq eval '.domain.prefix // ""' "$CONFIG_FILE")
ZONE=$(yq eval '.domain.zone' "$CONFIG_FILE")
ADMIN_EMAIL=$(yq eval '.admin.email' "$CONFIG_FILE")
ADMIN_NAME=$(yq eval '.admin.name // ""' "$CONFIG_FILE")
[ "$PREFIX" = "null" ] && PREFIX=""
[ "$ADMIN_NAME" = "null" ] && ADMIN_NAME=""
HOST_PREFIX=""
if [ -n "$PREFIX" ]; then
    HOST_PREFIX="${PREFIX}-"
fi
AUTH_HOST="${HOST_PREFIX}auth.${ZONE}"
AUTHENTIK_URL="https://${AUTH_HOST}"

if [ -z "$ADMIN_EMAIL" ] || [ "$ADMIN_EMAIL" = "null" ]; then
    echo "ERROR: admin.email missing from $CONFIG_FILE" >&2
    exit 1
fi

# ─── Read secrets from Keychain ──────────────────────────────────
TOKEN=$(security find-generic-password -s "rainbow-authentik-api-token" -w 2>/dev/null || echo "")
PASSWORD=$(security find-generic-password -s "rainbow-admin-password" -w 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
    echo "ERROR: rainbow-authentik-api-token not in Keychain. Did setup-providers run first?" >&2
    exit 1
fi
if [ -z "$PASSWORD" ]; then
    echo "ERROR: rainbow-admin-password not in Keychain. Did the wizard's mint-secrets phase run?" >&2
    exit 1
fi

AUTH_HEADER="Authorization: Bearer $TOKEN"

# ─── Sanity check: API reachable + token works ──────────────────
# Retry loop matters here: by the time we run, Authentik has passed
# /-/health/ready/ (wait-authentik phase) and setup-providers has
# succeeded. But restart-web (the previous wizard phase) reloads
# Caddy, and there's a brief window where requests through the
# tunnel get a 502/401 while routes settle. Without retries we
# bail on the first blip even though the system is fine 5s later.
echo "Checking Authentik at $AUTHENTIK_URL..."
me=""
for attempt in $(seq 1 30); do
    me=$(curl -sS -m 8 -H "$AUTH_HEADER" "$AUTHENTIK_URL/api/v3/core/users/me/" \
        | jq -r '.user.username // empty' 2>/dev/null || echo "")
    [ -n "$me" ] && break
    if [ "$attempt" -eq 1 ]; then
        echo "  not ready yet — retrying for up to 60s"
    fi
    sleep 2
done
if [ -z "$me" ]; then
    echo "ERROR: Could not authenticate to Authentik after 60s. Check the token." >&2
    exit 1
fi
echo "  Authenticated as: $me"

# ─── 1. Does a user with this email already exist? ───────────────
existing_pk=$(curl -sS -m 10 -H "$AUTH_HEADER" \
    "$AUTHENTIK_URL/api/v3/core/users/?email=$(printf '%s' "$ADMIN_EMAIL" | jq -sRr @uri)" \
    | jq -r '.results[0].pk // empty')

if [ -n "$existing_pk" ]; then
    echo "  User with email $ADMIN_EMAIL already exists (pk=$existing_pk). Updating password + admin group only."
    user_pk="$existing_pk"
else
    # ─── 2. Create the user ──────────────────────────────────────
    echo "  Creating user $ADMIN_EMAIL..."
    create_body=$(jq -n \
        --arg username "$ADMIN_EMAIL" \
        --arg name "$ADMIN_NAME" \
        --arg email "$ADMIN_EMAIL" \
        '{username: $username, name: $name, email: $email, is_active: true, type: "internal"}')
    user_pk=$(curl -sS -m 15 -X POST \
        -H "$AUTH_HEADER" -H "Content-Type: application/json" \
        --data "$create_body" \
        "$AUTHENTIK_URL/api/v3/core/users/" \
        | jq -r '.pk // empty')
    if [ -z "$user_pk" ]; then
        echo "ERROR: User creation didn't return a pk. Check Authentik logs." >&2
        exit 1
    fi
    echo "  Created (pk=$user_pk)"
fi

# ─── 3. Set the password ─────────────────────────────────────────
# Authentik's user-set-password endpoint takes JSON {"password": "..."}.
# This is a POST, returns 204 on success.
echo "  Setting password..."
pw_body=$(jq -n --arg p "$PASSWORD" '{password: $p}')
pw_status=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' -X POST \
    -H "$AUTH_HEADER" -H "Content-Type: application/json" \
    --data "$pw_body" \
    "$AUTHENTIK_URL/api/v3/core/users/${user_pk}/set_password/")
if [ "$pw_status" != "204" ] && [ "$pw_status" != "200" ]; then
    echo "ERROR: set_password returned HTTP $pw_status" >&2
    exit 1
fi
echo "  Password set"

# ─── 4. Add to "authentik Admins" group ──────────────────────────
admin_group_pk=$(curl -sS -m 10 -H "$AUTH_HEADER" \
    "$AUTHENTIK_URL/api/v3/core/groups/?name=authentik%20Admins" \
    | jq -r '.results[0].pk // empty')
if [ -z "$admin_group_pk" ]; then
    echo "WARN: 'authentik Admins' group not found — user created but not promoted to admin." >&2
    echo "  Promote manually in the Authentik UI."
else
    echo "  Adding to group authentik Admins (pk=$admin_group_pk)..."
    add_status=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' -X POST \
        -H "$AUTH_HEADER" -H "Content-Type: application/json" \
        --data "$(jq -n --arg pk "$user_pk" '{pk: ($pk | tonumber)}')" \
        "$AUTHENTIK_URL/api/v3/core/groups/${admin_group_pk}/add_user/")
    # 204 = added, 400 = already a member
    if [ "$add_status" != "204" ] && [ "$add_status" != "400" ]; then
        echo "WARN: add_user returned HTTP $add_status (continuing)" >&2
    fi
    echo "  Group membership confirmed"
fi

echo
echo "Admin account ready. Sign in at https://${PREFIX:+${PREFIX}.}${ZONE}/ with:"
echo "  Email:    $ADMIN_EMAIL"
echo "  Password: (the one you set in the wizard)"
