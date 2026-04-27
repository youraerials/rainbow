#!/usr/bin/env bash
#
# dev-setup.sh — Set up a local development environment for Rainbow.
# Generates dev-friendly configs with default passwords (not for production).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INFRA_DIR="$PROJECT_ROOT/infrastructure"

echo "Setting up Rainbow development environment..."
echo ""

# Check dependencies
for cmd in container yq; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: $cmd is required. Install with: brew install $cmd" >&2
        exit 1
    fi
done

# Generate dev .env with default passwords
cat > "$INFRA_DIR/.env" <<'EOF'
# Development environment — DO NOT use these values in production
RAINBOW_DOMAIN=localhost
POSTGRES_USER=rainbow
POSTGRES_PASSWORD=rainbow-dev-password
AUTHENTIK_SECRET_KEY=dev-secret-key-not-for-production-use-only
AUTHENTIK_BOOTSTRAP_EMAIL=admin@localhost
IMMICH_UPLOAD_PATH=./immich/upload
SEAFILE_ADMIN_EMAIL=admin@localhost
SEAFILE_ADMIN_PASSWORD=seafile-dev-password
SEAFILE_DATA_PATH=./seafile/data
CLOUDFLARE_TUNNEL_TOKEN=
EOF

# Generate a dev Caddyfile (localhost, no tunnel)
cat > "$INFRA_DIR/caddy/Caddyfile" <<'EOF'
# Development Caddyfile — localhost only
{
    auto_https off
}

:80 {
    respond "Rainbow is running. Services available at their respective ports." 200
}
EOF

# Generate PostgreSQL init script
cat > "$INFRA_DIR/postgres/init/00-create-databases.sql" <<'EOF'
CREATE DATABASE authentik;
CREATE DATABASE immich;
CREATE DATABASE seafile;
GRANT ALL PRIVILEGES ON DATABASE authentik TO rainbow;
GRANT ALL PRIVILEGES ON DATABASE immich TO rainbow;
GRANT ALL PRIVILEGES ON DATABASE seafile TO rainbow;
EOF

echo "Development configs generated at $INFRA_DIR/"
echo ""
echo "Start with:"
echo "  make dev"
echo ""
echo "Or start core infra only:"
echo "  container-compose -f $INFRA_DIR/docker-compose.yml up -d caddy postgres valkey"
