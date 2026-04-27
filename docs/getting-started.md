# Getting Started with Rainbow

This guide walks you through setting up Rainbow on a Mac Mini.

## Prerequisites

- **Hardware**: Mac Mini with M1 chip or later
- **RAM**: 16GB minimum, 32GB recommended
- **Storage**: 256GB+ internal (512GB+ recommended for photos/media)
- **macOS**: Version 26 (Tahoe) or later
- **Internet**: Home broadband connection
- **Cloudflare account**: Free tier is sufficient ([sign up](https://dash.cloudflare.com/sign-up))

## Step 1: Clone and Install

```bash
git clone https://github.com/your-org/rainbow.git
cd rainbow
make install
```

This installs:
- Homebrew (if missing)
- Apple Container + container-compose (native macOS container runtime)
- yq, jq, restic, cloudflared
- Stalwart mail server
- Jellyfin media server

## Step 2: Set Up Cloudflare

### Register a domain or claim a subdomain

**Option A: Use a rainbow.rocks subdomain** (recommended for getting started)
- We'll provide a subdomain like `yourname.rainbow.rocks`
- All service subdomains are created automatically

**Option B: Bring your own domain**
- Add your domain to Cloudflare
- Update nameservers to point to Cloudflare

### Create a Cloudflare Tunnel

```bash
# Login to Cloudflare
cloudflared tunnel login

# Create a tunnel
cloudflared tunnel create rainbow

# Note the tunnel ID and credentials file path
```

### Create a Cloudflare API token

1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Create a token with permissions:
   - Zone > DNS > Edit
   - Zone > Zone > Read
3. Save the token — you'll need it next

## Step 3: Configure

Edit `config/rainbow.yaml`:

```yaml
domain:
  primary: "yourname.rainbow.rocks"

admin:
  name: "Your Name"
  email: "you@yourname.rainbow.rocks"

services:
  # Disable anything you don't want:
  minecraft:
    enabled: false
```

### Store secrets in Keychain

```bash
# PostgreSQL password
security add-generic-password -s "rainbow-postgres-password" -a rainbow -w "$(openssl rand -hex 24)"

# Authentik secret key
security add-generic-password -s "rainbow-authentik-secret" -a rainbow -w "$(openssl rand -hex 32)"

# Authentik admin password
security add-generic-password -s "rainbow-authentik-bootstrap-password" -a rainbow -w "your-admin-password"

# Stalwart mail admin password
security add-generic-password -s "rainbow-stalwart-admin-password" -a rainbow -w "your-mail-admin-password"

# Seafile admin password
security add-generic-password -s "rainbow-seafile-admin-password" -a rainbow -w "your-seafile-password"

# Cloudflare tunnel token
security add-generic-password -s "rainbow-cloudflare-tunnel-token" -a rainbow -w "your-tunnel-token"
```

## Step 4: Generate Configs and Start

```bash
# Generate all service configurations
rainbow config apply

# Start everything
rainbow start

# Check status
rainbow status
```

## Step 5: Access Your Services

Once running, your services are available at:

| Service | URL |
|---------|-----|
| Dashboard | `https://app.yourname.rainbow.rocks` |
| Photos | `https://photos.yourname.rainbow.rocks` |
| Email | `https://mail.yourname.rainbow.rocks` |
| Files | `https://files.yourname.rainbow.rocks` |
| Documents | `https://docs.yourname.rainbow.rocks` |
| Media | `https://media.yourname.rainbow.rocks` |
| Auth | `https://auth.yourname.rainbow.rocks` |

## Step 6: Set Up SSO

```bash
# Configure Authentik OAuth providers for all services
./services/authentik/setup-providers.sh

# Regenerate configs with OAuth credentials
rainbow config apply

# Restart to pick up new config
rainbow restart
```

## Step 7: Email DNS (Automatic)

Email DNS records (MX, SPF, DKIM, DMARC) are created automatically in Cloudflare when Stalwart is installed. To verify or re-run:

```bash
# Check current records
dig MX yourname.rainbow.rocks
dig TXT yourname.rainbow.rocks

# Re-run DNS setup if needed
./services/stalwart/setup-dns.sh
```

Test deliverability at [mail-tester.com](https://www.mail-tester.com). If you have issues with outbound email (common on residential connections), you can add an SMTP relay in Stalwart's config without changing anything else.

## Step 8: Set Up Backups

```bash
# Store backup credentials
security add-generic-password -s "rainbow-restic-password" -a rainbow -w "$(openssl rand -hex 24)"
security add-generic-password -s "rainbow-aws-access-key" -a rainbow -w "your-s3-access-key"
security add-generic-password -s "rainbow-aws-secret-key" -a rainbow -w "your-s3-secret-key"

# Update rainbow.yaml with your backup repository
# backups.repository: "s3:s3.amazonaws.com/your-bucket-name"

# Test a backup
rainbow backup
```

## Optional: Minecraft

```bash
# Install Paper server
./services/minecraft/install.sh

# Enable in config
# Set services.minecraft.enabled: true in rainbow.yaml

# Start
rainbow start minecraft
```

## Troubleshooting

```bash
# Check service health
./services/health.sh

# View logs for a specific service
rainbow logs caddy
rainbow logs immich-server

# Restart a single service
rainbow stop immich-server
rainbow start immich-server

# Full reset (DESTRUCTIVE — deletes all data)
make reset
```

## Next Steps

- Install Immich mobile app and configure auto-upload
- Set up Seafile desktop sync client
- Configure Jellyfin hardware transcoding (Apple VideoToolbox)
- Explore the AI App Builder at `https://app.yourname.rainbow.rocks`
