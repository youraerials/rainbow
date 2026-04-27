#!/usr/bin/env bash
#
# configure.sh — Generate Stalwart configuration from rainbow.yaml.
#
# Usage: ./services/stalwart/configure.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"
TEMPLATE="$PROJECT_ROOT/config/templates/stalwart/config.toml.j2"

DOMAIN=$(yq eval '.domain.primary' "$CONFIG_FILE")
STALWART_DATA=$(yq eval '.services.stalwart.data_path // "/opt/rainbow/stalwart"' "$CONFIG_FILE")
ADMIN_PASSWORD=$(security find-generic-password -s "rainbow-stalwart-admin-password" -w 2>/dev/null || echo "changeme")

OUTPUT="$STALWART_DATA/etc/config.toml"
mkdir -p "$(dirname "$OUTPUT")"

echo "Generating Stalwart config: $OUTPUT"

cp "$TEMPLATE" "$OUTPUT"
sed -i '' "s|{{RAINBOW_DOMAIN}}|$DOMAIN|g" "$OUTPUT"
sed -i '' "s|{{STALWART_DATA_PATH}}|$STALWART_DATA|g" "$OUTPUT"
sed -i '' "s|{{STALWART_ADMIN_PASSWORD}}|$ADMIN_PASSWORD|g" "$OUTPUT"

# Generate DKIM key if it doesn't exist
DKIM_DIR="$STALWART_DATA/dkim"
if [ ! -f "$DKIM_DIR/$DOMAIN.key" ]; then
    echo "Generating DKIM key for $DOMAIN..."
    mkdir -p "$DKIM_DIR"
    openssl genrsa -out "$DKIM_DIR/$DOMAIN.key" 2048 2>/dev/null
    openssl rsa -in "$DKIM_DIR/$DOMAIN.key" -pubout -out "$DKIM_DIR/$DOMAIN.pub" 2>/dev/null

    # Extract the public key for DNS
    DKIM_PUB=$(grep -v "^-" "$DKIM_DIR/$DOMAIN.pub" | tr -d '\n')
    echo ""
    echo "DKIM DNS record (add as TXT record for 'rainbow._domainkey.$DOMAIN'):"
    echo "  v=DKIM1; k=rsa; p=$DKIM_PUB"
    echo ""
fi

echo "Stalwart configuration generated."

# Print DNS records needed
echo ""
echo "Required DNS records for $DOMAIN:"
echo ""
echo "  MX record:"
echo "    $DOMAIN -> mail.$DOMAIN (priority 10)"
echo ""
echo "  SPF record (TXT on $DOMAIN):"
echo "    v=spf1 a mx include:_spf.$DOMAIN ~all"
echo ""
echo "  DMARC record (TXT on _dmarc.$DOMAIN):"
echo "    v=DMARC1; p=quarantine; rua=mailto:postmaster@$DOMAIN"
echo ""
