# Rainbow

**Take back your digital life.** Rainbow turns a Mac Mini into a complete self-hosted platform — email, photos, files, documents, media, gaming, and AI — replacing Google and other cloud services. All your data stays on your hardware.

## What You Get

| Service | Powered By | Access |
|---------|-----------|--------|
| Photos & Videos | [Immich](https://immich.app) | `photos.yourdomain.rainbow.rocks` |
| Email, Calendar, Contacts | [Stalwart](https://stalw.art) | `mail.yourdomain.rainbow.rocks` |
| Collaborative Documents | [CryptPad](https://cryptpad.org) | `docs.yourdomain.rainbow.rocks` |
| File Sharing & Sync | [Seafile](https://www.seafile.com) | `files.yourdomain.rainbow.rocks` |
| Media Server | [Jellyfin](https://jellyfin.org) | `media.yourdomain.rainbow.rocks` |
| Identity & Auth | [Authentik](https://goauthentik.io) | `auth.yourdomain.rainbow.rocks` |
| Minecraft Server | [Paper](https://papermc.io) | `mc.yourdomain.rainbow.rocks` |
| AI App Builder | Claude API | `app.yourdomain.rainbow.rocks` |
| Encrypted Backups | [Restic](https://restic.net) | Automatic, cloud-stored |

## Status

**Rainbow is in early development.** The scaffolding is complete across all eight phases, but most services have not been verified end-to-end. Expect breakage, especially around the AI app builder, MCP gateway, and the Authentik SSO integration.

There is no separate "dev mode." Rainbow is tested through a real Cloudflare Tunnel against a real domain — that's the only way to know which services actually work. Use the test-tunnel flow below for development.

## Quick Start

### Prerequisites

- Mac Mini or Mac laptop (M1 or later, 16GB+ RAM recommended)
- macOS 26 (Tahoe) or later
- A Cloudflare account with a zone you control (e.g. `rainbow.rocks` or your own domain)

### Install

```bash
# 1. Clone this repo
git clone https://github.com/youraerials/rainbow.git
cd rainbow

# 2. Install dependencies (Apple Container, container-compose, cloudflared, restic, yq, jq)
make install

# 3. Set up a Cloudflare Tunnel for testing
#    Defaults to test.rainbow.rocks. Use --domain to bring your own domain.
make setup-test-tunnel

# 4. Store the remaining secrets in macOS Keychain
security add-generic-password -s "rainbow-postgres-password" -a rainbow -w "$(openssl rand -hex 24)"
security add-generic-password -s "rainbow-authentik-secret"  -a rainbow -w "$(openssl rand -hex 32)"
security add-generic-password -s "rainbow-cloudflare-api-token" -a rainbow -w "your-cf-api-token"

# 5. Set cloudflare.zone_id in config/rainbow.yaml
#    (find it on the zone overview page in the Cloudflare dashboard)

# 6. Generate per-service configs and start
make setup
make start

# 7. Check status and run the integration tests to see what works
make status
make test
```

### Using the Setup Wizard (Recommended for end users)

For a guided setup experience, run the installer package which launches a SwiftUI setup wizard. It handles domain registration, Cloudflare tunnel creation, secret storage, and service configuration automatically.

## Architecture

```
Internet
  |
  v
Cloudflare Edge (DNS + TLS)
  |
  v (Cloudflare Tunnel — encrypted, outbound-only, no open ports)
  |
  v
Caddy (reverse proxy on localhost)
  |
  +---> Immich (photos)
  +---> Stalwart (email/calendar) — native
  +---> CryptPad (docs)
  +---> Seafile (files)
  +---> Jellyfin (media) — native
  +---> Authentik (auth)
```

**Zero open ports.** Cloudflare Tunnel creates an outbound-only encrypted connection from your Mac Mini to Cloudflare's edge network. No router port forwarding needed.

**No Docker required.** Rainbow uses [Apple Container](https://github.com/apple/container) — Apple's native, open-source container runtime. Each service runs in its own lightweight VM via Virtualization.framework, providing stronger isolation than traditional containers. Orchestration is handled by [container-compose](https://github.com/Mcrich23/Container-Compose).

## CLI

```bash
rainbow start [service]    # Start all or a specific service
rainbow stop [service]     # Stop all or a specific service
rainbow status             # Show service status and URLs
rainbow logs [service]     # Follow service logs
rainbow config apply       # Regenerate configs from rainbow.yaml
rainbow config edit        # Open config in your editor
rainbow backup             # Run a backup now
rainbow update             # Pull latest images and restart
```

## Testing

Rainbow includes a comprehensive integration test suite that verifies every service, DNS record, tunnel, email delivery, and more.

```bash
make test              # Full test suite (18 sections, ~2 minutes)
make test-quick        # Skip slow tests like email delivery and backups

# Run a single section
./scripts/test-all.sh --section dns
./scripts/test-all.sh --section email
./scripts/test-all.sh --section tunnel
./scripts/test-all.sh --section security
```

The test suite checks: prerequisites, all containers and native services, HTTP endpoints, PostgreSQL and Valkey, DNS records (MX/SPF/DKIM/DMARC), Cloudflare Tunnel reachability and TLS, email send and delivery via JMAP, Immich/Seafile/CryptPad/Jellyfin APIs, Authentik SSO, Minecraft RCON, backup configuration, DDNS, MCP gateway, and security (exposed ports, Keychain secrets, config hygiene). Disabled services are automatically skipped.

## Configuration

All configuration lives in `config/rainbow.yaml` — one file to rule them all. Edit it, then run `rainbow config apply` to regenerate per-service configs.

Secrets (API keys, passwords) are stored in the macOS Keychain and injected at config generation time. They never touch disk in plaintext.

## Backups

Rainbow uses Restic for encrypted, deduplicated backups to any S3-compatible storage (AWS S3, Backblaze B2, Cloudflare R2, etc.).

- All data is encrypted client-side before upload
- The cloud provider cannot read your data
- Incremental backups are fast and space-efficient
- Default retention: 7 daily, 4 weekly, 6 monthly snapshots

## AI Integration

Every Rainbow service is accessible via MCP (Model Context Protocol) servers. This means AI assistants can:

- Search your photos, emails, and files
- Send emails and manage your calendar
- Create and share documents
- Manage your Minecraft server
- Build and deploy custom web apps on your domain

The built-in App Builder lets you describe an application in plain English, and Claude will build and deploy it to your server.

## Project Structure

```
rainbow/
├── config/          # Configuration (rainbow.yaml + templates)
├── infrastructure/  # Docker Compose + service data
├── services/        # Native service management (Stalwart, Jellyfin)
├── cloudflare/      # Cloudflare Workers (subdomain management)
├── mcp/             # MCP servers (AI integration)
├── app-builder/     # AI-powered app builder
├── dashboard/       # Web UI
├── backups/         # Backup scripts + schedules
├── cli/             # rainbow CLI tool
├── installer/       # macOS .pkg installer + setup wizard
├── docs/            # Documentation
└── scripts/         # Development utilities
```

## Security

- All external traffic encrypted via Cloudflare Tunnel (no open ports)
- Single sign-on via Authentik across all services
- Secrets stored in macOS Keychain, never in config files
- Backups encrypted client-side with Restic
- Services isolated via Docker networks
- Native services (Stalwart, Jellyfin) run under standard user permissions

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

Rainbow orchestrates several open-source projects (Immich, Stalwart, CryptPad, Jellyfin, Seafile, Authentik, Paper, Caddy, PostgreSQL, Valkey, Restic) which retain their own licenses. Rainbow does not bundle these — they run as separate processes. See [NOTICE](NOTICE) for full attribution.
