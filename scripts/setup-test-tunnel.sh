#!/usr/bin/env bash
#
# setup-test-tunnel.sh — Set up a Cloudflare Tunnel for testing Rainbow.
#
# Walks through:
#   1. cloudflared login (browser cert flow)
#   2. Create a named tunnel (default: rainbow-test)
#   3. Store the tunnel token in macOS Keychain
#   4. Create DNS routes for each Rainbow subdomain (photos.<sub>, mail.<sub>, ...)
#   5. Update config/rainbow.yaml with the test subdomain
#
# Idempotent: re-running with the same tunnel name reuses the existing tunnel.
#
# Usage:
#   ./scripts/setup-test-tunnel.sh                       # uses test.rainbow.rocks
#   ./scripts/setup-test-tunnel.sh --subdomain dev       # uses dev.rainbow.rocks
#   ./scripts/setup-test-tunnel.sh --tunnel my-tunnel    # custom tunnel name
#   ./scripts/setup-test-tunnel.sh --domain example.com  # bring your own domain

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"

# ─── Defaults ────────────────────────────────────────────────────
SUBDOMAIN="test"
ROOT_DOMAIN="rainbow.rocks"
TUNNEL_NAME="rainbow-test"
CUSTOM_DOMAIN=""

# ─── Parse args ──────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --subdomain)  SUBDOMAIN="$2"; shift 2 ;;
        --tunnel)     TUNNEL_NAME="$2"; shift 2 ;;
        --domain)     CUSTOM_DOMAIN="$2"; shift 2 ;;
        --help|-h)
            sed -n '1,/^set -/p' "$0" | sed 's/^# \?//' | head -n -1
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

if [ -n "$CUSTOM_DOMAIN" ]; then
    PRIMARY_DOMAIN="$CUSTOM_DOMAIN"
else
    PRIMARY_DOMAIN="$SUBDOMAIN.$ROOT_DOMAIN"
fi

# ─── Colors ──────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[setup]${NC} $*"; }
info() { echo -e "${BLUE}[setup]${NC} $*"; }
warn() { echo -e "${YELLOW}[setup]${NC} $*"; }
err()  { echo -e "${RED}[setup]${NC} $*" >&2; }

# ─── Dependency checks ───────────────────────────────────────────
for cmd in cloudflared yq security; do
    if ! command -v "$cmd" &>/dev/null; then
        err "$cmd not found. Run: make install"
        exit 1
    fi
done

info "Setting up test tunnel for: $PRIMARY_DOMAIN"
info "Tunnel name: $TUNNEL_NAME"
echo ""

# ─── Step 1: cloudflared login ───────────────────────────────────
CERT_PATH="$HOME/.cloudflared/cert.pem"
if [ ! -f "$CERT_PATH" ]; then
    info "You need to log in to Cloudflare. A browser will open."
    info "Pick the zone for $PRIMARY_DOMAIN (or its parent zone) when prompted."
    cloudflared tunnel login
else
    ok "Cloudflare cert already present at $CERT_PATH"
fi

# ─── Step 2: Create or reuse tunnel ──────────────────────────────
TUNNEL_ID=$(cloudflared tunnel list -o json 2>/dev/null \
    | yq eval ".[] | select(.name == \"$TUNNEL_NAME\") | .id" - \
    | head -n1)

if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
    ok "Tunnel '$TUNNEL_NAME' already exists (id: $TUNNEL_ID)"
else
    info "Creating tunnel '$TUNNEL_NAME'..."
    cloudflared tunnel create "$TUNNEL_NAME"
    TUNNEL_ID=$(cloudflared tunnel list -o json 2>/dev/null \
        | yq eval ".[] | select(.name == \"$TUNNEL_NAME\") | .id" - \
        | head -n1)
    if [ -z "$TUNNEL_ID" ] || [ "$TUNNEL_ID" = "null" ]; then
        err "Tunnel created but couldn't read its ID. Check 'cloudflared tunnel list'."
        exit 1
    fi
    ok "Created tunnel: $TUNNEL_ID"
fi

# ─── Step 3: Get tunnel token, store in Keychain ─────────────────
info "Fetching tunnel token..."
TUNNEL_TOKEN=$(cloudflared tunnel token "$TUNNEL_ID" 2>/dev/null || echo "")
if [ -z "$TUNNEL_TOKEN" ]; then
    err "Failed to retrieve tunnel token. Try: cloudflared tunnel token $TUNNEL_ID"
    exit 1
fi

security delete-generic-password -s "rainbow-cloudflare-tunnel-token" -a rainbow &>/dev/null || true
security add-generic-password \
    -s "rainbow-cloudflare-tunnel-token" \
    -a rainbow \
    -w "$TUNNEL_TOKEN"
ok "Tunnel token stored in Keychain (rainbow-cloudflare-tunnel-token)"

# ─── Step 4: Create DNS routes for each service subdomain ────────
SERVICE_HOSTS=(
    "$PRIMARY_DOMAIN"
    "photos.$PRIMARY_DOMAIN"
    "mail.$PRIMARY_DOMAIN"
    "docs.$PRIMARY_DOMAIN"
    "files.$PRIMARY_DOMAIN"
    "media.$PRIMARY_DOMAIN"
    "auth.$PRIMARY_DOMAIN"
    "mc.$PRIMARY_DOMAIN"
    "app.$PRIMARY_DOMAIN"
)

info "Creating DNS routes for ${#SERVICE_HOSTS[@]} hosts..."
for host in "${SERVICE_HOSTS[@]}"; do
    if cloudflared tunnel route dns "$TUNNEL_ID" "$host" 2>&1 \
        | grep -qE 'created|already exists|Added CNAME'; then
        ok "  $host"
    else
        warn "  $host (route may already exist or zone not found — check Cloudflare dashboard)"
    fi
done

# ─── Step 5: Update rainbow.yaml ─────────────────────────────────
info "Updating $CONFIG_FILE with the test domain..."
yq eval -i ".domain.primary = \"$PRIMARY_DOMAIN\"" "$CONFIG_FILE"
yq eval -i ".cloudflare.tunnel_id = \"$TUNNEL_ID\"" "$CONFIG_FILE"
yq eval -i ".services.stalwart.domains = [\"$PRIMARY_DOMAIN\"]" "$CONFIG_FILE"
ok "rainbow.yaml updated"

echo ""
ok "Test tunnel ready."
echo ""
echo "  Domain:     $PRIMARY_DOMAIN"
echo "  Tunnel:     $TUNNEL_NAME ($TUNNEL_ID)"
echo "  Token:      stored in Keychain"
echo ""
echo "Next:"
echo "  1. Set the rest of your Keychain secrets (Postgres, Authentik, etc) — see README"
echo "  2. Set cloudflare.zone_id in $CONFIG_FILE (find at dash.cloudflare.com)"
echo "  3. make setup    # render configs"
echo "  4. make start    # bring up services"
echo "  5. make test     # see what works"
