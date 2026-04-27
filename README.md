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

## Quick Start

### Prerequisites

- Mac Mini (M1 or later, 16GB+ RAM recommended)
- macOS 26 (Tahoe) or later
- A Cloudflare account (free tier works)

### Install

```bash
# 1. Clone this repo
git clone https://github.com/youraerials/rainbow.git
cd rainbow

# 2. Install dependencies
make install

# 3. Edit your configuration
cp config/rainbow.yaml config/rainbow.local.yaml
# Edit config/rainbow.yaml with your domain, email, etc.

# 4. Store secrets in macOS Keychain
security add-generic-password -s "rainbow-postgres-password" -a rainbow -w "your-secure-password"
security add-generic-password -s "rainbow-authentik-secret" -a rainbow -w "$(openssl rand -hex 32)"
security add-generic-password -s "rainbow-cloudflare-tunnel-token" -a rainbow -w "your-tunnel-token"
# ... (the setup wizard automates this)

# 5. Generate configs and start
make setup
make start

# 6. Check status
make status
```

### Using the Setup Wizard (Recommended)

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
  +---> Stalwart (email/calendar)
  +---> CryptPad (docs)
  +---> Seafile (files)
  +---> Jellyfin (media)
  +---> Authentik (auth)
  +---> MCP Gateway (AI coordination)
  +---> Dashboard (web UI)
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
