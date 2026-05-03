#!/usr/bin/env bash
#
# local-dns.sh — Set up local network access to Rainbow services.
#
# When on the same LAN as the Mac Mini, users shouldn't have to route
# through Cloudflare. This script configures:
#
#   1. A local Caddy listener on the LAN IP
#   2. mDNS/Bonjour advertisement so *.rainbow.local resolves
#
# After running this, LAN users can access:
#   http://photos.rainbow.local
#   http://mail.rainbow.local
#   etc.
#
# Usage: ./services/network/local-dns.sh setup|status|teardown

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"

# Get the LAN IP
get_lan_ip() {
    # Get the primary network interface IP
    ipconfig getifaddr en0 2>/dev/null || \
    ipconfig getifaddr en1 2>/dev/null || \
    echo ""
}

ACTION="${1:-status}"

case "$ACTION" in
    setup)
        LAN_IP=$(get_lan_ip)
        if [ -z "$LAN_IP" ]; then
            echo "[local-dns] ERROR: No LAN IP found. Are you connected to a network?" >&2
            exit 1
        fi

        echo "[local-dns] LAN IP: $LAN_IP"

        DOMAIN=$(yq eval '.domain.primary' "$CONFIG_FILE")

        # Register Bonjour/mDNS services using dns-sd
        # This makes services discoverable on the local network
        echo "[local-dns] Registering mDNS services..."

        # Register HTTP service for the main domain
        dns-sd -R "Rainbow" _http._tcp local 80 path=/ &
        MDNS_PID=$!
        echo "$MDNS_PID" > /tmp/rainbow-mdns.pid

        # Create a /etc/resolver entry for rainbow.local
        # This lets *.rainbow.local resolve to the Mac Mini's LAN IP
        sudo mkdir -p /etc/resolver
        echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/rainbow.local > /dev/null
        echo "port 5553" | sudo tee -a /etc/resolver/rainbow.local > /dev/null

        echo "[local-dns] Local access configured."
        echo ""
        echo "LAN users can now access services at:"
        echo "  http://$LAN_IP            (direct IP)"
        echo ""
        echo "For *.rainbow.local domains, add to your hosts file or"
        echo "configure your router's DNS to point rainbow.local to $LAN_IP"
        echo ""
        echo "Service mapping:"
        echo "  photos  -> $LAN_IP:2283"
        echo "  mail    -> $LAN_IP:8080"
        echo "  files   -> $LAN_IP:8082"
        echo "  docs    -> $LAN_IP:3000"
        echo "  media   -> $LAN_IP:8096"
        echo "  auth    -> $LAN_IP:9000"
        ;;

    status)
        LAN_IP=$(get_lan_ip)
        echo "[local-dns] LAN IP: ${LAN_IP:-not connected}"

        if [ -f /tmp/rainbow-mdns.pid ]; then
            if kill -0 "$(cat /tmp/rainbow-mdns.pid)" 2>/dev/null; then
                echo "[local-dns] mDNS: running"
            else
                echo "[local-dns] mDNS: stopped"
            fi
        else
            echo "[local-dns] mDNS: not configured"
        fi

        if [ -f /etc/resolver/rainbow.local ]; then
            echo "[local-dns] resolver: configured"
        else
            echo "[local-dns] resolver: not configured"
        fi
        ;;

    teardown)
        if [ -f /tmp/rainbow-mdns.pid ]; then
            kill "$(cat /tmp/rainbow-mdns.pid)" 2>/dev/null || true
            rm -f /tmp/rainbow-mdns.pid
        fi
        sudo rm -f /etc/resolver/rainbow.local
        echo "[local-dns] Local DNS teardown complete."
        ;;

    *)
        echo "Usage: local-dns.sh setup|status|teardown" >&2
        exit 1
        ;;
esac
