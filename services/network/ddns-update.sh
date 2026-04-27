#!/usr/bin/env bash
#
# ddns-update.sh — Update Cloudflare DNS with the current public IP.
#
# This runs on a schedule (every 5 minutes via launchd) and updates
# a small set of DNS records that need the real IP:
#   - Direct Minecraft access (mc-direct.domain)
#   - SMTP fallback (smtp.domain)
#
# Most services use Cloudflare Tunnel and don't need this.
#
# Usage: ./services/network/ddns-update.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"
STATE_FILE="/tmp/rainbow-ddns-last-ip"

# ─── Load config ─────────────────────────────────────────────────
DOMAIN=$(yq eval '.domain.primary' "$CONFIG_FILE")
ZONE_ID=$(yq eval '.cloudflare.zone_id' "$CONFIG_FILE")
API_TOKEN=$(security find-generic-password -s "rainbow-cloudflare-api-token" -w 2>/dev/null || echo "")

if [ -z "$API_TOKEN" ]; then
    echo "[ddns] ERROR: Cloudflare API token not found in Keychain" >&2
    exit 1
fi

# ─── Get current public IP ──────────────────────────────────────
# Use multiple sources for reliability
get_public_ip() {
    local ip=""
    for url in \
        "https://api.ipify.org" \
        "https://ifconfig.me/ip" \
        "https://icanhazip.com" \
        "https://checkip.amazonaws.com" \
    ; do
        ip=$(curl -s --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]')
        if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "$ip"
            return 0
        fi
    done
    return 1
}

CURRENT_IP=$(get_public_ip) || {
    echo "[ddns] ERROR: Could not determine public IP" >&2
    exit 1
}

# ─── Check if IP changed ────────────────────────────────────────
LAST_IP=""
if [ -f "$STATE_FILE" ]; then
    LAST_IP=$(cat "$STATE_FILE")
fi

if [ "$CURRENT_IP" = "$LAST_IP" ]; then
    # IP hasn't changed, nothing to do
    exit 0
fi

echo "[ddns] IP changed: ${LAST_IP:-unknown} -> $CURRENT_IP"

# ─── Cloudflare API helper ──────────────────────────────────────
cf_api() {
    local method="$1"
    local path="$2"
    shift 2
    curl -s -X "$method" \
        "https://api.cloudflare.com/client/v4$path" \
        -H "Authorization: Bearer $API_TOKEN" \
        -H "Content-Type: application/json" \
        "$@"
}

# ─── Update or create a DNS A record ────────────────────────────
update_record() {
    local name="$1"
    local proxied="${2:-false}"

    # Find existing record
    local record_id
    record_id=$(cf_api GET "/zones/$ZONE_ID/dns_records?type=A&name=$name" | \
        yq eval '.result[0].id // ""' -)

    if [ -n "$record_id" ] && [ "$record_id" != "null" ]; then
        # Update existing
        cf_api PUT "/zones/$ZONE_ID/dns_records/$record_id" \
            -d "{\"type\":\"A\",\"name\":\"$name\",\"content\":\"$CURRENT_IP\",\"proxied\":$proxied,\"ttl\":120}" \
            > /dev/null
        echo "[ddns] Updated $name -> $CURRENT_IP"
    else
        # Create new
        cf_api POST "/zones/$ZONE_ID/dns_records" \
            -d "{\"type\":\"A\",\"name\":\"$name\",\"content\":\"$CURRENT_IP\",\"proxied\":$proxied,\"ttl\":120}" \
            > /dev/null
        echo "[ddns] Created $name -> $CURRENT_IP"
    fi
}

# ─── Update records that need the real IP ────────────────────────

# Minecraft direct connect (unproxied — players connect directly)
MC_ENABLED=$(yq eval '.services.minecraft.enabled // false' "$CONFIG_FILE")
if [ "$MC_ENABLED" = "true" ]; then
    update_record "mc-direct.$DOMAIN" "false"
fi

# SMTP direct (for mail servers that don't support Cloudflare proxy)
STALWART_ENABLED=$(yq eval '.services.stalwart.enabled // false' "$CONFIG_FILE")
if [ "$STALWART_ENABLED" = "true" ]; then
    update_record "smtp.$DOMAIN" "false"
fi

# Save current IP
echo "$CURRENT_IP" > "$STATE_FILE"

echo "[ddns] Update complete"
