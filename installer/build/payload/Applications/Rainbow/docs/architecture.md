# Rainbow Architecture

## System Overview

```
Internet
  │
  ▼
Cloudflare Edge
  │  DNS: <prefix>-<service>.<zone>  (level-1, covered by Universal SSL)
  │  TLS termination
  │
  ▼ outbound-only encrypted Cloudflare Tunnel (QUIC)
  │
cloudflared container
  │
  ▼ HTTP via Apple Container's `frontend` network
  │
Caddy (reverse proxy)
  ├─→ Authentik server (auth, SSO, OAuth2/OIDC)  ─────┐
  ├─→ Immich server (photos)                          │
  ├─→ Stalwart (email — admin UI)                     │
  ├─→ Seafile (files)                                 │
  ├─→ CryptPad (collab docs)                          │
  ├─→ Jellyfin (media)                                │
  └─→ Dashboard (static React bundle, served by Caddy)│
                                                      │
Apple Container `backend` network ───────────────────┘
  ├─→ Postgres (Immich's pg14 + VectorChord image)
  ├─→ Valkey (Redis-compatible cache)
  ├─→ MariaDB (Seafile's database)
  ├─→ Authentik worker (background tasks)
  └─→ Immich ML (face/object recognition)
```

## Design Principles

1. **Zero open ports for HTTPS** — Cloudflare Tunnel terminates externally; cloudflared dials out from inside
2. **Everything containerized** — no native services, uniform orchestration via `services/orchestrator.sh`
3. **Apple Container, not Docker** — each service in its own lightweight VM; no DNS-by-name → orchestrator does runtime IP substitution
4. **One config file** — `config/rainbow.yaml` drives templated per-service configs
5. **Secrets in macOS Keychain** — never on disk in plaintext
6. **Level-1 subdomains** — `<prefix>-<service>.<zone>` keeps everything inside Universal SSL coverage
7. **SSO everywhere** — Authentik provides OAuth2/OIDC; Immich verified end-to-end

## Networking

### External access

```
User → Cloudflare edge (HTTPS) → Tunnel (QUIC) → cloudflared container → Caddy → service
```

The tunnel is outbound-only: cloudflared on the Mac dials out to Cloudflare. No inbound ports on the user's router.

### Internal routing — IP substitution

Apple Container has no DNS-by-name between containers. We solve this with two-phase startup in `services/orchestrator.sh`:

1. Each service starts via `container run`. We capture its IP via `container inspect`.
2. After all services start, the orchestrator rewrites name-based references with the captured IPs:
   - `Caddyfile`: `reverse_proxy authentik-server:9000` → `reverse_proxy 192.168.66.X:9000`
   - `cloudflared/config.yml`: `service: http://caddy:80` → `service: http://192.168.66.Y:80`
   - Per-app env files (e.g. `infrastructure/authentik/.env.compiled`): `AUTHENTIK_POSTGRESQL__HOST=postgres` → `AUTHENTIK_POSTGRESQL__HOST=192.168.65.Z`
3. Caddy and any service whose env was rewritten get restarted to pick up the substituted config.

### Networks

- **frontend** — Caddy + cloudflared + every service Caddy routes to (plus Authentik server, Immich server, Seafile — services that need to span both)
- **backend** — Postgres, Valkey, MariaDB, the worker/ML containers; isolated from the internet

## Configuration flow

```
config/rainbow.yaml  (user-edited source of truth)
        │
        ▼
scripts/generate-config.sh  (reads YAML + macOS Keychain)
        │
        ├─→ infrastructure/.env                                  (shared env: DB passwords, etc.)
        ├─→ infrastructure/caddy/Caddyfile                       (template-rendered, names not yet substituted)
        ├─→ infrastructure/cloudflared/config.yml                (template-rendered)
        ├─→ infrastructure/postgres/init/00-create-databases.sql
        ├─→ infrastructure/immich/.env
        ├─→ infrastructure/seafile/.env + seahub_settings_extra.py
        └─→ infrastructure/cryptpad/customize/config.js

services/orchestrator.sh  (at `make start`)
        │
        ├─→ container run for each service (in dependency order)
        ├─→ collect each container's IP
        ├─→ Caddyfile.compiled, cloudflared/config.compiled.yml, *.env.compiled
        └─→ post-start hooks (services/<name>/setup.sh) for API-driven config
              (e.g. Immich admin signup + OAuth via /api/system-config)
```

## Data storage

| Service | Storage | Backed up |
|---------|---------|-----------|
| Postgres (shared) | Apple Container volume `rainbow-postgres-data` | Yes (pg_dump per database) |
| MariaDB (Seafile only) | Apple Container volume `rainbow-mariadb-data` | Yes |
| Valkey | Apple Container volume `rainbow-valkey-data` | No (cache) |
| Immich uploads | Apple Container volume `rainbow-immich-upload` | Yes |
| Immich ML cache | `rainbow-immich-model-cache` | No (regenerable) |
| Stalwart mail | Bind-mount: `~/Library/Application Support/Rainbow/stalwart/` | Yes |
| Seafile files | `rainbow-seafile-data` | Yes |
| CryptPad blobs/blocks/data/datastore | `rainbow-cryptpad-*` | Yes |
| Jellyfin config + cache | `rainbow-jellyfin-config`, `rainbow-jellyfin-cache` | Yes (config), no (cache) |
| Jellyfin media library | User's host paths bind-mounted read-only (e.g. `~/Movies`) | No (user responsibility) |
| Caddy data + config | `rainbow-caddy-data`, `rainbow-caddy-config` | No (regenerable) |
| Authentik media + templates | `rainbow-authentik-media`, `rainbow-authentik-templates` | Yes |

Apple Container volumes live under `~/Library/Application Support/com.apple.container/volumes/`.

## MCP architecture (planned)

```
Claude / AI Client
  │
  ▼
MCP Gateway (single endpoint, aggregates per-service tools)
  ├─→ mcp-email      (Stalwart JMAP API)
  ├─→ mcp-files      (Seafile API)
  ├─→ mcp-photos     (Immich API)
  ├─→ mcp-media      (Jellyfin API)
  ├─→ mcp-docs       (CryptPad API)
  └─→ mcp-system     (backups, health, DNS, users)
```

The MCP servers are scaffolded in `mcp/packages/` (TypeScript, npm workspaces) but the gateway isn't wired into the orchestrator yet. Bringing them up would follow the same `start_<name>()` pattern as the apps.
