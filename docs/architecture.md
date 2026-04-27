# Rainbow Architecture

## System Overview

```
Internet
  |
  v
Cloudflare Edge
  |  DNS: *.yourdomain.rainbow.rocks
  |  TLS termination
  |
  v (Cloudflare Tunnel — outbound-only, encrypted)
  |
Caddy (reverse proxy, localhost:80)
  |
  +──> Docker Network (frontend)
  |    +──> Authentik (auth, SSO)
  |    +──> Immich (photos)
  |    +──> CryptPad (docs)
  |    +──> Seafile (files)
  |    +──> MCP Gateway (AI)
  |    +──> Dashboard (web UI)
  |
  +──> Native Services
       +──> Stalwart (email, localhost:8080)
       +──> Jellyfin (media, localhost:8096)

Docker Network (backend, internal)
  +──> PostgreSQL (shared database)
  +──> Redis (shared cache)
  +──> Immich ML (face/object recognition)
  +──> Authentik Worker (background tasks)
```

## Design Principles

1. **Zero open ports** — Cloudflare Tunnel handles all external access
2. **One config file** — `config/rainbow.yaml` drives everything
3. **Secrets in Keychain** — never stored in plaintext on disk
4. **Native where it matters** — Stalwart (I/O), Jellyfin (Metal transcoding)
5. **Docker for everything else** — isolation, easy updates, reproducibility
6. **Single PostgreSQL** — one instance, separate databases per service
7. **SSO everywhere** — Authentik provides OAuth2/OIDC for all services

## Networking

### External Access

All traffic flows through Cloudflare Tunnel:

```
User → Cloudflare CDN → Tunnel → Caddy → Service
```

The tunnel creates an outbound-only connection from the Mac Mini to Cloudflare.
No inbound ports need to be opened on the router.

### Internal Routing

Caddy routes by hostname:
- `photos.domain` → Immich (Docker, port 2283)
- `mail.domain` → Stalwart (native, port 8080)
- `files.domain` → Seafile (Docker, port 80)
- `docs.domain` → CryptPad (Docker, port 3000)
- `media.domain` → Jellyfin (native, port 8096)
- `auth.domain` → Authentik (Docker, port 9000)
- `app.domain` → Dashboard (Docker, port 5173)
- `api.domain` → MCP Gateway (Docker, port 3001)

### Docker Networks

- **frontend** — Services that Caddy routes to
- **backend** — Internal only (PostgreSQL, Redis, ML workers)

## Configuration Flow

```
rainbow.yaml (user edits this)
      |
      v
generate-config.sh (reads YAML + Keychain secrets)
      |
      +──> infrastructure/.env (Docker Compose env)
      +──> infrastructure/caddy/Caddyfile
      +──> infrastructure/cloudflared/config.yml
      +──> infrastructure/postgres/init/00-create-databases.sql
      +──> infrastructure/immich/.env
      +──> infrastructure/seafile/.env + seahub_settings_extra.py
      +──> infrastructure/cryptpad/customize/config.js
      +──> /opt/rainbow/stalwart/etc/config.toml
      +──> infrastructure/minecraft/server/server.properties
```

## Data Storage

| Service | Storage | Backed Up? |
|---------|---------|-----------|
| PostgreSQL | Docker volume `postgres_data` | Yes (pg_dump) |
| Immich photos | Configurable path (default: `infrastructure/immich/upload/`) | Yes |
| Stalwart mail | `/opt/rainbow/stalwart/` | Yes |
| Seafile files | Configurable path (default: `infrastructure/seafile/data/`) | Yes |
| CryptPad docs | Docker volumes `cryptpad_*` | Yes |
| Jellyfin config | `~/.local/share/jellyfin/` | Yes |
| Jellyfin media | User's media paths (e.g., `~/Movies`) | No (user responsibility) |
| Minecraft worlds | `infrastructure/minecraft/server/world/` | Yes |
| Custom apps | `app-builder/apps/` | Yes |

## MCP Architecture

```
Claude / AI Client
  |
  v
MCP Gateway (aggregates all service tools)
  |
  +──> mcp-email (Stalwart JMAP API)
  +──> mcp-files (Seafile API)
  +──> mcp-photos (Immich API)
  +──> mcp-media (Jellyfin API)
  +──> mcp-docs (CryptPad API)
  +──> mcp-minecraft (RCON)
  +──> mcp-system (backups, health, DNS, users)
```

Each MCP server exposes tools and resources following the MCP specification.
The gateway aggregates them into a single endpoint at `api.domain`.
