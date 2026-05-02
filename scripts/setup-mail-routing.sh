#!/usr/bin/env bash
#
# setup-mail-routing.sh — Provision Cloudflare DNS + Email Routing for inbound
# mail to land at our Cloudflare Email Worker.
#
# What it does (all idempotent):
#   1. Resolve the Cloudflare zone id for domain.zone (caches to rainbow.yaml)
#   2. Enable Email Routing on the zone if not already enabled
#   3. Add three MX records on <prefix>.<zone> pointing at Cloudflare's MX
#   4. Add an SPF TXT record on <prefix>.<zone>
#   5. Set the catch-all routing rule to forward to the rainbow-email-receiver
#      Worker (must already be deployed via wrangler)
#
# Pre-reqs:
#   - Cloudflare API token in Keychain: rainbow-cloudflare-api-token
#       Permissions: Zone:DNS:Edit, Zone:Email Routing Rules:Edit
#       Resource:    Specific zone — <zone>
#   - Worker rainbow-email-receiver deployed (cd cloudflare && wrangler deploy
#       --config wrangler-email-receiver.toml). The catch-all rule is rejected
#       if the Worker doesn't exist.
#
# Re-running is safe: every step checks current state before mutating.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"

CF_API="https://api.cloudflare.com/client/v4"
WORKER_NAME="${RAINBOW_EMAIL_WORKER_NAME:-rainbow-email-receiver}"

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'
info() { echo "${BLUE}[mail-routing]${NC} $*"; }
ok()   { echo "${GREEN}[mail-routing]${NC} $*"; }
warn() { echo "${YELLOW}[mail-routing]${NC} $*"; }
err()  { echo "${RED}[mail-routing]${NC} $*" >&2; }

for cmd in yq jq curl security; do
    command -v "$cmd" >/dev/null 2>&1 || { err "Missing required command: $cmd"; exit 1; }
done

# ─── Read inputs ─────────────────────────────────────────────────
TOKEN=$(security find-generic-password -s rainbow-cloudflare-api-token -w 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
    err "rainbow-cloudflare-api-token not in Keychain."
    err ""
    err "Create one at https://dash.cloudflare.com/profile/api-tokens with these"
    err "permissions on your zone:"
    err "  - Zone → DNS → Edit"
    err "  - Zone → Email Routing Rules → Edit"
    err ""
    err "Then store with:"
    err "  read -rs PW"
    err "  security add-generic-password -s rainbow-cloudflare-api-token -a rainbow -w \"\$PW\" -U"
    exit 1
fi

ZONE=$(yq eval '.domain.zone' "$CONFIG_FILE")
PREFIX=$(yq eval '.domain.prefix // ""' "$CONFIG_FILE")
[ "$PREFIX" = "null" ] && PREFIX=""
if [ -z "$ZONE" ] || [ "$ZONE" = "null" ]; then
    err "domain.zone not set in $CONFIG_FILE"
    exit 1
fi

if [ -n "$PREFIX" ]; then
    MAIL_HOSTNAME="${PREFIX}.${ZONE}"
else
    MAIL_HOSTNAME="$ZONE"
fi

info "Zone:           $ZONE"
info "Mail hostname:  $MAIL_HOSTNAME"
info "Worker:         $WORKER_NAME"
echo

# ─── Helper: API caller ──────────────────────────────────────────
cf() {
    local method="$1" path="$2" body="${3-}"
    local args=(-sS -X "$method" "$CF_API$path" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
    [ -n "$body" ] && args+=(-d "$body")
    curl "${args[@]}"
}

# Some CF endpoints succeed with `success: true` and others use `errors`.
# Returns 0 if `.success == true`, 1 otherwise.
cf_ok() {
    [ "$(echo "$1" | jq -r '.success // false')" = "true" ]
}

cf_errors() {
    echo "$1" | jq -r '.errors[]? | "\(.code): \(.message)"' 2>/dev/null
}

# ─── Step 1: Resolve zone id ─────────────────────────────────────
ZONE_ID=$(yq eval '.cloudflare.zone_id // ""' "$CONFIG_FILE")
[ "$ZONE_ID" = "null" ] && ZONE_ID=""

if [ -z "$ZONE_ID" ]; then
    info "Resolving zone id for $ZONE..."
    resp=$(cf GET "/zones?name=$ZONE")
    if ! cf_ok "$resp"; then
        err "Cloudflare API error looking up zone:"
        cf_errors "$resp"
        exit 1
    fi
    ZONE_ID=$(echo "$resp" | jq -r '.result[0].id // ""')
    if [ -z "$ZONE_ID" ]; then
        err "Zone $ZONE not found in this Cloudflare account."
        exit 1
    fi
    ok "Zone id: $ZONE_ID — caching to rainbow.yaml"
    yq eval -i ".cloudflare.zone_id = \"$ZONE_ID\"" "$CONFIG_FILE"
else
    info "Zone id (from rainbow.yaml): $ZONE_ID"
fi

# ─── Step 2: Email Routing precondition ──────────────────────────
# The /email/routing endpoint returns service settings, which sits under a
# permission scope the dashboard doesn't expose by name (separate from
# "Email Routing Rules"). With our token we can manage rules but can't
# inspect the on/off toggle. Trust the user that it's been enabled in the
# dashboard once — if it hasn't, the catch-all PUT below will surface a
# clear error and we'll bail there.
info "Email Routing must be enabled on $ZONE in the Cloudflare dashboard."
info "  https://dash.cloudflare.com → $ZONE → Email → Email Routing"
info "(Skipping API status check — token doesn't include settings:Read.)"

# ─── Step 3: Add MX records on the mail hostname ─────────────────
# "<priority> <host>" pairs — parallel-list form to stay compatible with the
# bash 3.2 that ships on macOS (associative arrays would let us write this
# more naturally but `declare -A` silently no-ops there, which then evaluates
# dotted hostnames as arithmetic indices and crashes the loop).
MX_ENTRIES=(
    "13 route1.mx.cloudflare.net"
    "86 route2.mx.cloudflare.net"
    "24 route3.mx.cloudflare.net"
)

info "Ensuring MX records on $MAIL_HOSTNAME..."
existing=$(cf GET "/zones/$ZONE_ID/dns_records?type=MX&name=$MAIL_HOSTNAME&per_page=50")
if ! cf_ok "$existing"; then
    err "Failed to list DNS records:"; cf_errors "$existing"; exit 1
fi

for entry in "${MX_ENTRIES[@]}"; do
    priority="${entry%% *}"
    host="${entry#* }"
    have=$(echo "$existing" | jq -r --arg c "$host" '.result[] | select(.content == $c) | .id' | head -n1)
    if [ -n "$have" ]; then
        ok "  MX $host (priority $priority) — already present"
        continue
    fi
    body=$(jq -nc \
        --arg name "$MAIL_HOSTNAME" \
        --arg content "$host" \
        --argjson priority "$priority" \
        '{type: "MX", name: $name, content: $content, priority: $priority, proxied: false, ttl: 1}')
    create_resp=$(cf POST "/zones/$ZONE_ID/dns_records" "$body")
    if cf_ok "$create_resp"; then
        ok "  MX $host (priority $priority) — created"
    else
        err "  MX $host create failed:"; cf_errors "$create_resp"
    fi
done

# ─── Step 4: SPF TXT record ──────────────────────────────────────
info "Ensuring SPF TXT on $MAIL_HOSTNAME..."
spf_value="v=spf1 include:_spf.mx.cloudflare.net ~all"
spf_existing=$(cf GET "/zones/$ZONE_ID/dns_records?type=TXT&name=$MAIL_HOSTNAME&per_page=50")
have_spf=$(echo "$spf_existing" | jq -r '.result[] | select(.content | test("v=spf1")) | .id' | head -n1)
if [ -n "$have_spf" ]; then
    ok "  SPF — already present"
else
    body=$(jq -nc --arg name "$MAIL_HOSTNAME" --arg content "$spf_value" \
        '{type: "TXT", name: $name, content: $content, proxied: false, ttl: 1}')
    create_resp=$(cf POST "/zones/$ZONE_ID/dns_records" "$body")
    if cf_ok "$create_resp"; then
        ok "  SPF — created"
    else
        err "  SPF create failed:"; cf_errors "$create_resp"
    fi
fi

# ─── Step 5: Catch-all routing rule → Worker ─────────────────────
info "Setting catch-all routing rule → $WORKER_NAME..."
catch_all_body=$(jq -nc --arg worker "$WORKER_NAME" '{
    enabled: true,
    name: "Rainbow catch-all → email-receiver Worker",
    matchers: [{ type: "all" }],
    actions:  [{ type: "worker", value: [$worker] }]
}')

# Cloudflare's catch-all rule lives at a fixed path. PUT replaces it idempotently.
ca_resp=$(cf PUT "/zones/$ZONE_ID/email/routing/rules/catch_all" "$catch_all_body")
if cf_ok "$ca_resp"; then
    ok "Catch-all rule set"
else
    err "Catch-all rule failed:"
    cf_errors "$ca_resp"
    err ""
    err "If the error mentions an unknown Worker, deploy it first:"
    err "  cd $PROJECT_ROOT/cloudflare"
    err "  wrangler deploy --config wrangler-email-receiver.toml"
    exit 1
fi

echo
ok "Done. Verify with:"
echo "  dig +short MX $MAIL_HOSTNAME"
echo "  dig +short TXT $MAIL_HOSTNAME"
echo
ok "Then send a test message from any external mailbox to anything@$MAIL_HOSTNAME"
ok "and watch it land in Stalwart's Inbox at https://${PREFIX:+${PREFIX}-}mail.${ZONE}/"
