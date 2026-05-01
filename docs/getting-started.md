# Getting Started with Rainbow

This is the friendly walkthrough. The [README](../README.md) has the dense version.

## Prerequisites

- **Hardware:** Mac Mini or Mac laptop, M1 chip or later
- **RAM:** 16 GB minimum, 32 GB if you also want Minecraft + heavy Immich ML
- **Storage:** ~10 GB for container images plus whatever your photos/media will need
- **macOS:** Version 26 (Tahoe) — Apple Container requires it
- **Internet:** A normal home connection. No static IP needed.
- **Cloudflare account:** Free tier is fine. [Sign up here.](https://dash.cloudflare.com/sign-up)

## Step 1: Clone and install dependencies

```bash
git clone https://github.com/youraerials/rainbow.git
cd rainbow
make install
```

`make install` brings in:

- **`container`** — Apple's native container runtime
- **`cloudflared`** — Cloudflare's tunnel client
- **`yq`, `jq`** — YAML/JSON parsers used by the orchestrator scripts
- **`restic`** — backup tool

It also starts the Apple Container system service and installs the default Kata kernel (one-time).

## Step 2: Pick a domain layout and create a tunnel

You have two options:

### Option A: shared `rainbow.rocks` zone (test setup, simplest)

Default. Each service is at `<prefix>-<service>.rainbow.rocks` — e.g. `aubrey-photos.rainbow.rocks`. The prefix you pick has to be unique on the shared zone (first-come-first-served).

```bash
make setup-test-tunnel             # uses prefix=test by default
# or to claim your own prefix:
./scripts/setup-test-tunnel.sh --prefix aubrey
```

### Option B: bring your own domain

Buy a domain, add it to Cloudflare (point its nameservers at Cloudflare). Then:

```bash
./scripts/setup-test-tunnel.sh --domain example.com
```

Hostnames become `auth.example.com`, `photos.example.com`, etc. — first-level subdomains under your zone, all covered by Cloudflare's free Universal SSL.

In either case, `setup-test-tunnel` will:

1. Open your browser for `cloudflared login`
2. Create a Cloudflare Tunnel named `rainbow-test`
3. Add DNS routes for every service hostname
4. Save the tunnel token to your macOS Keychain
5. Update `config/rainbow.yaml` with your domain choice

## Step 3: Seed the rest of your secrets

Rainbow keeps every password in your macOS Keychain so nothing is on disk in plaintext. Generate them all in one go:

```bash
for s in postgres-password authentik-secret authentik-bootstrap-password \
         mariadb-root-password seafile-admin-password cryptpad-admin-key \
         immich-admin-password; do
  security add-generic-password -s "rainbow-$s" -a rainbow -w "$(openssl rand -hex 24)" -U
done
```

You can recover any of them later with:

```bash
security find-generic-password -s rainbow-authentik-bootstrap-password -w
```

## Step 4: Start the stack

```bash
make setup     # render per-service configs from rainbow.yaml + Keychain
make start     # bring up all 13 containers
```

This takes a couple of minutes the first time — it pulls images and runs first-run database migrations for Authentik, Immich, and Seafile. Subsequent `make start`s are much faster.

You should see `[immich-setup]` lines at the end indicating that Immich's admin user was created and OAuth was configured (without you clicking through a UI). At this point HTTPS works for every service hostname:

| URL | What |
|---|---|
| `https://<prefix>.<zone>` | Dashboard / web tier |
| `https://<prefix>-auth.<zone>` | Authentik |
| `https://<prefix>-photos.<zone>` | Immich |
| `https://<prefix>-files.<zone>` | Seafile |
| `https://<prefix>-docs.<zone>` | CryptPad |
| `https://<prefix>-media.<zone>` | Jellyfin |
| `https://<prefix>-mail.<zone>` | Stalwart admin |

## Step 5: Wire up SSO (one-time manual step)

Authentik needs an API token before our automation can create OAuth providers. Open `https://<prefix>-auth.<zone>`, log in as `akadmin` (password is in Keychain at `rainbow-authentik-bootstrap-password`), then:

> Profile → Admin interface → Directory → Tokens & App passwords → Create
> - Identifier: `rainbow-setup`
> - User: `akadmin`
> - Intent: `API Token`
> - Expiring: **off**
>
> Save, click the row → **Copy Key**.

Then back in your shell:

```bash
security add-generic-password -s rainbow-authentik-api-token -a rainbow -w '<paste-key>'
make setup-providers              # creates Authentik OAuth providers + applications
make stop && make start           # post-start hooks pick up the new credentials
```

After this, `https://<prefix>-photos.<zone>` shows a "Login with Rainbow" button. Click it, complete the Authentik prompt once, and you're in.

## Step 6: First-run setup for individual services

Some apps want to walk you through their own first-time configuration:

- **Authentik** is already set up — `akadmin` user with the bootstrap password
- **Immich** admin was auto-created (email = `admin.email` from rainbow.yaml; password in Keychain at `rainbow-immich-admin-password`)
- **Stalwart** prints a recovery code on first start. Get it with `container logs rainbow-stalwart 2>&1 | grep -A1 password`. Visit `https://<prefix>-mail.<zone>/init` to use it.
- **Jellyfin** has its own setup wizard at `https://<prefix>-media.<zone>`
- **Seafile** uses email `admin.email` and password at `rainbow-seafile-admin-password`
- **CryptPad** prints an admin install URL on first start: `container logs rainbow-cryptpad 2>&1 | grep install`

## Day-to-day commands

```bash
make status                       # what's running
make stop                         # stop everything
make start                        # bring it back
make logs <service>               # follow logs (e.g. make logs immich)
make backup                       # take a Restic snapshot
make config                       # regenerate per-service configs after editing rainbow.yaml
```

## Where the data lives

- Container persistent state → `~/Library/Application Support/com.apple.container/volumes/rainbow-*/`
- Stalwart's mailbox → `~/Library/Application Support/Rainbow/stalwart/`
- Caddy's serving config → regenerated each `make start`, lives under `infrastructure/`
- Configs you might edit → `config/rainbow.yaml`

## Troubleshooting

**"Login with Rainbow" button doesn't appear in Immich.** Run `services/immich/setup.sh` directly to see the actual error. Most commonly it means OAuth credentials aren't in Keychain — re-run `make setup-providers`.

**A service URL returns 502.** Check the service container is up: `make status`. Then check its logs: `make logs <service>`. If the service is healthy but Caddy 502s, the IP-substituted Caddyfile may be stale — `make stop && make start` re-runs the substitution.

**TLS handshake fails on a level-2 subdomain.** Cloudflare Universal SSL only covers level-1 subdomains. Make sure your hostname is `<service>.<zone>` (or `<prefix>-<service>.<zone>` on the shared zone), not `<service>.<prefix>.<zone>`. See `memory/project_test_subdomain_tls.md`.

**Authentik says "Request failed. Please try again later."** Caddy isn't trusting `X-Forwarded-Proto: https` from cloudflared. The Caddyfile template includes the fix (`trusted_proxies static private_ranges`); if you've edited it manually, make sure that block is there.
