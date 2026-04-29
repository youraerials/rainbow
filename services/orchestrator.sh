#!/usr/bin/env bash
#
# orchestrator.sh — Bring up Rainbow's container services using `container run`
# directly (Apple Container), bypassing container-compose.
#
# Two-phase startup:
#   1. Start each container in dependency order; capture each container's IP
#   2. Render IP-aware configs (Caddyfile, cloudflared config.yml) substituting
#      service names with the IPs we collected, then restart Caddy / cloudflared
#      so they pick up the rewritten configs.
#
# Why: Apple Container has no built-in DNS-by-name between containers, so the
# `reverse_proxy authentik-server:9000` style references in our Caddyfile would
# never resolve. Rewriting names → IPs at runtime sidesteps that limitation.

set -euo pipefail

ORCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAINBOW_ROOT="$(cd "$ORCH_DIR/.." && pwd)"
INFRA_DIR="$RAINBOW_ROOT/infrastructure"
CONFIG_FILE="$RAINBOW_ROOT/config/rainbow.yaml"
APPDATA="$HOME/Library/Application Support/Rainbow"

# ─── Colors ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

orch_info() { echo -e "${BLUE}[orch]${NC} $*"; }
orch_ok()   { echo -e "${GREEN}[orch]${NC} $*"; }
orch_warn() { echo -e "${YELLOW}[orch]${NC} $*"; }
orch_err()  { echo -e "${RED}[orch]${NC} $*" >&2; }

# ─── Helpers ─────────────────────────────────────────────────────

# Get a container's primary IPv4 address (without /24 suffix).
container_ip() {
    local name="$1"
    container inspect "$name" 2>/dev/null \
        | yq -p=json '.[0].networks[0].ipv4Address // ""' 2>/dev/null \
        | sed 's|/.*||' \
        | head -n1
}

# Check whether a container exists (any state).
container_exists() {
    local name="$1"
    container ls -a --format json 2>/dev/null \
        | yq -p=json '.[].configuration.id // ""' 2>/dev/null \
        | grep -qx "$name"
}

# Ensure a container network exists.
ensure_network() {
    local name="$1"
    if ! container network list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$name"; then
        orch_info "Creating network: $name"
        container network create "$name" >/dev/null
    fi
}

# Stop+remove a container if it exists, then run a fresh one.
# Usage: replace_container <name> <container-run-args...>
replace_container() {
    local name="$1"; shift
    if container_exists "$name"; then
        container stop "$name" >/dev/null 2>&1 || true
        container delete "$name" >/dev/null 2>&1 || true
    fi
    container run -d --name "$name" "$@"
}

# Wait until a container reports an IP (bounded poll).
wait_for_ip() {
    local name="$1"
    local tries="${2:-20}"
    local ip=""
    for _ in $(seq 1 "$tries"); do
        ip=$(container_ip "$name")
        [ -n "$ip" ] && { echo "$ip"; return 0; }
        sleep 0.5
    done
    return 1
}

# ─── Service definitions ─────────────────────────────────────────
# Each start_<service>() launches a single container. They're factored so the
# top-level start_minimum() and (later) start_full() can pick which to bring up.

start_caddy() {
    orch_info "Starting Caddy..."
    mkdir -p "$APPDATA/caddy/data" "$APPDATA/caddy/config"
    replace_container rainbow-caddy \
        --network frontend \
        --volume "$INFRA_DIR/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
        --volume "$APPDATA/caddy/data:/data" \
        --volume "$APPDATA/caddy/config:/config" \
        docker.io/library/caddy:2-alpine \
        >/dev/null
}

start_cloudflared() {
    local caddy_ip="$1"
    local tunnel_id
    tunnel_id=$(yq eval '.cloudflare.tunnel_id' "$CONFIG_FILE")
    if [ -z "$tunnel_id" ] || [ "$tunnel_id" = "null" ]; then
        orch_err "cloudflare.tunnel_id missing from $CONFIG_FILE — run setup-test-tunnel first"
        return 1
    fi
    local creds="$HOME/.cloudflared/${tunnel_id}.json"
    if [ ! -f "$creds" ]; then
        orch_err "Tunnel credentials not found at $creds — re-run setup-test-tunnel"
        return 1
    fi

    # Render a compiled config.yml that uses caddy's IP and points to the
    # in-container credentials path.
    local src="$INFRA_DIR/cloudflared/config.yml"
    local compiled="$INFRA_DIR/cloudflared/config.compiled.yml"
    sed -e "s|http://caddy:80|http://${caddy_ip}:80|g" "$src" > "$compiled"
    # Append credentials-file pointer if not present.
    if ! grep -q '^credentials-file:' "$compiled"; then
        # Insert after the tunnel: line.
        sed -i '' "/^tunnel:/a\\
credentials-file: /etc/cloudflared/credentials.json
" "$compiled"
    fi

    orch_info "Starting cloudflared (caddy ingress -> $caddy_ip:80)..."
    replace_container rainbow-cloudflared \
        --network frontend \
        --volume "$compiled:/etc/cloudflared/config.yml:ro" \
        --volume "$creds:/etc/cloudflared/credentials.json:ro" \
        docker.io/cloudflare/cloudflared:latest \
        tunnel --config /etc/cloudflared/config.yml run \
        >/dev/null
}

# ─── Top-level entrypoints ───────────────────────────────────────

# Bring up the smallest possible stack: Caddy + cloudflared. Used to verify the
# tunnel→reverse-proxy plumbing without depending on any backend services.
start_minimum() {
    ensure_network frontend
    ensure_network backend

    start_caddy
    local caddy_ip
    if ! caddy_ip=$(wait_for_ip rainbow-caddy); then
        orch_err "Caddy started but never reported an IP."
        return 1
    fi
    orch_ok "Caddy IP: $caddy_ip"

    start_cloudflared "$caddy_ip" || return 1
    orch_ok "cloudflared started."

    echo ""
    echo "  Test from another machine:"
    echo "    curl -v https://$(yq eval '.domain.primary' "$CONFIG_FILE")"
    echo ""
    echo "  Expected: a response from Caddy through Cloudflare Tunnel."
    echo "  Backends aren't running yet, so service routes may return 502 — that's"
    echo "  fine; what matters is that you reach Caddy at all."
}

stop_all() {
    for name in rainbow-cloudflared rainbow-caddy \
                rainbow-postgres rainbow-valkey \
                rainbow-authentik-server rainbow-authentik-worker \
                rainbow-immich rainbow-immich-ml \
                rainbow-cryptpad rainbow-seafile; do
        if container_exists "$name"; then
            orch_info "Stopping $name..."
            container stop "$name" >/dev/null 2>&1 || true
        fi
    done
    orch_ok "All container services stopped."
}

remove_all() {
    stop_all
    for name in rainbow-cloudflared rainbow-caddy \
                rainbow-postgres rainbow-valkey \
                rainbow-authentik-server rainbow-authentik-worker \
                rainbow-immich rainbow-immich-ml \
                rainbow-cryptpad rainbow-seafile; do
        if container_exists "$name"; then
            container delete "$name" >/dev/null 2>&1 || true
        fi
    done
    orch_ok "All container services removed."
}

# ─── Dispatch ────────────────────────────────────────────────────
case "${1:-}" in
    minimum)  start_minimum ;;
    stop)     stop_all ;;
    remove)   remove_all ;;
    "")
        echo "Usage: $0 <minimum|stop|remove>" >&2
        exit 1
        ;;
    *)
        echo "Unknown command: $1" >&2
        exit 1
        ;;
esac
