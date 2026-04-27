#!/usr/bin/env bash
#
# setup-dns.sh — Create all required DNS records for email in Cloudflare.
#
# Creates:
#   - MX record:     domain -> mail.domain (priority 10)
#   - SPF record:    TXT on domain
#   - DKIM record:   TXT on rainbow._domainkey.domain
#   - DMARC record:  TXT on _dmarc.domain
#   - Autodiscover:  CNAME for mail client autoconfiguration
#
# These are created via the Cloudflare API using the token already
# stored in the user's Keychain.
#
# Usage: ./services/stalwart/setup-dns.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"

DOMAIN=$(yq eval '.domain.primary' "$CONFIG_FILE")
ZONE_ID=$(yq eval '.cloudflare.zone_id' "$CONFIG_FILE")
API_TOKEN=$(security find-generic-password -s "rainbow-cloudflare-api-token" -w 2>/dev/null || echo "")
STALWART_DATA=$(yq eval '.services.stalwart.data_path // "/opt/rainbow/stalwart"' "$CONFIG_FILE")

if [ -z "$API_TOKEN" ]; then
    echo "ERROR: Cloudflare API token not found in Keychain." >&2
    echo "Store it: security add-generic-password -s rainbow-cloudflare-api-token -a rainbow -w 'your-token'" >&2
    exit 1
fi

if [ -z "$ZONE_ID" ] || [ "$ZONE_ID" = "null" ]; then
    echo "ERROR: Cloudflare zone_id not set in rainbow.yaml" >&2
    exit 1
fi

# ─── Cloudflare API helpers ──────────────────────────────────────
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

# Create or update a DNS record. Skips if an identical record exists.
ensure_record() {
    local type="$1"
    local name="$2"
    local content="$3"
    local priority="${4:-}"
    local proxied="${5:-false}"

    # Check if record already exists
    local existing
    existing=$(cf_api GET "/zones/$ZONE_ID/dns_records?type=$type&name=$name")
    local existing_id
    existing_id=$(echo "$existing" | yq eval '.result[0].id // ""' -)
    local existing_content
    existing_content=$(echo "$existing" | yq eval '.result[0].content // ""' -)

    if [ -n "$existing_id" ] && [ "$existing_id" != "null" ]; then
        if [ "$existing_content" = "$content" ]; then
            echo "  [skip] $type $name (already exists)"
            return
        fi
        # Update existing record
        local data="{\"type\":\"$type\",\"name\":\"$name\",\"content\":\"$content\",\"proxied\":$proxied,\"ttl\":1"
        if [ -n "$priority" ]; then
            data="$data,\"priority\":$priority"
        fi
        data="$data}"

        cf_api PUT "/zones/$ZONE_ID/dns_records/$existing_id" -d "$data" > /dev/null
        echo "  [update] $type $name -> $content"
    else
        # Create new record
        local data="{\"type\":\"$type\",\"name\":\"$name\",\"content\":\"$content\",\"proxied\":$proxied,\"ttl\":1"
        if [ -n "$priority" ]; then
            data="$data,\"priority\":$priority"
        fi
        data="$data}"

        local result
        result=$(cf_api POST "/zones/$ZONE_ID/dns_records" -d "$data")
        local success
        success=$(echo "$result" | yq eval '.success' -)

        if [ "$success" = "true" ]; then
            echo "  [create] $type $name -> $content"
        else
            local error_msg
            error_msg=$(echo "$result" | yq eval '.errors[0].message // "unknown error"' -)
            echo "  [error] $type $name: $error_msg"
        fi
    fi
}

# ─── Read DKIM public key ───────────────────────────────────────
DKIM_PUB_FILE="$STALWART_DATA/dkim/$DOMAIN.pub"
DKIM_PUB=""
if [ -f "$DKIM_PUB_FILE" ]; then
    DKIM_PUB=$(grep -v "^-" "$DKIM_PUB_FILE" | tr -d '\n')
fi

# ─── Create DNS records ─────────────────────────────────────────
echo "Setting up email DNS records for $DOMAIN..."
echo ""

# MX record — tells other mail servers where to deliver mail
ensure_record "MX" "$DOMAIN" "mail.$DOMAIN" "10"

# SPF — declares which servers are allowed to send mail for this domain
ensure_record "TXT" "$DOMAIN" "v=spf1 mx a include:_spf.mx.cloudflare.net ~all"

# DKIM — cryptographic signature proving mail came from this server
if [ -n "$DKIM_PUB" ]; then
    ensure_record "TXT" "rainbow._domainkey.$DOMAIN" "v=DKIM1; k=rsa; p=$DKIM_PUB"
else
    echo "  [skip] DKIM: No key found. Run 'services/stalwart/configure.sh' first to generate DKIM keys."
fi

# DMARC — policy for handling mail that fails SPF/DKIM checks
ensure_record "TXT" "_dmarc.$DOMAIN" "v=DMARC1; p=quarantine; rua=mailto:postmaster@$DOMAIN; fo=1"

# Autodiscover/Autoconfig — helps mail clients find server settings automatically
# Thunderbird
ensure_record "CNAME" "autoconfig.$DOMAIN" "mail.$DOMAIN" "" "true"
# Outlook
ensure_record "CNAME" "autodiscover.$DOMAIN" "mail.$DOMAIN" "" "true"
# SRV records for standard mail client auto-discovery
ensure_record "SRV" "_imaps._tcp.$DOMAIN" "0 1 993 mail.$DOMAIN" "0"
ensure_record "SRV" "_submission._tcp.$DOMAIN" "0 1 587 mail.$DOMAIN" "0"

echo ""
echo "Email DNS setup complete."
echo ""
echo "Verify with:"
echo "  dig MX $DOMAIN"
echo "  dig TXT $DOMAIN"
echo "  dig TXT rainbow._domainkey.$DOMAIN"
echo "  dig TXT _dmarc.$DOMAIN"
echo ""
echo "Test deliverability at: https://www.mail-tester.com"
