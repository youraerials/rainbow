# Rainbow — Project Instructions for Claude

## What This Is

Rainbow is a self-hosted digital life platform targeting Mac Mini (M-series Apple Silicon). Users run an installer and get email, photos, files, docs, media, gaming, and AI — all on their home network with zero open ports.

## Tech Stack

| Category | Tool | Install | Port |
|----------|------|---------|------|
| Photos | Immich | Container | 2283 |
| Email/Calendar/Contacts | Stalwart | Native (Homebrew) | 8080 (HTTP), 25/587/993 (mail) |
| Documents | CryptPad | Container | 3000, 3001 (sandbox) |
| Media | Jellyfin | Native (Homebrew) | 8096 |
| Files | Seafile | Container | 8082 |
| Auth/SSO | Authentik | Container | 9000 |
| Minecraft | Paper (Java) | Native | 25565, 25575 (RCON) |
| Database | PostgreSQL 17 | Container | 5432 |
| Cache | Valkey 8 (Redis fork, BSD-3) | Container | 6379 |
| Reverse Proxy | Caddy | Container | 80, 443 (localhost only) |
| Tunnel | Cloudflare Tunnel | Container | outbound only |
| Backups | Restic | Homebrew | N/A |
| Container Runtime | Apple Container + container-compose | Homebrew | N/A |

### Container runtime: Apple Container (not Docker)
Rainbow uses Apple's native container framework (`brew install container`) with `container-compose` for orchestration. Each container runs in its own lightweight VM via Virtualization.framework — better security isolation than Docker. Requires macOS 26 (Tahoe) for container-to-container networking.

The CLI (`cli/rainbow`) has a `compose()` abstraction that falls back to `docker compose` if Apple Container isn't available.

### Why native vs container?
- **Stalwart**: Rust binary, benefits from direct filesystem I/O for mail storage
- **Jellyfin**: Needs Apple Metal (VideoToolbox) for hardware transcoding — unavailable inside containers on macOS
- Everything else: Apple Container for isolation and easy management

## Project Structure

```
rainbow/
├── config/                 # Single source of truth: rainbow.yaml + templates
├── infrastructure/         # Docker Compose (docker-compose.yml is the main file)
├── services/               # Native service scripts (stalwart/, jellyfin/, minecraft/)
├── cloudflare/             # TypeScript Workers (Hono + Wrangler)
├── mcp/                    # MCP servers (npm workspaces, 8 packages)
├── app-builder/            # AI app builder (Express + Claude API)
├── dashboard/              # React + Vite web UI
├── backups/                # Restic backup scripts + launchd
├── cli/                    # `rainbow` CLI (bash)
├── installer/              # macOS .pkg + SwiftUI setup wizard
├── scripts/                # Dev utilities (generate-config.sh is key)
└── docs/                   # Architecture and getting-started guides
```

## Key Architecture Decisions

- **One config file**: `config/rainbow.yaml` drives everything. `scripts/generate-config.sh` reads it + macOS Keychain secrets and renders per-service configs from `config/templates/`.
- **Zero open ports**: All external traffic flows through Cloudflare Tunnel → Caddy → service. No router port forwarding needed.
- **Secrets in macOS Keychain**: Never stored in plaintext. All `security find-generic-password -s "rainbow-*"` pattern.
- **Single PostgreSQL**: One shared instance, separate databases (authentik, immich, seafile).
- **MCP gateway pattern**: Single endpoint aggregates all per-service MCP servers.
- **Subdomain routing**: Caddy routes by hostname (photos.domain → Immich, mail.domain → Stalwart, etc.)

## Licensing

- **Rainbow**: Apache 2.0 (see LICENSE and NOTICE)
- **Bundled deps** (Hono, MCP SDK, Anthropic SDK, React, Vite, Express): all MIT or Apache 2.0
- **Orchestrated services** (Immich, Stalwart, CryptPad, Jellyfin, Seafile, Paper): AGPL/GPL but run as separate processes — no license infection
- We use **Valkey** (BSD-3) instead of Redis 7.4+ (RSALv2) for a fully OSI-pure stack

## Development Commands

```bash
make dev-setup     # Generate dev configs with default passwords
make dev           # Start services in dev mode (ports exposed)
make start         # Start all services (production)
make stop          # Stop all services
make status        # Show service health
make config        # Regenerate configs from rainbow.yaml
make clean         # Remove generated configs
make reset         # DESTRUCTIVE: stop + delete all data
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

## Current State (2026-04-26)

All 8 implementation phases scaffolded — 169 source files.

### What's implemented:
- Full config system with templates for all 7 services
- Compose file with 12 services, health checks, 3 networks (Apple Container + container-compose)
- CLI tool (start/stop/status/logs/config/backup/update)
- Cloudflare Workers (subdomain manager + health monitor) with tests
- 8 MCP servers (50 TS files) with real API integrations (JMAP, CalDAV, REST, RCON)
- React dashboard (6 views, 3 components)
- AI app builder (orchestrator, Claude client, sandbox, deployer)
- macOS .pkg installer + SwiftUI setup wizard (5 screens)
- Restic backup system with Keychain integration
- Getting-started and architecture docs

### What needs work next:
- `npm install` and TypeScript compilation verification across all packages
- Integration testing with real container services running
- End-to-end flow: installer → config → start → access services
- Dashboard API backend (currently frontend calls stub endpoints)
- MCP gateway needs to dynamically load sub-servers (currently stub)
- Authentik SSO end-to-end verification
- Email DNS setup automation (MX, SPF, DKIM, DMARC)
- Cloudflare Worker deployment and KV namespace creation
- App builder Docker deployment pipeline testing

## File Quick Reference

| Need to... | Look at... |
|-------------|-----------|
| Change service config | `config/rainbow.yaml` |
| Add a new Docker service | `infrastructure/docker-compose.yml` |
| Add a new config template | `config/templates/<service>/` + update `scripts/generate-config.sh` |
| Add a native service | `services/<name>/install.sh` + launchd plist |
| Add an MCP tool | `mcp/packages/mcp-<service>/src/tools/` |
| Modify the dashboard | `dashboard/src/views/` or `dashboard/src/components/` |
| Modify the CLI | `cli/rainbow` (single bash file) |
| Change Caddy routing | `config/templates/caddy/Caddyfile.j2` |
| Change backup behavior | `backups/backup.sh` + `backups/hooks/` |
| Modify the installer | `installer/scripts/postinstall.sh` or `installer/gui/Sources/` |
