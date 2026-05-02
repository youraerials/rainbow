#!/usr/bin/env bash
#
# refresh-caddy.sh — Rebuild Caddyfile.compiled from the current container IPs
# and restart Caddy + cloudflared so they see the new config.
#
# Why this script exists: Apple Container assigns a fresh IP every time a
# container is recreated, AND its bind-mount of a single file is a static
# snapshot — host-side changes don't propagate into the running container.
# That means after any container restart we have to:
#   1. Re-render Caddyfile.compiled with current IPs
#   2. Restart Caddy (so it re-snapshots the bind-mount)
#   3. Re-render cloudflared/config.compiled.yml with Caddy's new IP
#   4. Restart cloudflared
#
# Idempotent and safe to run any time. Exits 0 on success.

set -euo pipefail

ORCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAINBOW_ROOT="$(cd "$ORCH_DIR/.." && pwd)"
INFRA_DIR="$RAINBOW_ROOT/infrastructure"
CADDY_SRC="$INFRA_DIR/caddy/Caddyfile"
CADDY_DEST="$INFRA_DIR/caddy/Caddyfile.compiled"
CFD_SRC="$INFRA_DIR/cloudflared/config.yml"
CFD_DEST="$INFRA_DIR/cloudflared/config.compiled.yml"

# name → list of placeholders that may appear in the Caddyfile source for it.
# Most services use a single `<name>:port` — authentik and immich also expose
# their server-suffixed forms, so map those explicitly.
declare -a NAME_PAIRS=(
    "rainbow-web:web"
    "rainbow-authentik-server:authentik-server"
    "rainbow-immich:immich-server"
    "rainbow-cryptpad:cryptpad"
    "rainbow-seafile:seafile"
    "rainbow-stalwart:stalwart"
    "rainbow-jellyfin:jellyfin"
)

container_ip() {
    local name="$1"
    container inspect "$name" 2>/dev/null \
        | yq -p=json '.[0].networks[0].ipv4Address // ""' 2>/dev/null \
        | sed 's|/.*||' \
        | head -n1
}

wait_for_ip() {
    local name="$1"
    for _ in $(seq 1 20); do
        local ip
        ip=$(container_ip "$name") && [ -n "$ip" ] && { echo "$ip"; return 0; }
        sleep 0.5
    done
    return 1
}

if [ ! -f "$CADDY_SRC" ]; then
    echo "[refresh-caddy] source Caddyfile not found at $CADDY_SRC" >&2
    exit 1
fi

# ─── Render Caddyfile.compiled ───────────────────────────────────
cp "$CADDY_SRC" "$CADDY_DEST"
substitutions=0
for pair in "${NAME_PAIRS[@]}"; do
    container="${pair%%:*}"
    placeholder="${pair#*:}"
    ip=$(container_ip "$container" || true)
    if [ -n "$ip" ]; then
        sed -i '' -e "s|${placeholder}:|${ip}:|g" "$CADDY_DEST"
        substitutions=$((substitutions + 1))
    fi
done
echo "[refresh-caddy] rendered $CADDY_DEST ($substitutions IPs substituted)"

# ─── Restart Caddy so it re-snapshots the bind mount ─────────────
if container inspect rainbow-caddy >/dev/null 2>&1; then
    container stop rainbow-caddy >/dev/null 2>&1 || true
    container start rainbow-caddy >/dev/null 2>&1
    echo "[refresh-caddy] caddy restarted"
else
    echo "[refresh-caddy] rainbow-caddy not present — skipping"
    exit 0
fi

# Caddy now has a fresh IP — refresh cloudflared too.
caddy_ip=$(wait_for_ip rainbow-caddy) || {
    echo "[refresh-caddy] caddy has no IP after restart" >&2
    exit 1
}

if [ -f "$CFD_SRC" ] && container inspect rainbow-cloudflared >/dev/null 2>&1; then
    sed -e "s|http://caddy:80|http://${caddy_ip}:80|g" \
        -e "s|http://[0-9.]*:80|http://${caddy_ip}:80|g" \
        "$CFD_SRC" > "$CFD_DEST"
    if ! grep -q '^credentials-file:' "$CFD_DEST"; then
        sed -i '' "/^tunnel:/a\\
credentials-file: /etc/cloudflared/credentials.json
" "$CFD_DEST"
    fi
    container stop rainbow-cloudflared >/dev/null 2>&1 || true
    container start rainbow-cloudflared >/dev/null 2>&1
    echo "[refresh-caddy] cloudflared restarted (caddy=$caddy_ip)"
else
    echo "[refresh-caddy] cloudflared not configured — skipping"
fi
