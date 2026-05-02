#!/usr/bin/env bash
#
# setup.sh — Post-start initializer for Seafile.
#
# The seafile-mc image's default entrypoint (/scripts/enterpoint.sh) only
# starts nginx and then idles. The actual seafile-controller + seahub
# processes only start when /scripts/start.py is run.
#
# This script also self-heals a long-standing seafile-mc bug: when DB_HOST
# is an IP address, setup-seafile-mysql.py creates the seafile mysql user
# with host '%.%.%.%' instead of '%'. That pattern doesn't match the
# seafile container's IP and the user can't log in. We detect and rename.
#
# Idempotent: re-running on a healthy install is a no-op.

set -euo pipefail

CONTAINER=rainbow-seafile
LOG="[seafile-setup]"

log() { echo "$LOG $*"; }
err() { echo "$LOG $*" >&2; }

# ─── Wait for the container to be far enough along ───────────────
log "Waiting for $CONTAINER nginx..."
for _ in $(seq 1 30); do
    if container logs "$CONTAINER" 2>&1 | grep -q "Nginx ready"; then
        log "  Nginx is ready"
        break
    fi
    sleep 2
done

# Public URL — used for fast-path detection AND for the API-token
# provisioning at the end. ZONE may be empty in tests; we guard each use.
HOST_PREFIX="${RAINBOW_HOST_PREFIX:-}"
ZONE="${RAINBOW_ZONE:-}"
PUBLIC_URL="https://${HOST_PREFIX}files.${ZONE}/"

is_serving() {
    [ -n "$ZONE" ] && curl -sS -o /dev/null -m 5 -w '%{http_code}' "$PUBLIC_URL" 2>/dev/null \
        | grep -qE '^(200|302)$'
}

# ─── Fast path: already healthy? Skip the start.py dance. ────────
# The login page rendering is the only reliable signal — sv status often
# lies because start.py runs services as direct children rather than
# installing them under runit.
SEAFILE_ALREADY_SERVING=false
if is_serving; then
    log "  Seafile is already serving — skipping start.py"
    SEAFILE_ALREADY_SERVING=true
fi

# ─── Self-heal the seafile MySQL user host ───────────────────────
# Find MariaDB's IP (its container is on the backend network alongside
# seafile) and try to fix the user host. Skips quietly if the user doesn't
# exist yet (first run, before start.py has tried to create it) — we'll
# come back after start.py runs and (re)apply.
fix_seafile_user_host() {
    local mariadb_ip mdb_pass
    mariadb_ip=$(container inspect rainbow-mariadb 2>/dev/null \
        | yq -p=json '.[0].networks[0].ipv4Address' 2>/dev/null \
        | sed 's|/.*||')
    mdb_pass=$(security find-generic-password -s rainbow-mariadb-root-password -w 2>/dev/null || echo "")
    if [ -z "$mariadb_ip" ] || [ -z "$mdb_pass" ]; then
        return 0
    fi

    # Use the mariadb client image as a one-shot — saves us from depending
    # on a mysql client being installed locally or in the seafile container.
    local out
    out=$(container run --rm --network backend docker.io/library/mariadb:11 \
        mariadb -h "$mariadb_ip" -u root -p"$mdb_pass" \
        -BNe "SELECT Host FROM mysql.user WHERE User='seafile';" 2>&1 || true)
    if echo "$out" | grep -qx '%.%.%.%'; then
        log "  Found broken seafile@%.%.%.% — renaming to seafile@%"
        container run --rm --network backend docker.io/library/mariadb:11 \
            mariadb -h "$mariadb_ip" -u root -p"$mdb_pass" \
            -e "RENAME USER 'seafile'@'%.%.%.%' TO 'seafile'@'%'; FLUSH PRIVILEGES;" \
            >/dev/null 2>&1 || true
    fi
}

# ─── Run start.py auto, with retry-after-fix on Access-denied ────
run_start_auto() {
    container exec "$CONTAINER" python3 /scripts/start.py auto 2>&1
}

if [ "$SEAFILE_ALREADY_SERVING" != "true" ]; then
    log "Running /scripts/start.py auto..."
    fix_seafile_user_host
    output=$(run_start_auto || true)
    if echo "$output" | tail -10 | grep -q 'Successfully'; then
        log "  start.py succeeded"
    elif echo "$output" | grep -qE 'Access denied for user .seafile.'; then
        log "  Access denied for seafile user — fixing host pattern and retrying"
        fix_seafile_user_host
        output=$(run_start_auto || true)
        if ! echo "$output" | tail -10 | grep -q 'Successfully\|Done'; then
            err "start.py still failing after host fix:"
            echo "$output" | tail -15 >&2
            exit 1
        fi
    else
        # No clear success signal but no access-denied either. Verify by hitting
        # the login page; if that works, call it good.
        if is_serving; then
            log "  Seafile responding — assuming success"
        else
            err "start.py exited without clear success and seafile is not reachable:"
            echo "$output" | tail -15 >&2
            exit 1
        fi
    fi
fi

log "Done. Seafile is reachable at $PUBLIC_URL"

# ─── Provision a Seafile API token for the rainbow-web MCP tools ─
# Stored in Keychain as `rainbow-seafile-api-token`. The web tier passes
# it to mcp-files tools as the `Authorization: Token <token>` header.
if [ -n "$ZONE" ]; then
    SEAFILE_EMAIL="${RAINBOW_ADMIN_EMAIL:-}"
    if [ -z "$SEAFILE_EMAIL" ]; then
        SEAFILE_EMAIL=$(yq eval '.admin.email' "$(dirname "$0")/../../config/rainbow.yaml" 2>/dev/null || echo "")
    fi
    SEAFILE_PASSWORD=$(security find-generic-password -s rainbow-seafile-admin-password -w 2>/dev/null || echo "")
    if [ -n "$SEAFILE_EMAIL" ] && [ -n "$SEAFILE_PASSWORD" ]; then
        log "Provisioning Seafile API token..."
        TOKEN_RESP=$(curl -sS -m 10 -X POST "${PUBLIC_URL}api2/auth-token/" \
            -H "Content-Type: application/x-www-form-urlencoded" \
            --data-urlencode "username=${SEAFILE_EMAIL}" \
            --data-urlencode "password=${SEAFILE_PASSWORD}")
        TOKEN=$(echo "$TOKEN_RESP" | yq -p=json '.token // ""' 2>/dev/null)
        if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
            security add-generic-password -s rainbow-seafile-api-token -a rainbow -w "$TOKEN" -U
            log "  API token stored: rainbow-seafile-api-token"
        else
            err "  Failed to obtain Seafile API token: $TOKEN_RESP"
        fi
    else
        err "  Skipping Seafile API token: missing email or password"
    fi
fi
