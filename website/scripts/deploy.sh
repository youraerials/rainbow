#!/usr/bin/env bash
#
# deploy.sh — Deploy the Rainbow brand site to Cloudflare Pages.
#
# This script:
#   1. Verifies dependencies (wrangler, Cloudflare account)
#   2. Deploys the static site to the `rainbow-site` Pages project
#   3. Optionally configures the custom domain (rainbow.rocks)
#
# Usage:
#   ./website/scripts/deploy.sh                  # Deploy to production
#   ./website/scripts/deploy.sh --preview        # Deploy to a preview URL
#   ./website/scripts/deploy.sh --setup-domain   # Configure custom domain (one-time)
#
# Requirements:
#   - npx + Node.js (for wrangler) -- comes free with the rainbow installer
#   - Cloudflare account with Pages enabled
#   - For --setup-domain: API token with Pages:Edit and Zone:DNS:Edit
#     stored in macOS Keychain as `rainbow-cloudflare-api-token`

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_NAME="rainbow-site"
DOMAIN="rainbow.rocks"

PREVIEW=false
SETUP_DOMAIN=false

for arg in "$@"; do
    case "$arg" in
        --preview)       PREVIEW=true ;;
        --setup-domain)  SETUP_DOMAIN=true ;;
        --help|-h)
            sed -n '1,/^set -/p' "$0" | sed 's/^# \?//' | head -n -1
            exit 0
            ;;
    esac
done

# ─── Colors ──────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[deploy]${NC} $*"; }
info() { echo -e "${BLUE}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $*"; }
err()  { echo -e "${RED}[deploy]${NC} $*" >&2; }

# ─── Dependency checks ───────────────────────────────────────────
if ! command -v npx &>/dev/null; then
    err "npx not found. Install Node.js first: brew install node"
    exit 1
fi

# Pin a stable wrangler major; npx will fetch on demand if not installed
WRANGLER="npx --yes wrangler@4"

# ─── Verify Cloudflare login ─────────────────────────────────────
info "Checking Cloudflare auth..."
if ! $WRANGLER whoami &>/dev/null; then
    warn "Not logged in to Cloudflare."
    info "Running: wrangler login"
    $WRANGLER login
fi

WHOAMI=$($WRANGLER whoami 2>&1 | grep -oE '[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' | head -1 || true)
if [ -n "$WHOAMI" ]; then
    ok "Authenticated as: $WHOAMI"
fi

# ─── Validate site contents ──────────────────────────────────────
if [ ! -f "$SITE_DIR/index.html" ]; then
    err "index.html not found in $SITE_DIR"
    exit 1
fi
ok "Site files validated"

# ─── Ensure Pages project exists ─────────────────────────────────
# wrangler pages deploy refuses to auto-create the project in
# non-interactive contexts (any context where stdin/stdout is piped).
# Pre-creating the project sidesteps the prompt entirely.
info "Checking for Pages project '$PROJECT_NAME'..."
if $WRANGLER pages project list 2>/dev/null | grep -qw "$PROJECT_NAME"; then
    ok "Project '$PROJECT_NAME' exists"
else
    info "Creating Pages project '$PROJECT_NAME'..."
    if ! $WRANGLER pages project create "$PROJECT_NAME" \
        --production-branch=main \
        --compatibility-date=2024-12-01; then
        err "Failed to create Pages project"
        exit 1
    fi
    ok "Project created"
fi

# ─── Deploy ──────────────────────────────────────────────────────
cd "$SITE_DIR"

DEPLOY_FLAGS=(--commit-dirty=true)
if $PREVIEW; then
    DEPLOY_FLAGS+=(--branch="preview-$(date +%s)")
    info "Deploying as preview..."
else
    DEPLOY_FLAGS+=(--branch=main)
    info "Deploying to production ($PROJECT_NAME)..."
fi

# Don't capture output — let wrangler stream to the terminal so
# (a) it can use a TTY for any prompts and (b) the user sees progress.
if ! $WRANGLER pages deploy . \
    --project-name="$PROJECT_NAME" \
    "${DEPLOY_FLAGS[@]}"; then
    err "Deploy failed (see wrangler output above)"
    exit 1
fi

ok "Deployed."

# ─── Optional: configure custom domain ───────────────────────────
if $SETUP_DOMAIN; then
    info "Configuring custom domain: $DOMAIN"

    API_TOKEN=$(security find-generic-password -s "rainbow-cloudflare-api-token" -w 2>/dev/null || echo "")
    ACCOUNT_ID=$(security find-generic-password -s "rainbow-cloudflare-account-id" -w 2>/dev/null || echo "")
    ZONE_ID=$(security find-generic-password -s "rainbow-cloudflare-zone-id" -w 2>/dev/null || echo "")

    if [ -z "$API_TOKEN" ] || [ -z "$ACCOUNT_ID" ] || [ -z "$ZONE_ID" ]; then
        err "Missing Cloudflare credentials in Keychain."
        err ""
        err "Store them with:"
        err "  security add-generic-password -s rainbow-cloudflare-api-token -a rainbow -w '<token>'"
        err "  security add-generic-password -s rainbow-cloudflare-account-id -a rainbow -w '<account-id>'"
        err "  security add-generic-password -s rainbow-cloudflare-zone-id -a rainbow -w '<zone-id>'"
        err ""
        err "Token needs: Account.Pages:Edit, Zone.DNS:Edit"
        exit 1
    fi

    # Attach domain to Pages project
    info "Attaching $DOMAIN to Pages project..."
    DOMAIN_RESULT=$(curl -s -X POST \
        "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects/$PROJECT_NAME/domains" \
        -H "Authorization: Bearer $API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"name\":\"$DOMAIN\"}")

    if echo "$DOMAIN_RESULT" | grep -q '"success":true'; then
        ok "Domain attached: $DOMAIN"
    elif echo "$DOMAIN_RESULT" | grep -q "already in use"; then
        ok "Domain already attached: $DOMAIN"
    else
        warn "Domain attach response: $DOMAIN_RESULT"
    fi

    # Create CNAME record pointing to the Pages project
    info "Creating CNAME for $DOMAIN..."
    PAGES_TARGET="$PROJECT_NAME.pages.dev"

    # Check if record exists
    EXISTING=$(curl -s -X GET \
        "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=CNAME&name=$DOMAIN" \
        -H "Authorization: Bearer $API_TOKEN")
    EXISTING_ID=$(echo "$EXISTING" | yq eval '.result[0].id // ""' - 2>/dev/null || echo "")

    DNS_DATA="{\"type\":\"CNAME\",\"name\":\"$DOMAIN\",\"content\":\"$PAGES_TARGET\",\"proxied\":true,\"ttl\":1}"

    if [ -n "$EXISTING_ID" ] && [ "$EXISTING_ID" != "null" ]; then
        DNS_RESULT=$(curl -s -X PUT \
            "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$EXISTING_ID" \
            -H "Authorization: Bearer $API_TOKEN" \
            -H "Content-Type: application/json" \
            -d "$DNS_DATA")
        ok "Updated CNAME: $DOMAIN -> $PAGES_TARGET"
    else
        DNS_RESULT=$(curl -s -X POST \
            "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
            -H "Authorization: Bearer $API_TOKEN" \
            -H "Content-Type: application/json" \
            -d "$DNS_DATA")
        if echo "$DNS_RESULT" | grep -q '"success":true'; then
            ok "Created CNAME: $DOMAIN -> $PAGES_TARGET"
        else
            warn "DNS response: $DNS_RESULT"
        fi
    fi
fi

ok "Done."
echo ""
if ! $PREVIEW; then
    echo "  Production: https://$DOMAIN"
    echo "  Pages URL:  https://$PROJECT_NAME.pages.dev"
fi
