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

# Check whether a container exists (any state). `container inspect` always
# exits 0 — it returns `[]` for unknown names and a populated JSON array for
# known ones, so we test the body for an `id` field.
container_exists() {
    container inspect "$1" 2>/dev/null | grep -q '"id"'
}

# Ensure a container network exists.
ensure_network() {
    local name="$1"
    if ! container network list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$name"; then
        orch_info "Creating network: $name"
        container network create "$name" >/dev/null
    fi
}

# Stop+remove a container by name, then run a fresh one. The unconditional
# delete sidesteps a race where `container ls --format json` sometimes doesn't
# reflect a stopped container that still holds its name.
# Usage: replace_container <name> <container-run-args...>
replace_container() {
    local name="$1"; shift
    container delete --force "$name" >/dev/null 2>&1 || true
    container run -d --name "$name" "$@"
}

# Ensure a named volume exists. Apple Container's named volumes are owned by
# the in-VM root user, which lets services (postgres, valkey) chown them on
# first run — bind mounts to host paths can't be chowned and break those images.
ensure_volume() {
    local name="$1"
    if ! container volume list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$name"; then
        container volume create "$name" >/dev/null
    fi
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

# Source generated infrastructure/.env into the current shell so environment
# values (passwords, etc.) populated by generate-config.sh from the Keychain
# are available for --env arguments below.
load_env() {
    if [ -f "$INFRA_DIR/.env" ]; then
        set -a
        # shellcheck disable=SC1090
        source "$INFRA_DIR/.env"
        set +a
    fi
}

start_postgres() {
    orch_info "Starting Postgres..."
    : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD missing — run make setup}"
    ensure_volume rainbow-postgres-data
    # PGDATA points at a subdir because Apple Container's volumes have a
    # lost+found entry from their ext4 backing, and initdb refuses to use a
    # non-empty mount root.
    #
    # We use Immich's official postgres image (pg14 + VectorChord + pgvecto-rs)
    # because Immich requires a vector extension. Other services (Authentik,
    # Seafile, etc.) work on pg14 just as well; they don't use the extensions.
    replace_container rainbow-postgres \
        --network backend \
        --env "POSTGRES_USER=${POSTGRES_USER:-rainbow}" \
        --env "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" \
        --env "POSTGRES_DB=rainbow" \
        --env "PGDATA=/var/lib/postgresql/data/pgdata" \
        --mount "type=volume,source=rainbow-postgres-data,target=/var/lib/postgresql/data" \
        --volume "$INFRA_DIR/postgres/init:/docker-entrypoint-initdb.d:ro" \
        ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0 \
        >/dev/null
}

start_valkey() {
    orch_info "Starting Valkey..."
    ensure_volume rainbow-valkey-data
    replace_container rainbow-valkey \
        --network backend \
        --mount "type=volume,source=rainbow-valkey-data,target=/data" \
        docker.io/valkey/valkey:8-alpine \
        valkey-server --save 60 1 --loglevel warning \
        >/dev/null
}

start_authentik_server() {
    local postgres_ip="$1" valkey_ip="$2"
    orch_info "Starting Authentik server..."
    ensure_volume rainbow-authentik-media
    ensure_volume rainbow-authentik-templates
    compile_authentik_env "$postgres_ip" "$valkey_ip"
    replace_container rainbow-authentik-server \
        --network frontend \
        --network backend \
        --env-file "$INFRA_DIR/authentik/.env.compiled" \
        --mount "type=volume,source=rainbow-authentik-media,target=/media" \
        --mount "type=volume,source=rainbow-authentik-templates,target=/templates" \
        ghcr.io/goauthentik/server:latest \
        server \
        >/dev/null
}

start_immich_ml() {
    orch_info "Starting Immich ML..."
    ensure_volume rainbow-immich-model-cache
    replace_container rainbow-immich-ml \
        --network backend \
        --mount "type=volume,source=rainbow-immich-model-cache,target=/cache" \
        ghcr.io/immich-app/immich-machine-learning:release \
        >/dev/null
}

start_immich_server() {
    local postgres_ip="$1" valkey_ip="$2" ml_ip="$3"
    orch_info "Starting Immich server..."
    ensure_volume rainbow-immich-upload
    compile_immich_env "$postgres_ip" "$valkey_ip" "$ml_ip"
    replace_container rainbow-immich \
        --network frontend \
        --network backend \
        --env-file "$INFRA_DIR/immich/.env.compiled" \
        --mount "type=volume,source=rainbow-immich-upload,target=/usr/src/app/upload" \
        ghcr.io/immich-app/immich-server:release \
        >/dev/null
}

# Render immich/.env.compiled with postgres/valkey/ML IPs substituted for the
# default service-name hostnames. Also disables OAuth if the client ID hasn't
# been provisioned yet — otherwise immich-server refuses to boot.
compile_immich_env() {
    local postgres_ip="$1" valkey_ip="$2" ml_ip="$3"
    local src="$INFRA_DIR/immich/.env"
    local dest="$INFRA_DIR/immich/.env.compiled"
    sed \
        -e "s|^DB_HOSTNAME=.*|DB_HOSTNAME=${postgres_ip}|" \
        -e "s|^REDIS_HOSTNAME=.*|REDIS_HOSTNAME=${valkey_ip}|" \
        -e "s|^IMMICH_MACHINE_LEARNING_URL=.*|IMMICH_MACHINE_LEARNING_URL=http://${ml_ip}:3003|" \
        "$src" > "$dest"
    if grep -q '^OAUTH_CLIENT_ID=$' "$dest"; then
        sed -i '' 's|^OAUTH_ENABLED=true|OAUTH_ENABLED=false|' "$dest"
    fi
}

start_authentik_worker() {
    orch_info "Starting Authentik worker..."
    # compile_authentik_env was already called by start_authentik_server.
    # Worker does NOT mount the media/templates volumes — Apple Container can't
    # share a named volume between two running containers (VZ storage device
    # error). Worker functions without them; if a feature breaks (e.g. custom
    # email templates), revisit with bind-mounts to a shared host directory.
    replace_container rainbow-authentik-worker \
        --network backend \
        --env-file "$INFRA_DIR/authentik/.env.compiled" \
        ghcr.io/goauthentik/server:latest \
        worker \
        >/dev/null
}

# Render authentik/.env.compiled with postgres/valkey IPs substituted for the
# `postgres`/`redis` hostnames (Apple Container has no DNS-by-name).
compile_authentik_env() {
    local postgres_ip="$1" valkey_ip="$2"
    local src="$INFRA_DIR/authentik/.env"
    local dest="$INFRA_DIR/authentik/.env.compiled"
    sed \
        -e "s|^AUTHENTIK_POSTGRESQL__HOST=.*|AUTHENTIK_POSTGRESQL__HOST=${postgres_ip}|" \
        -e "s|^AUTHENTIK_REDIS__HOST=.*|AUTHENTIK_REDIS__HOST=${valkey_ip}|" \
        "$src" > "$dest"
}

# Render infrastructure/caddy/Caddyfile.compiled with name:port references
# substituted for IP:port. Args: name=ip pairs for services we know are up.
# Services we don't pass stay name-based and will 502 at request time — which
# is the dev experience we want until they're implemented.
compile_caddyfile() {
    local src="$INFRA_DIR/caddy/Caddyfile"
    local dest="$INFRA_DIR/caddy/Caddyfile.compiled"
    cp "$src" "$dest"
    while [ $# -gt 0 ]; do
        local pair="$1"; shift
        local name="${pair%%=*}"
        local ip="${pair#*=}"
        sed -i '' -e "s|${name}:|${ip}:|g" "$dest"
    done
}

start_caddy() {
    orch_info "Starting Caddy..."
    ensure_volume rainbow-caddy-data
    ensure_volume rainbow-caddy-config
    # Use the IP-substituted Caddyfile rendered by compile_caddyfile().
    # Falls back to the un-substituted Caddyfile if compile hasn't run yet.
    local caddyfile="$INFRA_DIR/caddy/Caddyfile.compiled"
    [ -f "$caddyfile" ] || caddyfile="$INFRA_DIR/caddy/Caddyfile"
    replace_container rainbow-caddy \
        --network frontend \
        --volume "$caddyfile:/etc/caddy/Caddyfile:ro" \
        --mount "type=volume,source=rainbow-caddy-data,target=/data" \
        --mount "type=volume,source=rainbow-caddy-config,target=/config" \
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

# Bring up the core services: postgres, valkey, caddy, cloudflared.
# These are the data plane (postgres/valkey) and ingress (caddy/cloudflared)
# layers that everything else builds on. App services (authentik, immich, ...)
# come on top in later phases.
start_minimum() {
    load_env
    ensure_network frontend
    ensure_network backend

    start_postgres
    local postgres_ip
    postgres_ip=$(wait_for_ip rainbow-postgres) || { orch_err "postgres has no IP"; return 1; }

    start_valkey
    local valkey_ip
    valkey_ip=$(wait_for_ip rainbow-valkey) || { orch_err "valkey has no IP"; return 1; }

    start_authentik_server "$postgres_ip" "$valkey_ip"
    start_authentik_worker
    local authentik_ip
    authentik_ip=$(wait_for_ip rainbow-authentik-server) \
        || { orch_err "authentik-server has no IP"; return 1; }
    orch_ok "Authentik IP: $authentik_ip (~1 min to finish DB migrations)"

    start_immich_ml
    local immich_ml_ip
    immich_ml_ip=$(wait_for_ip rainbow-immich-ml) \
        || { orch_err "immich-ml has no IP"; return 1; }

    start_immich_server "$postgres_ip" "$valkey_ip" "$immich_ml_ip"
    local immich_ip
    immich_ip=$(wait_for_ip rainbow-immich) \
        || { orch_err "immich-server has no IP"; return 1; }
    orch_ok "Immich IP: $immich_ip (~1 min to finish DB migrations)"

    compile_caddyfile \
        "authentik-server=$authentik_ip" \
        "immich-server=$immich_ip"
    start_caddy
    local caddy_ip
    caddy_ip=$(wait_for_ip rainbow-caddy) || { orch_err "caddy has no IP"; return 1; }
    orch_ok "Caddy IP: $caddy_ip"

    start_cloudflared "$caddy_ip" || return 1
    orch_ok "cloudflared started."

    local prefix zone host_prefix
    prefix=$(yq eval '.domain.prefix' "$CONFIG_FILE")
    zone=$(yq eval '.domain.zone' "$CONFIG_FILE")
    [ "$prefix" = "null" ] && prefix=""
    [ -n "$prefix" ] && host_prefix="${prefix}-" || host_prefix=""
    echo ""
    echo "  Routes through tunnel (HTTPS via Cloudflare's Universal SSL):"
    echo "    curl https://${host_prefix}app.${zone}    # caddy welcome page"
    echo "    curl https://${host_prefix}auth.${zone}   # authentik (after ~1 min boot)"
    echo ""
    echo "  Other service routes (photos, mail, files, ...) will 502 until those"
    echo "  containers exist."
}

RAINBOW_CONTAINERS=(
    rainbow-cloudflared
    rainbow-caddy
    rainbow-authentik-server
    rainbow-authentik-worker
    rainbow-postgres
    rainbow-valkey
    rainbow-immich
    rainbow-immich-ml
    rainbow-cryptpad
    rainbow-seafile
)

stop_all() {
    for name in "${RAINBOW_CONTAINERS[@]}"; do
        if container_exists "$name"; then
            orch_info "Stopping $name..."
            container stop "$name" >/dev/null 2>&1 || true
        fi
    done
    orch_ok "All container services stopped."
}

remove_all() {
    stop_all
    for name in "${RAINBOW_CONTAINERS[@]}"; do
        if container_exists "$name"; then
            container delete --force "$name" >/dev/null 2>&1 || true
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
