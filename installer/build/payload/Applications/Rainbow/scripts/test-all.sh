#!/usr/bin/env bash
#
# test-all.sh — Comprehensive integration test suite for Rainbow.
#
# Tests every service, DNS record, tunnel connectivity, email delivery,
# file operations, and more. Designed to run after initial setup to
# verify everything works end-to-end.
#
# Usage:
#   ./scripts/test-all.sh              # Run all tests
#   ./scripts/test-all.sh --quick      # Skip slow tests (email delivery, backups)
#   ./scripts/test-all.sh --section dns # Run only one section
#
# Exit codes:
#   0 = all tests passed
#   1 = one or more tests failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"

# ─── Parse arguments ─────────────────────────────────────────────
QUICK=false
SECTION=""
VERBOSE=false
for arg in "$@"; do
    case "$arg" in
        --quick)   QUICK=true ;;
        --verbose) VERBOSE=true ;;
        --section) shift; SECTION="${2:-}" ;;
        --section=*) SECTION="${arg#--section=}" ;;
    esac
done

# ─── Load config ─────────────────────────────────────────────────
if ! command -v yq &>/dev/null; then
    echo "ERROR: yq is required. Install with: brew install yq" >&2
    exit 1
fi

DOMAIN=$(yq eval '.domain.primary' "$CONFIG_FILE" 2>/dev/null || echo "localhost")
ADMIN_EMAIL=$(yq eval '.admin.email' "$CONFIG_FILE" 2>/dev/null || echo "admin@localhost")

# ─── Colors and formatting ───────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
WARN_COUNT=0
RESULTS=()

pass() {
    PASS_COUNT=$((PASS_COUNT + 1))
    RESULTS+=("${GREEN}PASS${NC}  $1")
    echo -e "  ${GREEN}PASS${NC}  $1"
}

fail() {
    FAIL_COUNT=$((FAIL_COUNT + 1))
    RESULTS+=("${RED}FAIL${NC}  $1  ${DIM}($2)${NC}")
    echo -e "  ${RED}FAIL${NC}  $1"
    if $VERBOSE; then
        echo -e "        ${DIM}$2${NC}"
    fi
}

skip() {
    SKIP_COUNT=$((SKIP_COUNT + 1))
    RESULTS+=("${YELLOW}SKIP${NC}  $1  ${DIM}($2)${NC}")
    echo -e "  ${YELLOW}SKIP${NC}  $1  ${DIM}($2)${NC}"
}

warn() {
    WARN_COUNT=$((WARN_COUNT + 1))
    RESULTS+=("${YELLOW}WARN${NC}  $1  ${DIM}($2)${NC}")
    echo -e "  ${YELLOW}WARN${NC}  $1  ${DIM}($2)${NC}"
}

section() {
    echo ""
    echo -e "${BOLD}=== $1 ===${NC}"
    echo ""
}

# ─── HTTP helper ─────────────────────────────────────────────────
# Returns HTTP status code. Sets $RESPONSE_BODY.
RESPONSE_BODY=""
http_status() {
    local url="$1"
    local method="${2:-GET}"
    local data="${3:-}"
    local headers="${4:-}"
    local timeout="${5:-10}"

    local curl_args=(-s -o /tmp/rainbow-test-response -w "%{http_code}" --max-time "$timeout")

    if [ "$method" != "GET" ]; then
        curl_args+=(-X "$method")
    fi
    if [ -n "$data" ]; then
        curl_args+=(-d "$data" -H "Content-Type: application/json")
    fi
    if [ -n "$headers" ]; then
        # Split headers by semicolon
        IFS=';' read -ra HEADER_ARRAY <<< "$headers"
        for h in "${HEADER_ARRAY[@]}"; do
            curl_args+=(-H "$h")
        done
    fi

    local status
    status=$(curl "${curl_args[@]}" "$url" 2>/dev/null || echo "000")
    RESPONSE_BODY=$(cat /tmp/rainbow-test-response 2>/dev/null || echo "")
    echo "$status"
}

# Check if a service is enabled in config
is_enabled() {
    local service="$1"
    local enabled
    enabled=$(yq eval ".services.${service}.enabled // true" "$CONFIG_FILE" 2>/dev/null)
    [ "$enabled" != "false" ]
}

# ─── Test: Prerequisites ─────────────────────────────────────────
test_prerequisites() {
    section "Prerequisites"

    # macOS version
    local macos_ver
    macos_ver=$(sw_vers -productVersion)
    local major
    major=$(echo "$macos_ver" | cut -d. -f1)
    if [ "$major" -ge 26 ]; then
        pass "macOS version: $macos_ver"
    else
        fail "macOS version: $macos_ver" "macOS 26+ required"
    fi

    # Architecture
    local arch
    arch=$(uname -m)
    if [ "$arch" = "arm64" ]; then
        pass "Architecture: $arch"
    else
        fail "Architecture: $arch" "arm64 required"
    fi

    # Apple Container
    if command -v container &>/dev/null; then
        pass "Apple Container: $(container --version 2>/dev/null || echo 'installed')"
    else
        fail "Apple Container" "not installed (brew install container)"
    fi

    # container-compose
    if command -v container-compose &>/dev/null; then
        pass "container-compose: installed"
    else
        fail "container-compose" "not installed (brew install container-compose)"
    fi

    # Apple Container system service
    if container system status &>/dev/null 2>&1; then
        pass "Container system service: running"
    else
        fail "Container system service" "not running (container system start)"
    fi

    # Required CLI tools
    for cmd in yq jq restic cloudflared curl openssl; do
        if command -v "$cmd" &>/dev/null; then
            pass "$cmd: installed"
        else
            fail "$cmd" "not installed"
        fi
    done

    # Config file
    if [ -f "$CONFIG_FILE" ]; then
        pass "rainbow.yaml: exists"
    else
        fail "rainbow.yaml" "not found at $CONFIG_FILE"
    fi

    # Generated configs
    if [ -f "$PROJECT_ROOT/infrastructure/.env" ]; then
        pass "Generated .env: exists"
    else
        fail "Generated .env" "not found. Run: rainbow config apply"
    fi
}

# ─── Test: Container Services ────────────────────────────────────
test_containers() {
    section "Container Services"

    # Check each container is running
    local containers=(
        "rainbow-caddy"
        "rainbow-cloudflared"
        "rainbow-postgres"
        "rainbow-valkey"
    )

    if is_enabled "authentik"; then
        containers+=("rainbow-authentik" "rainbow-authentik-worker")
    fi
    if is_enabled "immich"; then
        containers+=("rainbow-immich" "rainbow-immich-ml")
    fi
    if is_enabled "cryptpad"; then
        containers+=("rainbow-cryptpad")
    fi
    if is_enabled "seafile"; then
        containers+=("rainbow-seafile")
    fi

    for name in "${containers[@]}"; do
        if container list 2>/dev/null | grep -q "$name"; then
            pass "Container running: $name"
        else
            fail "Container running: $name" "not found in container list"
        fi
    done
}

# ─── Test: Native Services ───────────────────────────────────────
test_native_services() {
    section "Native Services"

    # Stalwart
    if is_enabled "stalwart"; then
        if pgrep -x stalwart-mail &>/dev/null; then
            pass "Stalwart: running (pid $(pgrep -x stalwart-mail))"
        else
            fail "Stalwart" "process not running"
        fi
    else
        skip "Stalwart" "disabled in config"
    fi

    # Jellyfin
    if is_enabled "jellyfin"; then
        if pgrep -x jellyfin &>/dev/null; then
            pass "Jellyfin: running (pid $(pgrep -x jellyfin))"
        else
            fail "Jellyfin" "process not running"
        fi
    else
        skip "Jellyfin" "disabled in config"
    fi

    # Minecraft
    if is_enabled "minecraft"; then
        if pgrep -f "paper.*\.jar" &>/dev/null; then
            pass "Minecraft: running"
        else
            fail "Minecraft" "process not running"
        fi
    else
        skip "Minecraft" "disabled in config"
    fi
}

# ─── Test: Service HTTP Endpoints ────────────────────────────────
test_http_endpoints() {
    section "Service HTTP Endpoints (localhost)"

    # Caddy
    local status
    status=$(http_status "http://127.0.0.1:80")
    if [ "$status" != "000" ]; then
        pass "Caddy HTTP (port 80): $status"
    else
        fail "Caddy HTTP (port 80)" "connection refused"
    fi

    # PostgreSQL (TCP check)
    if nc -z -w 3 127.0.0.1 5432 2>/dev/null; then
        pass "PostgreSQL (port 5432): listening"
    else
        fail "PostgreSQL (port 5432)" "not listening"
    fi

    # Valkey
    if nc -z -w 3 127.0.0.1 6379 2>/dev/null; then
        pass "Valkey (port 6379): listening"
    else
        fail "Valkey (port 6379)" "not listening"
    fi

    # Authentik
    if is_enabled "authentik"; then
        status=$(http_status "http://127.0.0.1:9000/-/health/ready/")
        if [ "$status" = "200" ] || [ "$status" = "204" ]; then
            pass "Authentik health (port 9000): $status"
        else
            fail "Authentik health (port 9000)" "HTTP $status"
        fi
    fi

    # Immich
    if is_enabled "immich"; then
        status=$(http_status "http://127.0.0.1:2283/api/server/ping")
        if [ "$status" = "200" ]; then
            pass "Immich API (port 2283): $status"
        else
            fail "Immich API (port 2283)" "HTTP $status"
        fi
    fi

    # Stalwart HTTP
    if is_enabled "stalwart"; then
        status=$(http_status "http://127.0.0.1:8080")
        if [ "$status" != "000" ]; then
            pass "Stalwart HTTP (port 8080): $status"
        else
            fail "Stalwart HTTP (port 8080)" "connection refused"
        fi
    fi

    # Seafile
    if is_enabled "seafile"; then
        status=$(http_status "http://127.0.0.1:8082")
        if [ "$status" != "000" ]; then
            pass "Seafile HTTP (port 8082): $status"
        else
            fail "Seafile HTTP (port 8082)" "connection refused"
        fi
    fi

    # CryptPad
    if is_enabled "cryptpad"; then
        status=$(http_status "http://127.0.0.1:3000")
        if [ "$status" != "000" ]; then
            pass "CryptPad HTTP (port 3000): $status"
        else
            fail "CryptPad HTTP (port 3000)" "connection refused"
        fi
    fi

    # Jellyfin
    if is_enabled "jellyfin"; then
        status=$(http_status "http://127.0.0.1:8096")
        if [ "$status" != "000" ]; then
            pass "Jellyfin HTTP (port 8096): $status"
        else
            fail "Jellyfin HTTP (port 8096)" "connection refused"
        fi
    fi
}

# ─── Test: DNS Records ───────────────────────────────────────────
test_dns() {
    section "DNS Records"

    if [ "$DOMAIN" = "localhost" ]; then
        skip "DNS tests" "domain is localhost"
        return
    fi

    # Check that subdomains resolve
    local subdomains=("app" "auth" "photos" "mail" "files" "docs" "media" "api")

    for sub in "${subdomains[@]}"; do
        local fqdn="$sub.$DOMAIN"
        local result
        result=$(dig +short "$fqdn" 2>/dev/null | head -1)
        if [ -n "$result" ]; then
            pass "DNS $fqdn -> $result"
        else
            fail "DNS $fqdn" "no record found"
        fi
    done

    # Email-specific DNS
    if is_enabled "stalwart"; then
        # MX record
        local mx
        mx=$(dig +short MX "$DOMAIN" 2>/dev/null | head -1)
        if [ -n "$mx" ]; then
            pass "MX $DOMAIN -> $mx"
        else
            fail "MX $DOMAIN" "no MX record"
        fi

        # SPF record
        local spf
        spf=$(dig +short TXT "$DOMAIN" 2>/dev/null | grep -i "v=spf1" || echo "")
        if [ -n "$spf" ]; then
            pass "SPF $DOMAIN: $spf"
        else
            fail "SPF $DOMAIN" "no SPF record"
        fi

        # DKIM record
        local dkim
        dkim=$(dig +short TXT "rainbow._domainkey.$DOMAIN" 2>/dev/null | head -1)
        if [ -n "$dkim" ]; then
            pass "DKIM rainbow._domainkey.$DOMAIN: present (${#dkim} chars)"
        else
            fail "DKIM rainbow._domainkey.$DOMAIN" "no DKIM record"
        fi

        # DMARC record
        local dmarc
        dmarc=$(dig +short TXT "_dmarc.$DOMAIN" 2>/dev/null | head -1)
        if [ -n "$dmarc" ]; then
            pass "DMARC _dmarc.$DOMAIN: $dmarc"
        else
            fail "DMARC _dmarc.$DOMAIN" "no DMARC record"
        fi
    fi
}

# ─── Test: Cloudflare Tunnel ─────────────────────────────────────
test_tunnel() {
    section "Cloudflare Tunnel"

    if [ "$DOMAIN" = "localhost" ]; then
        skip "Tunnel tests" "domain is localhost"
        return
    fi

    # Test that services are reachable through the tunnel (external access)
    local endpoints=(
        "https://app.$DOMAIN"
        "https://auth.$DOMAIN"
    )
    if is_enabled "immich"; then
        endpoints+=("https://photos.$DOMAIN")
    fi
    if is_enabled "stalwart"; then
        endpoints+=("https://mail.$DOMAIN")
    fi
    if is_enabled "seafile"; then
        endpoints+=("https://files.$DOMAIN")
    fi
    if is_enabled "cryptpad"; then
        endpoints+=("https://docs.$DOMAIN")
    fi
    if is_enabled "jellyfin"; then
        endpoints+=("https://media.$DOMAIN")
    fi

    for url in "${endpoints[@]}"; do
        local status
        status=$(http_status "$url" "GET" "" "" "15")
        if [ "$status" != "000" ] && [ "$status" != "502" ] && [ "$status" != "503" ]; then
            pass "Tunnel: $url (HTTP $status)"
        elif [ "$status" = "502" ] || [ "$status" = "503" ]; then
            warn "Tunnel: $url (HTTP $status)" "reachable but service may be starting"
        else
            fail "Tunnel: $url" "connection failed"
        fi
    done

    # Check tunnel TLS certificate
    local cert_info
    cert_info=$(echo | openssl s_client -connect "app.$DOMAIN:443" -servername "app.$DOMAIN" 2>/dev/null | \
        openssl x509 -noout -dates 2>/dev/null || echo "")
    if [ -n "$cert_info" ]; then
        local expiry
        expiry=$(echo "$cert_info" | grep "notAfter" | cut -d= -f2)
        pass "TLS certificate for app.$DOMAIN (expires: $expiry)"
    else
        fail "TLS certificate for app.$DOMAIN" "could not retrieve"
    fi
}

# ─── Test: Email ─────────────────────────────────────────────────
test_email() {
    section "Email (Stalwart)"

    if ! is_enabled "stalwart"; then
        skip "Email tests" "stalwart disabled"
        return
    fi

    # SMTP connectivity
    if nc -z -w 5 127.0.0.1 587 2>/dev/null; then
        pass "SMTP submission (port 587): listening"
    else
        fail "SMTP submission (port 587)" "not listening"
    fi

    if nc -z -w 5 127.0.0.1 993 2>/dev/null; then
        pass "IMAPS (port 993): listening"
    else
        fail "IMAPS (port 993)" "not listening"
    fi

    # SMTP EHLO test
    local ehlo_response
    ehlo_response=$(echo -e "EHLO test.local\r\nQUIT\r\n" | \
        nc -w 5 127.0.0.1 587 2>/dev/null || echo "")
    if echo "$ehlo_response" | grep -qi "250"; then
        pass "SMTP EHLO: server responds"
    else
        fail "SMTP EHLO" "no valid response"
    fi

    # STARTTLS support
    if echo "$ehlo_response" | grep -qi "STARTTLS"; then
        pass "SMTP STARTTLS: advertised"
    else
        warn "SMTP STARTTLS" "not advertised in EHLO response"
    fi

    # JMAP endpoint
    local status
    status=$(http_status "http://127.0.0.1:8080/jmap")
    if [ "$status" != "000" ]; then
        pass "JMAP endpoint: HTTP $status"
    else
        fail "JMAP endpoint" "not reachable"
    fi

    # CalDAV endpoint
    status=$(http_status "http://127.0.0.1:8080/.well-known/caldav")
    if [ "$status" != "000" ]; then
        pass "CalDAV endpoint: HTTP $status"
    else
        fail "CalDAV endpoint" "not reachable"
    fi

    # CardDAV endpoint
    status=$(http_status "http://127.0.0.1:8080/.well-known/carddav")
    if [ "$status" != "000" ]; then
        pass "CardDAV endpoint: HTTP $status"
    else
        fail "CardDAV endpoint" "not reachable"
    fi

    # Send a test email (slow test)
    if $QUICK; then
        skip "Send test email" "--quick mode"
    else
        echo -e "  ${DIM}Sending test email to $ADMIN_EMAIL...${NC}"
        local send_result
        send_result=$(curl -s --max-time 30 \
            --url "smtp://127.0.0.1:587" \
            --mail-from "test@$DOMAIN" \
            --mail-rcpt "$ADMIN_EMAIL" \
            --upload-file - <<EOF 2>&1
From: Rainbow Test <test@$DOMAIN>
To: $ADMIN_EMAIL
Subject: Rainbow Integration Test $(date '+%Y-%m-%d %H:%M')
Date: $(date -R)
Message-ID: <rainbow-test-$(date +%s)@$DOMAIN>

This is an automated test email from the Rainbow integration test suite.

If you received this, your email server is working correctly.

Sent at: $(date)
Server: $DOMAIN
EOF
)
        if [ $? -eq 0 ]; then
            pass "Test email sent to $ADMIN_EMAIL"
        else
            fail "Test email" "$send_result"
        fi

        # Check if email arrived via JMAP (give it a few seconds)
        sleep 3
        local stalwart_pass
        stalwart_pass=$(security find-generic-password -s "rainbow-stalwart-admin-password" -w 2>/dev/null || echo "")
        if [ -n "$stalwart_pass" ]; then
            local inbox_check
            inbox_check=$(curl -s --max-time 10 \
                -u "admin:$stalwart_pass" \
                -H "Content-Type: application/json" \
                -d '{"using":["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],"methodCalls":[["Email/query",{"accountId":"admin","filter":{"subject":"Rainbow Integration Test"},"limit":1},"t0"]]}' \
                "http://127.0.0.1:8080/jmap" 2>/dev/null || echo "")
            if echo "$inbox_check" | grep -q '"ids":\[' 2>/dev/null; then
                pass "Test email received (found via JMAP)"
            else
                warn "Test email delivery" "sent but not yet visible via JMAP (may take a moment)"
            fi
        fi
    fi
}

# ─── Test: Photos (Immich) ───────────────────────────────────────
test_photos() {
    section "Photos (Immich)"

    if ! is_enabled "immich"; then
        skip "Immich tests" "disabled in config"
        return
    fi

    # Server ping
    local status
    status=$(http_status "http://127.0.0.1:2283/api/server/ping")
    if [ "$status" = "200" ]; then
        pass "Immich server ping: OK"
    else
        fail "Immich server ping" "HTTP $status"
        return
    fi

    # Server info
    status=$(http_status "http://127.0.0.1:2283/api/server/about")
    if [ "$status" = "200" ]; then
        local version
        version=$(echo "$RESPONSE_BODY" | yq eval '.version // "unknown"' - 2>/dev/null)
        pass "Immich version: $version"
    else
        warn "Immich server info" "HTTP $status (may need auth)"
    fi

    # Upload path exists and is writable
    local upload_path
    upload_path=$(yq eval '.services.immich.upload_path // "./infrastructure/immich/upload"' "$CONFIG_FILE")
    if [ -d "$upload_path" ] && [ -w "$upload_path" ]; then
        pass "Immich upload path writable: $upload_path"
    else
        fail "Immich upload path" "$upload_path not writable"
    fi

    # ML service
    status=$(http_status "http://127.0.0.1:3003/ping" "GET" "" "" "5")
    if [ "$status" = "200" ]; then
        pass "Immich ML service: running"
    else
        warn "Immich ML" "HTTP $status (may not be exposed on host)"
    fi
}

# ─── Test: Files (Seafile) ───────────────────────────────────────
test_files() {
    section "Files (Seafile)"

    if ! is_enabled "seafile"; then
        skip "Seafile tests" "disabled in config"
        return
    fi

    local status
    status=$(http_status "http://127.0.0.1:8082")
    if [ "$status" != "000" ]; then
        pass "Seafile HTTP: $status"
    else
        fail "Seafile HTTP" "connection refused"
        return
    fi

    # API ping
    status=$(http_status "http://127.0.0.1:8082/api2/server-info/")
    if [ "$status" = "200" ]; then
        pass "Seafile API: reachable"
    else
        warn "Seafile API" "HTTP $status"
    fi

    # Auth token test
    local seafile_pass
    seafile_pass=$(security find-generic-password -s "rainbow-seafile-admin-password" -w 2>/dev/null || echo "")
    if [ -n "$seafile_pass" ]; then
        local token_resp
        token_resp=$(http_status "http://127.0.0.1:8082/api2/auth-token/" "POST" \
            "{\"username\":\"$ADMIN_EMAIL\",\"password\":\"$seafile_pass\"}")
        if [ "$token_resp" = "200" ]; then
            local token
            token=$(echo "$RESPONSE_BODY" | yq eval '.token // ""' - 2>/dev/null)
            if [ -n "$token" ] && [ "$token" != "null" ]; then
                pass "Seafile auth: token obtained"

                # List libraries
                local lib_resp
                lib_resp=$(http_status "http://127.0.0.1:8082/api2/repos/" "GET" "" "Authorization: Token $token")
                if [ "$lib_resp" = "200" ]; then
                    pass "Seafile libraries API: accessible"
                else
                    fail "Seafile libraries API" "HTTP $lib_resp"
                fi
            fi
        else
            fail "Seafile auth" "HTTP $token_resp"
        fi
    else
        skip "Seafile auth test" "admin password not in Keychain"
    fi
}

# ─── Test: Documents (CryptPad) ──────────────────────────────────
test_docs() {
    section "Documents (CryptPad)"

    if ! is_enabled "cryptpad"; then
        skip "CryptPad tests" "disabled in config"
        return
    fi

    local status
    status=$(http_status "http://127.0.0.1:3000")
    if [ "$status" != "000" ]; then
        pass "CryptPad main: HTTP $status"
    else
        fail "CryptPad main (port 3000)" "connection refused"
    fi

    # Sandbox domain
    status=$(http_status "http://127.0.0.1:3001")
    if [ "$status" != "000" ]; then
        pass "CryptPad sandbox: HTTP $status"
    else
        fail "CryptPad sandbox (port 3001)" "connection refused"
    fi

    # API endpoint
    status=$(http_status "http://127.0.0.1:3000/api/config")
    if [ "$status" = "200" ]; then
        pass "CryptPad API config: accessible"
    else
        warn "CryptPad API config" "HTTP $status"
    fi
}

# ─── Test: Media (Jellyfin) ──────────────────────────────────────
test_media() {
    section "Media (Jellyfin)"

    if ! is_enabled "jellyfin"; then
        skip "Jellyfin tests" "disabled in config"
        return
    fi

    local status
    status=$(http_status "http://127.0.0.1:8096")
    if [ "$status" != "000" ]; then
        pass "Jellyfin HTTP: $status"
    else
        fail "Jellyfin HTTP (port 8096)" "connection refused"
        return
    fi

    # System info
    status=$(http_status "http://127.0.0.1:8096/System/Info/Public")
    if [ "$status" = "200" ]; then
        local jf_version
        jf_version=$(echo "$RESPONSE_BODY" | yq eval '.Version // "unknown"' - 2>/dev/null)
        pass "Jellyfin version: $jf_version"
    else
        warn "Jellyfin system info" "HTTP $status"
    fi

    # Check media paths exist
    local media_paths
    media_paths=$(yq eval '.services.jellyfin.media_paths[]' "$CONFIG_FILE" 2>/dev/null || echo "")
    if [ -n "$media_paths" ]; then
        while IFS= read -r mpath; do
            # Expand ~ to home dir
            mpath="${mpath/#\~/$HOME}"
            if [ -d "$mpath" ]; then
                local count
                count=$(find "$mpath" -maxdepth 2 -type f \( -name "*.mp4" -o -name "*.mkv" -o -name "*.mp3" -o -name "*.flac" -o -name "*.avi" \) 2>/dev/null | wc -l | tr -d ' ')
                pass "Media path exists: $mpath ($count media files found)"
            else
                warn "Media path" "$mpath does not exist"
            fi
        done <<< "$media_paths"
    fi
}

# ─── Test: Auth (Authentik) ──────────────────────────────────────
test_auth() {
    section "Auth (Authentik)"

    if ! is_enabled "authentik"; then
        skip "Authentik tests" "disabled in config"
        return
    fi

    # Health check
    local status
    status=$(http_status "http://127.0.0.1:9000/-/health/ready/")
    if [ "$status" = "200" ] || [ "$status" = "204" ]; then
        pass "Authentik health: ready"
    else
        fail "Authentik health" "HTTP $status"
        return
    fi

    # Admin login
    local admin_pass
    admin_pass=$(security find-generic-password -s "rainbow-authentik-bootstrap-password" -w 2>/dev/null || echo "")
    if [ -n "$admin_pass" ]; then
        # Try to get an API token
        local token_resp
        token_resp=$(http_status "http://127.0.0.1:9000/api/v3/core/tokens/" "POST" \
            "{\"identifier\":\"rainbow-test-$(date +%s)\",\"intent\":\"api\"}" \
            "Authorization: Basic $(echo -n "akadmin:$admin_pass" | base64)")
        if [ "$token_resp" = "201" ] || [ "$token_resp" = "200" ]; then
            pass "Authentik admin API: authenticated"
        else
            warn "Authentik admin API" "HTTP $token_resp (admin may need initial setup)"
        fi
    else
        skip "Authentik admin login" "bootstrap password not in Keychain"
    fi

    # Check OAuth providers exist
    local providers_resp
    providers_resp=$(http_status "http://127.0.0.1:9000/api/v3/providers/oauth2/" "GET" "" \
        "Authorization: Basic $(echo -n "akadmin:${admin_pass:-none}" | base64)")
    if [ "$providers_resp" = "200" ]; then
        local count
        count=$(echo "$RESPONSE_BODY" | yq eval '.pagination.count // 0' - 2>/dev/null)
        if [ "$count" -gt 0 ] 2>/dev/null; then
            pass "OAuth2 providers configured: $count"
        else
            warn "OAuth2 providers" "none configured (run: ./services/authentik/setup-providers.sh)"
        fi
    fi
}

# ─── Test: Minecraft ─────────────────────────────────────────────
test_minecraft() {
    section "Minecraft"

    if ! is_enabled "minecraft"; then
        skip "Minecraft tests" "disabled in config"
        return
    fi

    if ! pgrep -f "paper.*\.jar" &>/dev/null; then
        fail "Minecraft server" "not running"
        return
    fi

    pass "Minecraft process: running"

    # TCP port check
    if nc -z -w 5 127.0.0.1 25565 2>/dev/null; then
        pass "Minecraft port 25565: listening"
    else
        fail "Minecraft port 25565" "not listening"
    fi

    # RCON port check
    if nc -z -w 5 127.0.0.1 25575 2>/dev/null; then
        pass "RCON port 25575: listening"
    else
        fail "RCON port 25575" "not listening"
    fi

    # RCON command test
    local rcon_pass
    rcon_pass=$(security find-generic-password -s "rainbow-minecraft-rcon-password" -w 2>/dev/null || echo "")
    if [ -n "$rcon_pass" ]; then
        # Simple RCON test using our MCP tools would be ideal,
        # but for a shell test we just verify the port accepts connections
        pass "RCON password: found in Keychain"
    else
        warn "RCON password" "not in Keychain"
    fi

    # World directory
    local world_dir="$PROJECT_ROOT/infrastructure/minecraft/server/world"
    if [ -d "$world_dir" ]; then
        local world_size
        world_size=$(du -sh "$world_dir" 2>/dev/null | cut -f1)
        pass "World data: $world_size"
    else
        warn "World directory" "not found (server may not have started yet)"
    fi
}

# ─── Test: Backups ───────────────────────────────────────────────
test_backups() {
    section "Backups"

    local backup_enabled
    backup_enabled=$(yq eval '.backups.enabled // true' "$CONFIG_FILE")
    if [ "$backup_enabled" != "true" ]; then
        skip "Backup tests" "disabled in config"
        return
    fi

    # Restic installed
    if command -v restic &>/dev/null; then
        pass "Restic: $(restic version 2>/dev/null | head -1)"
    else
        fail "Restic" "not installed"
        return
    fi

    # Restic password in Keychain
    local restic_pass
    restic_pass=$(security find-generic-password -s "rainbow-restic-password" -w 2>/dev/null || echo "")
    if [ -n "$restic_pass" ]; then
        pass "Restic password: in Keychain"
    else
        fail "Restic password" "not in Keychain"
        return
    fi

    # Repository configured
    local repo
    repo=$(yq eval '.backups.repository' "$CONFIG_FILE")
    if [ -n "$repo" ] && [ "$repo" != "null" ] && [ "$repo" != "" ]; then
        pass "Backup repository: $repo"
    else
        warn "Backup repository" "not configured in rainbow.yaml"
        return
    fi

    # Dry run backup test (slow)
    if $QUICK; then
        skip "Backup dry run" "--quick mode"
    else
        echo -e "  ${DIM}Running backup dry run...${NC}"
        local dry_run_output
        dry_run_output=$(bash "$PROJECT_ROOT/backups/backup.sh" --dry-run 2>&1 || echo "FAILED")
        if echo "$dry_run_output" | grep -q "would back up"; then
            local path_count
            path_count=$(echo "$dry_run_output" | grep "^  /" | wc -l | tr -d ' ')
            pass "Backup dry run: $path_count paths identified"
        else
            fail "Backup dry run" "script returned error"
        fi
    fi

    # Scheduled backup launchd plist
    if launchctl list 2>/dev/null | grep -q "rainbow.backup"; then
        pass "Backup schedule: launchd job active"
    else
        warn "Backup schedule" "launchd job not loaded"
    fi
}

# ─── Test: DDNS ──────────────────────────────────────────────────
test_ddns() {
    section "Dynamic DNS"

    if [ "$DOMAIN" = "localhost" ]; then
        skip "DDNS tests" "domain is localhost"
        return
    fi

    # DDNS script exists
    if [ -x "$PROJECT_ROOT/services/network/ddns-update.sh" ]; then
        pass "DDNS script: exists and executable"
    else
        fail "DDNS script" "not found"
        return
    fi

    # Can determine public IP
    local public_ip
    public_ip=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
    if [[ "$public_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        pass "Public IP: $public_ip"
    else
        fail "Public IP detection" "could not determine"
    fi

    # DDNS launchd job
    if launchctl list 2>/dev/null | grep -q "rainbow.ddns"; then
        pass "DDNS schedule: launchd job active"
    else
        warn "DDNS schedule" "launchd job not loaded"
    fi
}

# ─── Test: MCP Gateway ──────────────────────────────────────────
test_mcp() {
    section "MCP Gateway"

    # Check if MCP gateway is running
    local status
    status=$(http_status "http://127.0.0.1:3001/health" "GET" "" "" "5")
    if [ "$status" = "200" ]; then
        pass "MCP gateway health: OK"
    else
        skip "MCP gateway" "not running (HTTP $status)"
        return
    fi
}

# ─── Test: Database ──────────────────────────────────────────────
test_database() {
    section "Database"

    # PostgreSQL connection
    local pg_pass
    pg_pass=$(security find-generic-password -s "rainbow-postgres-password" -w 2>/dev/null || echo "")
    if [ -n "$pg_pass" ]; then
        local db_check
        db_check=$(container exec rainbow-postgres psql -U rainbow -d rainbow -c "SELECT 1;" 2>/dev/null || echo "FAILED")
        if echo "$db_check" | grep -q "1"; then
            pass "PostgreSQL: connection OK"
        else
            fail "PostgreSQL connection" "query failed"
        fi

        # Check per-service databases exist
        for db in authentik immich seafile; do
            local db_exists
            db_exists=$(container exec rainbow-postgres psql -U rainbow -d rainbow -tAc \
                "SELECT 1 FROM pg_database WHERE datname='$db';" 2>/dev/null || echo "")
            if [ "$db_exists" = "1" ]; then
                pass "Database exists: $db"
            else
                fail "Database: $db" "not found"
            fi
        done
    else
        skip "PostgreSQL tests" "password not in Keychain"
    fi

    # Valkey ping
    local valkey_ping
    valkey_ping=$(container exec rainbow-valkey valkey-cli ping 2>/dev/null || echo "")
    if [ "$valkey_ping" = "PONG" ]; then
        pass "Valkey: PONG"
    else
        fail "Valkey ping" "no response"
    fi
}

# ─── Test: Security ──────────────────────────────────────────────
test_security() {
    section "Security"

    # Check that services are NOT exposed on 0.0.0.0
    local exposed_services=()
    for port in 5432 6379; do
        if netstat -an 2>/dev/null | grep "LISTEN" | grep -q "0.0.0.0:$port\|*:$port"; then
            exposed_services+=("$port")
        fi
    done
    if [ ${#exposed_services[@]} -eq 0 ]; then
        pass "Internal services: not exposed on 0.0.0.0"
    else
        fail "Internal services exposed" "ports ${exposed_services[*]} on 0.0.0.0"
    fi

    # Keychain secrets present
    local secrets=(
        "postgres-password"
        "authentik-secret"
        "cloudflare-tunnel-token"
    )
    local missing=0
    for secret in "${secrets[@]}"; do
        if ! security find-generic-password -s "rainbow-$secret" -w &>/dev/null 2>&1; then
            missing=$((missing + 1))
        fi
    done
    if [ "$missing" -eq 0 ]; then
        pass "Keychain secrets: all ${#secrets[@]} critical secrets present"
    else
        fail "Keychain secrets" "$missing of ${#secrets[@]} missing"
    fi

    # No plaintext passwords in config
    if grep -r "password.*=" "$PROJECT_ROOT/config/rainbow.yaml" 2>/dev/null | grep -v "^#" | grep -qv '""'; then
        fail "Config security" "possible plaintext password in rainbow.yaml"
    else
        pass "Config security: no plaintext passwords in rainbow.yaml"
    fi

    # .env file permissions
    local env_file="$PROJECT_ROOT/infrastructure/.env"
    if [ -f "$env_file" ]; then
        local perms
        perms=$(stat -f "%Lp" "$env_file" 2>/dev/null || stat -c "%a" "$env_file" 2>/dev/null || echo "")
        if [ "$perms" = "600" ] || [ "$perms" = "644" ]; then
            pass ".env file permissions: $perms"
        else
            warn ".env file permissions" "$perms (recommend 600)"
        fi
    fi
}

# ─── Run tests ───────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${BOLD}Rainbow Integration Test Suite${NC}"
    echo -e "${DIM}Domain: $DOMAIN${NC}"
    echo -e "${DIM}Config: $CONFIG_FILE${NC}"
    if $QUICK; then
        echo -e "${DIM}Mode: quick (skipping slow tests)${NC}"
    fi
    echo ""

    local start_time
    start_time=$(date +%s)

    # Run selected section or all
    if [ -n "$SECTION" ]; then
        case "$SECTION" in
            prereq*)    test_prerequisites ;;
            container*) test_containers ;;
            native*)    test_native_services ;;
            http*)      test_http_endpoints ;;
            dns)        test_dns ;;
            tunnel)     test_tunnel ;;
            email)      test_email ;;
            photo*)     test_photos ;;
            file*)      test_files ;;
            doc*)       test_docs ;;
            media)      test_media ;;
            auth*)      test_auth ;;
            mine*)      test_minecraft ;;
            backup*)    test_backups ;;
            ddns)       test_ddns ;;
            mcp)        test_mcp ;;
            db|data*)   test_database ;;
            secur*)     test_security ;;
            *)
                echo "Unknown section: $SECTION" >&2
                echo "Available: prerequisites, containers, native, http, dns, tunnel," >&2
                echo "  email, photos, files, docs, media, auth, minecraft, backups," >&2
                echo "  ddns, mcp, database, security" >&2
                exit 1
                ;;
        esac
    else
        test_prerequisites
        test_containers
        test_native_services
        test_http_endpoints
        test_database
        test_dns
        test_tunnel
        test_email
        test_photos
        test_files
        test_docs
        test_media
        test_auth
        test_minecraft
        test_backups
        test_ddns
        test_mcp
        test_security
    fi

    # ─── Summary ─────────────────────────────────────────────────
    local end_time
    end_time=$(date +%s)
    local duration=$((end_time - start_time))

    echo ""
    echo -e "${BOLD}═══════════════════════════════════════════${NC}"
    echo -e "${BOLD}Test Summary${NC}"
    echo -e "${BOLD}═══════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${GREEN}Passed:${NC}   $PASS_COUNT"
    echo -e "  ${RED}Failed:${NC}   $FAIL_COUNT"
    echo -e "  ${YELLOW}Warnings:${NC} $WARN_COUNT"
    echo -e "  ${YELLOW}Skipped:${NC}  $SKIP_COUNT"
    echo -e "  ${DIM}Duration: ${duration}s${NC}"
    echo ""

    local total=$((PASS_COUNT + FAIL_COUNT))
    if [ "$FAIL_COUNT" -eq 0 ]; then
        echo -e "  ${GREEN}${BOLD}All $total tests passed.${NC}"
    else
        echo -e "  ${RED}${BOLD}$FAIL_COUNT of $total tests failed.${NC}"

        # Print just the failures
        echo ""
        echo -e "${BOLD}Failures:${NC}"
        for result in "${RESULTS[@]}"; do
            if echo -e "$result" | grep -q "FAIL"; then
                echo -e "  $result"
            fi
        done
    fi

    echo ""

    if [ "$FAIL_COUNT" -gt 0 ]; then
        exit 1
    fi
}

main
