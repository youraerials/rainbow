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

# A container's reachable-from-the-host-via-loopback isn't what we
# need. Apple Container's vmnet plugin gives each network a gateway
# IP that's actually a bridge interface ON THE HOST — `bridge100` etc.
# host_ip_for_network "frontend" returns that gateway IP, which is
# what containers attached to frontend should use as RAINBOW_CONTROL_URL
# to reach the host control daemon. Apple Container doesn't auto-
# provide host.docker.internal so we have to wire this up ourselves.
host_ip_for_network() {
    local net="$1"
    container network inspect "$net" 2>/dev/null \
        | yq -p=json '.[0].status.ipv4Gateway // ""' 2>/dev/null \
        | sed 's|/.*||' \
        | head -n1
}

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

# Capture the Keychain entries that get baked into rainbow-web's env
# at run-time. Used by start_minimum to detect "did the post-start
# hooks just provision new API keys?" — if the snapshot before
# start_web differs from the snapshot after the hooks, we recreate
# the web container so the new creds take effect (Apple Container
# freezes env at run-time; a restart alone won't pick them up).
snapshot_web_creds() {
    local entries=(
        rainbow-immich-api-key
        rainbow-jellyfin-api-key
        rainbow-seafile-api-token
        rainbow-stalwart-jmap-user
        rainbow-stalwart-jmap-password
        rainbow-oauth-web-client-id
        rainbow-oauth-web-client-secret
    )
    local s
    for s in "${entries[@]}"; do
        printf '%s=%s\n' "$s" \
            "$(security find-generic-password -s "$s" -w 2>/dev/null || echo '')"
    done
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

start_mariadb() {
    orch_info "Starting MariaDB (for Seafile)..."
    : "${MARIADB_ROOT_PASSWORD:?MARIADB_ROOT_PASSWORD missing — run make setup}"
    ensure_volume rainbow-mariadb-data
    # MARIADB_ROOT_HOST=% lets root connect from any container IP — without it,
    # MariaDB only accepts root from localhost, and Seafile (on a different
    # container) gets "Host 'X.Y.Z.W' is not allowed". Backend network is the
    # security boundary here, not MariaDB's host ACL.
    replace_container rainbow-mariadb \
        --network backend \
        --env "MARIADB_ROOT_PASSWORD=${MARIADB_ROOT_PASSWORD}" \
        --env "MARIADB_ROOT_HOST=%" \
        --mount "type=volume,source=rainbow-mariadb-data,target=/var/lib/mysql" \
        docker.io/library/mariadb:11 \
        >/dev/null
}

start_seafile() {
    local mariadb_ip="$1"
    orch_info "Starting Seafile..."
    ensure_volume rainbow-seafile-data
    compile_seafile_env "$mariadb_ip"
    replace_container rainbow-seafile \
        --network frontend \
        --network backend \
        --env-file "$INFRA_DIR/seafile/.env.compiled" \
        --mount "type=volume,source=rainbow-seafile-data,target=/shared" \
        docker.io/seafileltd/seafile-mc:latest \
        >/dev/null
}

# Render seafile/.env.compiled with the MariaDB container's IP substituted for
# the placeholder `DB_HOST=mariadb`.
compile_seafile_env() {
    local mariadb_ip="$1"
    local src="$INFRA_DIR/seafile/.env"
    local dest="$INFRA_DIR/seafile/.env.compiled"
    sed -e "s|^DB_HOST=.*|DB_HOST=${mariadb_ip}|" "$src" > "$dest"
}

start_stalwart() {
    orch_info "Starting Stalwart mail server..."
    # Stalwart writes data to two paths inside the container:
    #   - /opt/stalwart/etc/config.json — bootstrap config the wizard creates
    #   - /var/lib/stalwart/             — RocksDB data dir (the wizard's default)
    # Both must be persistent. We bind-mount the image's working directory
    # `/var/lib/stalwart` to a host subdir so the wizard's default RocksDB path
    # lands on disk and survives container recreate. Without this second
    # mount, every `make start` wipes the wizard's account data — RocksDB sits
    # in the container's writable layer, which is gone after `container delete`.
    #
    # First-run setup is web-driven (see services/stalwart/README.md). The
    # image's default args are `--config /etc/stalwart/config.json` (a path
    # that doesn't exist on a fresh image), so we override to point inside the
    # bind-mount. On first start Stalwart enters bootstrap mode → user
    # completes the wizard at <prefix>-mail/admin/ → wizard writes config.json
    # and seeds the RocksDB → all subsequent restarts skip bootstrap.
    local data_dir="$APPDATA/stalwart"
    mkdir -p "$data_dir/etc" "$data_dir/db"
    chmod -R u+rwX "$data_dir" 2>/dev/null || true
    replace_container rainbow-stalwart \
        --network frontend \
        --volume "$data_dir:/opt/stalwart" \
        --volume "$data_dir/db:/var/lib/stalwart" \
        docker.io/stalwartlabs/stalwart:latest \
        --config /opt/stalwart/etc/config.json \
        >/dev/null
}

start_web() {
    orch_info "Starting Rainbow web tier..."
    # The web container hosts dashboard SPA + REST API + MCP gateway +
    # user-generated apps. dashboard/dist is bind-mounted so UI iteration
    # doesn't require rebuilding the image. apps/ persists user-generated apps.
    local apps_dir="$APPDATA/web-apps"
    mkdir -p "$apps_dir"
    if [ ! -f "$RAINBOW_ROOT/dashboard/dist/index.html" ]; then
        orch_warn "dashboard/dist not built — UI will 404 (cd dashboard && npm run build)"
    fi

    # OIDC config: client_id/secret are minted by setup-providers.sh into
    # Keychain. Without them the web tier exits at startup, so this is a hard
    # dependency on having run setup-providers first.
    local web_client_id web_client_secret
    web_client_id=$(security find-generic-password -s rainbow-oauth-web-client-id -w 2>/dev/null || echo "")
    web_client_secret=$(security find-generic-password -s rainbow-oauth-web-client-secret -w 2>/dev/null || echo "")
    if [ -z "$web_client_id" ] || [ -z "$web_client_secret" ]; then
        orch_warn "OIDC credentials missing for web tier — run services/authentik/setup-providers.sh"
        orch_warn "rainbow-web will fail to start until that's done."
    fi

    # Per-service API keys for the MCP tools. Provisioned by each service's
    # post-start setup hook (immich/setup.sh, seafile/setup.sh, jellyfin/setup.sh).
    # Missing keys aren't fatal — the corresponding tools will return errors.
    local immich_api_key seafile_api_token jellyfin_api_key
    immich_api_key=$(security find-generic-password -s rainbow-immich-api-key -w 2>/dev/null || echo "")
    seafile_api_token=$(security find-generic-password -s rainbow-seafile-api-token -w 2>/dev/null || echo "")
    jellyfin_api_key=$(security find-generic-password -s rainbow-jellyfin-api-key -w 2>/dev/null || echo "")

    # Stalwart JMAP credentials. Stalwart 0.16's first-run wizard is web-driven
    # (see services/stalwart/README.md); the user creates a JMAP account
    # interactively and stores its login here. mcp-email refuses to register
    # tools when these are absent.
    local stalwart_jmap_user stalwart_jmap_password
    stalwart_jmap_user=$(security find-generic-password -s rainbow-stalwart-jmap-user -w 2>/dev/null || echo "")
    stalwart_jmap_password=$(security find-generic-password -s rainbow-stalwart-jmap-password -w 2>/dev/null || echo "")

    # Inbound-mail HMAC shared secret. Cloudflare Email Worker signs the
    # webhook body with this; web tier verifies. Auto-mint if absent so a
    # fresh install has a working secret without manual provisioning. The
    # SAME value must be set as a Worker secret via wrangler.
    local inbound_mail_secret
    inbound_mail_secret=$(security find-generic-password -s rainbow-inbound-mail-secret -w 2>/dev/null || echo "")
    if [ -z "$inbound_mail_secret" ]; then
        orch_info "Minting rainbow-inbound-mail-secret in Keychain..."
        inbound_mail_secret=$(openssl rand -hex 32)
        security add-generic-password \
            -s rainbow-inbound-mail-secret -a rainbow \
            -w "$inbound_mail_secret" -U
    fi

    # Postgres connection — web stores its own data (web_config, app
    # metadata + per-app key/value persistence) in a dedicated `rainbow_web`
    # database. Connecting on the backend network requires we join it.
    local postgres_ip
    postgres_ip=$(container_ip rainbow-postgres 2>/dev/null || echo "")

    # Host control daemon: lets the dashboard restart/stop/start containers
    # and tail logs without giving the web tier the `container` CLI itself.
    # The daemon runs on the host (services/control/install.sh) and listens
    # on :9001 of every interface. Apple Container 0.11 doesn't provide
    # host.docker.internal, so we use the `frontend` network's gateway IP
    # — which is the host's bridge interface for that subnet, reachable
    # from any container attached to frontend.
    local control_token control_host
    control_token=$(security find-generic-password -s rainbow-control-token -w 2>/dev/null || echo "")
    if [ -z "$control_token" ]; then
        orch_warn "rainbow-control-token not in Keychain — service restart/logs from dashboard will be unavailable."
        orch_warn "Run services/control/install.sh on the host to enable."
    fi
    control_host=$(host_ip_for_network frontend)
    if [ -z "$control_host" ]; then
        orch_warn "couldn't resolve frontend network gateway — falling back to host.docker.internal"
        control_host="host.docker.internal"
    fi

    replace_container rainbow-web \
        --network frontend \
        --network backend \
        --env "RAINBOW_HOST_PREFIX=${RAINBOW_HOST_PREFIX:-}" \
        --env "RAINBOW_ZONE=${RAINBOW_ZONE:-}" \
        --env "RAINBOW_WEB_HOST=${RAINBOW_WEB_HOST:-}" \
        --env "RAINBOW_OAUTH_CLIENT_ID=${web_client_id}" \
        --env "RAINBOW_OAUTH_CLIENT_SECRET=${web_client_secret}" \
        --env "IMMICH_API_KEY=${immich_api_key}" \
        --env "SEAFILE_API_TOKEN=${seafile_api_token}" \
        --env "JELLYFIN_API_KEY=${jellyfin_api_key}" \
        --env "STALWART_JMAP_USER=${stalwart_jmap_user}" \
        --env "STALWART_JMAP_PASSWORD=${stalwart_jmap_password}" \
        --env "RAINBOW_INBOUND_MAIL_SECRET=${inbound_mail_secret}" \
        --env "POSTGRES_HOST=${postgres_ip}" \
        --env "POSTGRES_PORT=5432" \
        --env "POSTGRES_USER=${POSTGRES_USER:-rainbow}" \
        --env "POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-}" \
        --env "POSTGRES_WEB_DB=rainbow_web" \
        --env "RAINBOW_CONTROL_URL=http://${control_host}:9001" \
        --env "RAINBOW_CONTROL_TOKEN=${control_token}" \
        --volume "$RAINBOW_ROOT/dashboard/dist:/usr/share/web/dashboard:ro" \
        --volume "$apps_dir:/var/lib/rainbow/apps" \
        rainbow-web:latest \
        >/dev/null
}

start_webmail() {
    orch_info "Starting webmail (Snappymail)..."
    # Snappymail is a PHP/JS webmail SPA — talks IMAP+SMTP-submission over
    # the frontend network to the Stalwart container. No DB; settings live in
    # a small data volume so admin config + per-user state survive restarts.
    # The image's actual data dir is /var/lib/snappymail/_data_ (NOT
    # /snappymail/data, which is a leftover path that doesn't get used) —
    # make sure the mount target matches or login state and per-domain
    # config get wiped on every container recreate.
    # The post-start hook services/webmail/setup.sh pre-seeds a domain config
    # pointing at Stalwart's current IP so users don't need admin-panel setup.
    ensure_volume rainbow-webmail-data
    replace_container rainbow-webmail \
        --network frontend \
        --mount "type=volume,source=rainbow-webmail-data,target=/var/lib/snappymail/_data_" \
        docker.io/djmaze/snappymail:latest \
        >/dev/null
}

start_jellyfin() {
    orch_info "Starting Jellyfin..."
    ensure_volume rainbow-jellyfin-config
    ensure_volume rainbow-jellyfin-cache
    # Build optional read-only media mounts from rainbow.yaml. We can't chown
    # bind-mounts with Apple Container, so the host-side ownership controls
    # what Jellyfin can read; :ro avoids any need for write access.
    local media_mounts=()
    while IFS= read -r path; do
        [ -z "$path" ] && continue
        local expanded="${path/#\~/$HOME}"
        if [ -d "$expanded" ]; then
            media_mounts+=(--volume "$expanded:/media$(basename "$expanded"):ro")
        fi
    done < <(yq eval -o=tsv '.services.jellyfin.media_paths[]' "$CONFIG_FILE" 2>/dev/null || true)

    replace_container rainbow-jellyfin \
        --network frontend \
        --mount "type=volume,source=rainbow-jellyfin-config,target=/config" \
        --mount "type=volume,source=rainbow-jellyfin-cache,target=/cache" \
        "${media_mounts[@]}" \
        docker.io/jellyfin/jellyfin:latest \
        >/dev/null
}

start_cryptpad() {
    orch_info "Starting CryptPad..."
    ensure_volume rainbow-cryptpad-blob
    ensure_volume rainbow-cryptpad-block
    ensure_volume rainbow-cryptpad-data
    ensure_volume rainbow-cryptpad-datastore
    ensure_volume rainbow-cryptpad-config

    # Initialize the config volume with the image's example files
    # (config.example.js + sso.example.js — the image entrypoint
    # `cp`s from these) plus our rendered config.js. Done as an init
    # container instead of a single-file bind mount because Apple
    # Container 0.11's file bind mounts return EPERM mid-run; a
    # named volume populated up-front is reliable.
    #
    # Brand-CSS injection via a customize volume was attempted here in
    # 0.1.30 — `cp -r /cryptpad/customize.dist/.` to seed the override
    # volume with the image's defaults crashed Apple Container's
    # apiserver with NIOHTTP2 StreamClosed, presumably because
    # virtiofs choked on the file count. Reverted; CryptPad ships
    # un-themed for now. See config/brand/cryptpad.css for the CSS we
    # WANT to inject — needs a different mounting strategy.
    container delete --force rainbow-cryptpad-init >/dev/null 2>&1 || true
    container run --rm --name rainbow-cryptpad-init \
        --entrypoint /bin/sh \
        --mount "type=volume,source=rainbow-cryptpad-config,target=/dst" \
        --volume "$INFRA_DIR/cryptpad/customize:/src:ro" \
        docker.io/cryptpad/cryptpad:latest \
        -c 'cp /cryptpad/config/* /dst/ 2>/dev/null; cp /src/config.js /dst/config.js && chmod 644 /dst/config.js' \
        >/dev/null

    # CryptPad's entrypoint requires CPAD_CONF env to point at a config file;
    # without it the entrypoint silently corrupts (cp into empty path) and the
    # container exits before npm even starts. CPAD_MAIN_DOMAIN / SANDBOX_DOMAIN
    # are also required so the entrypoint can write them into the default config
    # if our mounted file is missing.
    local prefix zone host_prefix
    prefix=$(yq eval '.domain.prefix' "$CONFIG_FILE")
    zone=$(yq eval '.domain.zone' "$CONFIG_FILE")
    [ "$prefix" = "null" ] && prefix=""
    [ -n "$prefix" ] && host_prefix="${prefix}-" || host_prefix=""
    # CPAD_CONF tells the image's docker-entrypoint where the config
    # file lives. Without it (empty string), the entrypoint's
    # `if [ ! -f "$CPAD_CONF" ]` evaluates true, it runs
    # `cp config.example.js ""` which fails with "can't create ''",
    # and the container exits. With it set to a path that already
    # exists in our pre-populated volume, the entrypoint skips its
    # bootstrap branch entirely and uses our config.
    replace_container rainbow-cryptpad \
        --network frontend \
        --env "CPAD_CONF=/cryptpad/config/config.js" \
        --env "CPAD_MAIN_DOMAIN=https://${host_prefix}docs.${zone}" \
        --env "CPAD_SANDBOX_DOMAIN=https://${host_prefix}docs-sandbox.${zone}" \
        --mount "type=volume,source=rainbow-cryptpad-config,target=/cryptpad/config" \
        --mount "type=volume,source=rainbow-cryptpad-blob,target=/cryptpad/blob" \
        --mount "type=volume,source=rainbow-cryptpad-block,target=/cryptpad/block" \
        --mount "type=volume,source=rainbow-cryptpad-data,target=/cryptpad/data" \
        --mount "type=volume,source=rainbow-cryptpad-datastore,target=/cryptpad/datastore" \
        docker.io/cryptpad/cryptpad:latest \
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
    # The dashboard SPA is now served by the rainbow-web container, not by
    # Caddy directly — Caddy just reverse_proxies <prefix>-app.<zone> → web:47080.
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

    start_mariadb
    local mariadb_ip
    mariadb_ip=$(wait_for_ip rainbow-mariadb) || { orch_err "mariadb has no IP"; return 1; }

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

    start_cryptpad
    local cryptpad_ip
    cryptpad_ip=$(wait_for_ip rainbow-cryptpad) \
        || { orch_err "cryptpad has no IP"; return 1; }

    start_seafile "$mariadb_ip"
    local seafile_ip
    seafile_ip=$(wait_for_ip rainbow-seafile) \
        || { orch_err "seafile has no IP"; return 1; }
    orch_ok "Seafile IP: $seafile_ip (~1-2 min for first-run database init)"

    start_stalwart
    local stalwart_ip
    stalwart_ip=$(wait_for_ip rainbow-stalwart) \
        || { orch_err "stalwart has no IP"; return 1; }

    start_jellyfin
    local jellyfin_ip
    jellyfin_ip=$(wait_for_ip rainbow-jellyfin) \
        || { orch_err "jellyfin has no IP"; return 1; }

    start_webmail
    local webmail_ip
    webmail_ip=$(wait_for_ip rainbow-webmail) \
        || { orch_err "webmail has no IP"; return 1; }

    # Snapshot the Keychain entries that affect rainbow-web's MCP tools
    # BEFORE we bake env vars into the web container. We compare against
    # the same snapshot after the post-start hooks run; if anything new
    # appeared (api keys minted by services/{immich,jellyfin,seafile}/setup.sh),
    # we recreate rainbow-web so the freshly-minted creds take effect.
    local pre_web_creds
    pre_web_creds=$(snapshot_web_creds)

    start_web
    local web_ip
    web_ip=$(wait_for_ip rainbow-web) \
        || { orch_err "web has no IP"; return 1; }

    compile_caddyfile \
        "authentik-server=$authentik_ip" \
        "immich-server=$immich_ip" \
        "cryptpad=$cryptpad_ip" \
        "seafile=$seafile_ip" \
        "stalwart=$stalwart_ip" \
        "jellyfin=$jellyfin_ip" \
        "webmail=$webmail_ip" \
        "web=$web_ip"
    start_caddy
    local caddy_ip
    caddy_ip=$(wait_for_ip rainbow-caddy) || { orch_err "caddy has no IP"; return 1; }
    orch_ok "Caddy IP: $caddy_ip"

    start_cloudflared "$caddy_ip" || return 1
    orch_ok "cloudflared started."

    # Post-start hooks: configure each app's runtime settings via its own API
    # or via container exec. Idempotent and non-fatal — if a hook fails, the
    # stack itself stays up; the user can re-run the script directly.
    bash "$ORCH_DIR/seafile/setup.sh" || \
        orch_warn "seafile post-start setup failed (run services/seafile/setup.sh manually)"
    bash "$ORCH_DIR/immich/setup.sh" || \
        orch_warn "immich post-start setup failed (run services/immich/setup.sh manually)"
    bash "$ORCH_DIR/jellyfin/setup.sh" || \
        orch_warn "jellyfin post-start setup failed (run services/jellyfin/setup.sh manually)"
    bash "$ORCH_DIR/webmail/setup.sh" || \
        orch_warn "webmail post-start setup failed (run services/webmail/setup.sh manually)"

    # If the post-start hooks minted new API keys (first-install case),
    # rainbow-web's env vars are stale — Apple Container froze them at
    # run-time. Recreate it (gives a new IP) and recompile Caddy +
    # cloudflared to point at the new IP.
    local post_web_creds
    post_web_creds=$(snapshot_web_creds)
    if [ "$pre_web_creds" != "$post_web_creds" ]; then
        orch_info "API keys minted during post-start hooks — refreshing web tier..."
        start_web
        web_ip=$(wait_for_ip rainbow-web) \
            || { orch_err "web didn't come back after refresh"; return 1; }
        compile_caddyfile \
            "authentik-server=$authentik_ip" \
            "immich-server=$immich_ip" \
            "cryptpad=$cryptpad_ip" \
            "seafile=$seafile_ip" \
            "stalwart=$stalwart_ip" \
            "jellyfin=$jellyfin_ip" \
            "webmail=$webmail_ip" \
            "web=$web_ip"
        start_caddy
        caddy_ip=$(wait_for_ip rainbow-caddy) \
            || { orch_err "caddy didn't come back after refresh"; return 1; }
        start_cloudflared "$caddy_ip" || return 1
        orch_ok "Web tier refreshed."
    fi

    # Brand CSS: pushes config/brand/<service>.css into Immich,
    # Authentik, and Jellyfin via their admin APIs. Skips silently if a
    # service's creds aren't yet provisioned (first-run timing). Re-run
    # any time after design changes via `services/brand/apply.sh`.
    bash "$ORCH_DIR/brand/apply.sh" --quiet || \
        orch_warn "brand CSS apply failed (re-run services/brand/apply.sh manually)"

    local prefix zone host_prefix web_host
    prefix=$(yq eval '.domain.prefix' "$CONFIG_FILE")
    zone=$(yq eval '.domain.zone' "$CONFIG_FILE")
    [ "$prefix" = "null" ] && prefix=""
    if [ -n "$prefix" ]; then
        host_prefix="${prefix}-"
        web_host="${prefix}.${zone}"
    else
        host_prefix=""
        web_host="$zone"
    fi
    echo ""
    echo "  Routes through tunnel (HTTPS via Cloudflare's Universal SSL):"
    echo "    https://${web_host}                # dashboard (Rainbow web tier)"
    echo "    https://${host_prefix}auth.${zone}   # Authentik"
    echo "    https://${host_prefix}photos.${zone} # Immich"
    echo "    https://${host_prefix}files.${zone}  # Seafile"
    echo "    https://${host_prefix}docs.${zone}   # CryptPad"
    echo "    https://${host_prefix}media.${zone}  # Jellyfin"
    echo "    https://${host_prefix}mail.${zone}   # Stalwart"
}

RAINBOW_CONTAINERS=(
    rainbow-cloudflared
    rainbow-caddy
    rainbow-web
    rainbow-authentik-server
    rainbow-authentik-worker
    rainbow-postgres
    rainbow-valkey
    rainbow-mariadb
    rainbow-immich
    rainbow-immich-ml
    rainbow-cryptpad
    rainbow-seafile
    rainbow-stalwart
    rainbow-jellyfin
    rainbow-webmail
)

# Recreate one container with fresh env from the current Keychain + .env.
# Used by the host control daemon so that "Restart" from the dashboard or API
# actually picks up newly-rotated secrets — Apple Container's `start` reuses
# the env vars baked in at `run` time, so a plain stop/start can't refresh.
# The dispatch maps each rainbow-* container name to the start_* function that
# knows how to assemble its env, including any IP-dependent values.
restart_one() {
    local name="$1"
    load_env
    ensure_network frontend >/dev/null 2>&1 || true
    ensure_network backend  >/dev/null 2>&1 || true
    case "$name" in
        rainbow-postgres) start_postgres ;;
        rainbow-valkey)   start_valkey ;;
        rainbow-mariadb)  start_mariadb ;;
        rainbow-authentik-server)
            local pg vk
            pg=$(container_ip rainbow-postgres)
            vk=$(container_ip rainbow-valkey)
            start_authentik_server "$pg" "$vk"
            ;;
        rainbow-authentik-worker) start_authentik_worker ;;
        rainbow-immich)
            local pg vk ml
            pg=$(container_ip rainbow-postgres)
            vk=$(container_ip rainbow-valkey)
            ml=$(container_ip rainbow-immich-ml)
            start_immich_server "$pg" "$vk" "$ml"
            ;;
        rainbow-immich-ml) start_immich_ml ;;
        rainbow-seafile)
            local mdb
            mdb=$(container_ip rainbow-mariadb)
            start_seafile "$mdb"
            ;;
        rainbow-cryptpad) start_cryptpad ;;
        rainbow-stalwart) start_stalwart ;;
        rainbow-jellyfin) start_jellyfin ;;
        rainbow-webmail)  start_webmail ;;
        rainbow-web)      start_web ;;
        rainbow-caddy)    start_caddy ;;
        rainbow-cloudflared)
            local cip
            cip=$(container_ip rainbow-caddy)
            start_cloudflared "$cip"
            ;;
        *)
            orch_err "restart_one: unknown container '$name'"
            return 1
            ;;
    esac
}

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
    minimum)           start_minimum ;;
    stop)              stop_all ;;
    remove)            remove_all ;;
    restart-container) restart_one "${2:?usage: restart-container <rainbow-*>}" ;;
    "")
        echo "Usage: $0 <minimum|stop|remove|restart-container <name>>" >&2
        exit 1
        ;;
    *)
        echo "Unknown command: $1" >&2
        exit 1
        ;;
esac
