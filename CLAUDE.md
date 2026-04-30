# Rainbow — Project Instructions for Claude

## What This Is

Rainbow is a self-hosted digital life platform targeting Mac Mini (M-series Apple Silicon). Users run an installer and get email, photos, files, docs, media, and AI — all on their home network with zero open ports.

## Tech Stack

Everything runs in Apple Containers. There are no native services.

| Service | Image | Port |
|---------|-------|------|
| Photos | `ghcr.io/immich-app/immich-server:release` | 2283 |
| Photos ML | `ghcr.io/immich-app/immich-machine-learning:release` | 3003 |
| Email | `stalwartlabs/stalwart:latest` | 8080 (HTTP), 25/465/587/993 (mail) |
| Documents | `cryptpad/cryptpad:latest` | 3000, 3001 |
| Media | `jellyfin/jellyfin:latest` | 8096 |
| Files | `seafileltd/seafile-mc:latest` | 80 |
| Auth/SSO | `ghcr.io/goauthentik/server:latest` | 9000 |
| Postgres (shared) | `ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0` | 5432 |
| MariaDB (Seafile) | `mariadb:11` | 3306 |
| Cache | `valkey/valkey:8-alpine` | 6379 |
| Reverse Proxy | `caddy:2-alpine` | 80 (in-network) |
| Tunnel | `cloudflare/cloudflared:latest` | outbound only |

### Container runtime: Apple Container (not Docker)

Rainbow uses Apple's native `container` runtime (`brew install container`). Each container runs in its own lightweight VM via Virtualization.framework. Requires macOS 26 (Tahoe).

We do **not** use `container-compose`. Apple Container 0.11's compose shim is too feature-incomplete (no DNS-by-name between containers, no env interpolation, no condition-based depends_on, etc.). Instead we orchestrate with `services/orchestrator.sh`, which calls `container run` directly per service. See `memory/project_apple_container_quirks.md` and `memory/project_runtime_architecture.md`.

The CLI's `compose()` helper is kept as a fallback for users with Docker installed, but the primary path is the native orchestrator.

## Project Structure

```
rainbow/
├── config/                 # Single source of truth: rainbow.yaml + templates
├── infrastructure/         # Generated runtime configs (gitignored: caddy/, cloudflared/, etc.)
├── services/               # Orchestrator + per-service post-start hooks
│   ├── orchestrator.sh     # Bring up containers via `container run` (the real entry point)
│   ├── authentik/          # OAuth provider setup (post-Authentik-bootstrap)
│   └── immich/             # Admin signup + OAuth config (post-Immich-start)
├── cloudflare/             # TypeScript Workers (Hono + Wrangler)
├── mcp/                    # MCP servers (npm workspaces, 8 packages)
├── app-builder/            # AI app builder (Express + Claude API)
├── dashboard/              # React + Vite web UI (built static bundle served by Caddy)
├── backups/                # Restic backup scripts + launchd
├── cli/                    # `rainbow` CLI (bash)
├── installer/              # macOS .pkg + SwiftUI setup wizard
├── scripts/                # generate-config.sh, setup-test-tunnel.sh
├── website/                # Brand site at rainbow.rocks
└── docs/                   # Architecture and getting-started guides
```

## Key Architecture Decisions

- **Hostname layout:** `<prefix>-<service>.<zone>` (e.g. `aubrey-auth.rainbow.rocks`). All level-1 subdomains, all covered by Cloudflare Universal SSL. `domain.prefix` and `domain.zone` in `config/rainbow.yaml`. See `memory/project_hostname_layout.md`.
- **One config file:** `config/rainbow.yaml` drives everything. `scripts/generate-config.sh` reads it + macOS Keychain secrets and renders per-service configs from `config/templates/`.
- **Two-phase startup:** Containers start → orchestrator captures their IPs via `container inspect` → renders IP-substituted Caddyfile + cloudflared config + per-app .env files → restarts the containers that need the substitutions. See `memory/project_runtime_architecture.md`.
- **Zero open ports:** External traffic flows Cloudflare Edge → Tunnel → cloudflared container → Caddy → service. No router port forwarding needed for HTTPS. SMTP/IMAP for mail still need separate ingress.
- **Caddy trusts private_ranges as proxies:** Required so cloudflared's `X-Forwarded-Proto: https` survives. See `memory/project_caddy_trusted_proxies.md`.
- **Secrets in macOS Keychain:** Never stored in plaintext. All `security find-generic-password -s "rainbow-*"` pattern. Generated automatically by setup-test-tunnel.sh and post-start hooks.
- **Shared Postgres uses Immich's image:** pg14 + VectorChord. Other services don't use the vector extension but tolerate pg14 fine. See `memory/project_postgres_image.md`.
- **Seafile has its own MariaDB:** seafile-mc only speaks MySQL/MariaDB protocol; can't share Postgres. See `memory/project_seafile_quirks.md`.
- **OIDC SSO via Authentik:** providers/applications created by `services/authentik/setup-providers.sh`; per-app config (e.g. Immich) applied by post-start hooks. See `memory/project_authentik_api.md`.

## Licensing

- **Rainbow:** Apache 2.0 (see LICENSE and NOTICE)
- **Bundled deps** (Hono, MCP SDK, Anthropic SDK, React, Vite, Express): all MIT or Apache 2.0
- **Orchestrated services** (Immich, Stalwart, CryptPad, Jellyfin, Seafile): AGPL/GPL but run as separate processes — no license infection
- We use **Valkey** (BSD-3) instead of Redis 7.4+ (RSALv2) for a fully OSI-pure stack

## Commands

```bash
make install               # brew install container yq jq restic cloudflared
make setup-test-tunnel     # one-shot: cloudflared login + tunnel + DNS routes
make setup                 # generate per-service configs from rainbow.yaml + Keychain
make start                 # bring up the whole stack (orchestrator)
make stop                  # stop everything
make status                # show service status
make logs <service>        # follow logs (e.g. `make logs immich`)
make backup                # Restic snapshot
make config                # regenerate configs from rainbow.yaml
```

## Code Conventions

- Don't use emoji in log or print statements
- Shell scripts use `set -euo pipefail`
- Config templates use `{{VARIABLE}}` placeholders (sed-based substitution)
- MCP servers use `@modelcontextprotocol/sdk` with `McpServer` + `StdioServerTransport`
- Cloudflare Workers use Hono framework
- Dashboard is React 19 + React Router 7 + Vite 6
- App builder uses `@anthropic-ai/sdk` (Anthropic SDK)
- TypeScript across all JS projects (strict mode)

## File Quick Reference

| Need to... | Look at... |
|-------------|-----------|
| Change service config | `config/rainbow.yaml` |
| Add a new container service | `services/orchestrator.sh` (add a `start_<name>()` function) |
| Add a new config template | `config/templates/<service>/` + update `scripts/generate-config.sh` |
| Add a post-start hook (e.g. configure-via-API) | `services/<name>/setup.sh` + call from `start_minimum` in orchestrator |
| Add an MCP tool | `mcp/packages/mcp-<service>/src/tools/` |
| Modify the dashboard | `dashboard/src/views/` or `dashboard/src/components/` |
| Modify the CLI | `cli/rainbow` (single bash file) |
| Change Caddy routing | `config/templates/caddy/Caddyfile.j2` |
| Change backup behavior | `backups/backup.sh` + `backups/hooks/` |
| Modify the installer | `installer/scripts/postinstall.sh` or `installer/gui/Sources/` |
