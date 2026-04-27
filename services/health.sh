#!/usr/bin/env bash
#
# health.sh — Check health of all Rainbow services.
# Returns exit code 0 if all healthy, 1 if any unhealthy.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

all_healthy=true

check_http() {
    local name="$1"
    local url="$2"
    local expected="${3:-200}"

    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")

    if [ "$status" = "$expected" ] || [ "$status" = "301" ] || [ "$status" = "302" ]; then
        printf "  %-25s ${GREEN}healthy${NC} (HTTP %s)\n" "$name" "$status"
    else
        printf "  %-25s ${RED}unhealthy${NC} (HTTP %s)\n" "$name" "$status"
        all_healthy=false
    fi
}

check_tcp() {
    local name="$1"
    local host="$2"
    local port="$3"

    if nc -z -w 3 "$host" "$port" 2>/dev/null; then
        printf "  %-25s ${GREEN}healthy${NC} (port %s open)\n" "$name" "$port"
    else
        printf "  %-25s ${RED}unhealthy${NC} (port %s closed)\n" "$name" "$port"
        all_healthy=false
    fi
}

check_process() {
    local name="$1"
    local pattern="$2"

    if pgrep -f "$pattern" &>/dev/null; then
        printf "  %-25s ${GREEN}running${NC}\n" "$name"
    else
        printf "  %-25s ${YELLOW}not running${NC}\n" "$name"
    fi
}

echo "Rainbow Health Check"
echo "==================="
echo ""

echo "Docker Services:"
check_http "Caddy"          "http://127.0.0.1:80"
check_http "Authentik"      "http://127.0.0.1:9000/-/health/ready/"
check_http "Immich"         "http://127.0.0.1:2283/api/server/ping"
check_http "CryptPad"       "http://127.0.0.1:3000"
check_http "Seafile"        "http://127.0.0.1:8082"
check_tcp  "PostgreSQL"     "127.0.0.1" 5432
check_tcp  "Redis"          "127.0.0.1" 6379

echo ""
echo "Native Services:"
check_process "Stalwart Mail" "stalwart-mail"
check_http    "Stalwart HTTP" "http://127.0.0.1:8080"
check_process "Jellyfin"      "jellyfin"
check_http    "Jellyfin HTTP" "http://127.0.0.1:8096"
check_process "Minecraft"     "paper.*\.jar"

echo ""

if $all_healthy; then
    echo -e "${GREEN}All monitored services are healthy.${NC}"
    exit 0
else
    echo -e "${RED}Some services are unhealthy.${NC}"
    exit 1
fi
