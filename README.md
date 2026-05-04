# Rainbow

**Take back your digital life.** Rainbow turns a Mac Mini into a complete self-hosted platform — email, photos, files, documents, media, and AI — replacing Google and other cloud services. All your data stays on your hardware.

## What You Get

| Service | Powered By |
|---------|-----------|
| Photos & Videos | [Immich](https://immich.app) |
| Email, Calendar, Contacts | [Stalwart](https://stalw.art) |
| Collaborative Documents | [CryptPad](https://cryptpad.org) |
| File Sharing & Sync | [Seafile](https://www.seafile.com) |
| Media Server | [Jellyfin](https://jellyfin.org) |
| Identity & SSO | [Authentik](https://goauthentik.io) |
| AI App Builder | Claude API |
| Encrypted Backups | [Restic](https://restic.net) |

**Naming layout** (level-1 subdomains, all covered by Cloudflare Universal SSL):

- Dashboard / web tier — `<prefix>.<zone>` (e.g. `aubrey.rainbow.rocks`) or just `<zone>` for BYO domain (e.g. `example.com`)
- Each service — `<prefix>-<service>.<zone>` (e.g. `aubrey-auth.rainbow.rocks`, `aubrey-photos.rainbow.rocks`) or `<service>.<zone>` for BYO (e.g. `auth.example.com`)

## Status

**Rainbow is in early development.** Validated end-to-end on macOS 26 with 13 containers running, working SSO between Authentik and Immich, all six service URLs serving HTTPS through a real Cloudflare Tunnel. Many sharp edges remain — see "What works / What doesn't" below.

There is no separate "dev mode." Rainbow is tested through a real Cloudflare Tunnel against a real domain, the same way users will run it.

## Quick Start

### Prerequisites

- Mac Mini or Mac laptop, M1 or later, 16GB+ RAM
- macOS 26 (Tahoe) or later
- A Cloudflare account with a zone you control (e.g. `rainbow.rocks` or your own domain)
- ~10 GB free disk for container images

### Install

```bash
# 1. Clone this repo
git clone https://github.com/youraerials/rainbow.git
cd rainbow

# 2. Install dependencies (Apple Container, cloudflared, restic, yq, jq)
make install

# 3. Set up a Cloudflare Tunnel — opens browser for cloudflared login
#    Defaults to prefix=test on rainbow.rocks. Override with --prefix or --domain.
make setup-test-tunnel

# 4. Seed remaining secrets in macOS Keychain
for s in postgres-password authentik-secret authentik-bootstrap-password \
         mariadb-root-password seafile-admin-password cryptpad-admin-key \
         immich-admin-password; do
  security add-generic-password -s "rainbow-$s" -a rainbow -w "$(openssl rand -hex 24)" -U
done

# 5. Generate per-service configs and start the stack
make setup
make start

# 6. Open Authentik and create an API token (one-time, manual)
#    Visit https://<prefix>-auth.<zone> → Admin → Directory → Tokens & App passwords → Create
#    User: akadmin, Intent: API Token, Expiring: off → Copy the Key
security add-generic-password -s rainbow-authentik-api-token -a rainbow -w '<paste-key>'

# 7. Configure OAuth providers and apply to services
./services/authentik/setup-providers.sh
make stop && make start    # post-start hooks pick up the new credentials

# 8. Check status
make status
```

After step 7, opening `https://<prefix>.<zone>` lands on the dashboard, and `https://<prefix>-photos.<zone>` shows a "Login with Rainbow" button for full SSO.

## What works / What doesn't

| | Status |
|---|---|
| Apple Container orchestration via `services/orchestrator.sh` | ✓ |
| HTTPS via Cloudflare Tunnel + Universal SSL on level-1 subdomains | ✓ |
| Authentik bootstrap + login | ✓ |
| Immich SSO (Authentik OIDC, auto-register) | ✓ end-to-end |
| Caddy routes to all 6 service hostnames | ✓ |
| Postgres + Valkey + MariaDB shared by app services | ✓ |
| Dashboard (React) served as static bundle | ✓ (no API backend yet) |
| Stalwart admin UI reachable | ✓ (first-run setup is manual) |
| Jellyfin reachable | ✓ (no Metal hwaccel — see CLAUDE.md trade-off) |
| Seafile reachable, Authentik provider configured | partial — `seahub_settings_extra.py` not yet auto-injected into the container |
| CryptPad SSO | not yet (needs Authentik proxy outpost) |
| Mail send/receive (incoming SMTP) | not yet (needs port 25 ingress) |
| Backups via Restic | scaffolded, not exercised |
| MCP gateway routing | scaffolded, not running |

## Architecture

```
Internet
  │
  ▼
Cloudflare Edge (Universal SSL on *.rainbow.rocks)
  │
  ▼  outbound-only encrypted tunnel
cloudflared container
  │
  ▼  HTTP via container network
Caddy (reverse proxy, IP-substituted at runtime)
  │
  ├─→ Authentik (auth + SSO)
  ├─→ Immich (photos)
  ├─→ Stalwart (email)
  ├─→ Seafile (files) → MariaDB
  ├─→ CryptPad (docs)
  ├─→ Jellyfin (media)
  └─→ Dashboard (static bundle)

(Postgres + Valkey on a separate `backend` network, not directly exposed)
```

**Zero open ports for HTTPS.** Cloudflare Tunnel creates an outbound-only encrypted connection from your Mac to Cloudflare's edge. No router port forwarding needed. SMTP for mail (if you want to receive externally) does need separate ingress.

**Apple Container, not Docker.** Each service runs in its own lightweight VM via Virtualization.framework. Stronger isolation than docker bridge networking, at the cost of no DNS-by-name between containers — which is why the orchestrator does runtime IP substitution. See `services/orchestrator.sh`.

## CLI

```bash
rainbow start [service]    # Start all or one service
rainbow stop [service]     # Stop all or one service
rainbow status             # Show service status and URLs
rainbow logs <service>     # Follow service logs
rainbow config apply       # Regenerate configs from rainbow.yaml
rainbow backup             # Run a Restic snapshot now
rainbow update             # Pull latest images and restart
```

## Configuration

Everything lives in `config/rainbow.yaml`. Edit it, then `make config && make start`. Secrets stay in macOS Keychain — `generate-config.sh` reads them at render time and writes them into per-service `.env` files under `infrastructure/`.

## Backups

Restic-encrypted, deduplicated, to any S3-compatible storage (S3, B2, Cloudflare R2, etc.). All data is encrypted client-side before upload — the cloud provider can't read it. Default retention: 7 daily, 4 weekly, 6 monthly.

## Resetting for a fresh install (testing)

When you're iterating on the installer and need to verify it from a truly clean state — the kind of clean a brand-new Mac would be in — run:

```bash
bash scripts/reset-local.sh
```

That puts the machine back into "never had Rainbow on it" state. After it finishes you can install `Rainbow.pkg` again and the installer will take you through the wizard from scratch.

The script does ten things, in order. Most of them are obvious; the non-obvious ones are footnoted because we've burned hours on them.

1. **Capture the subdomain API secret** from Keychain, the running install, or `~/Downloads/Rainbow.pkg`. Needed for step 2 — must be done before we wipe anything.
2. **Release the subdomain claim** on the rainbow.rocks Worker so the next install can re-claim it. Without this, the Worker returns `409 already claimed` and the wizard fails at the claim step. ¹
3. **Kill any stuck Rainbow processes** (orchestrator, setup hooks, wizard).
4. **Bootout `rocks.rainbow.{control,setup}` LaunchAgents** and delete their plists.
5. **Cold-restart Apple Container** — `system stop`, bootout the apiserver AND the three vmnet plugins (`default`, `backend`, `frontend`), then `system start`. ²
6. **Delete every container.**
7. **Delete every cached image** (Rainbow's and any pulled upstreams).
8. **Delete every `rainbow-*` named volume.** ³
9. **Remove `/Applications/Rainbow/`, `~/Library/Application Support/Rainbow/`, `~/.cloudflared/`, and `/tmp/rainbow-install.log`.**
10. **Clear every `rainbow-*` Keychain entry.**

¹ The Worker's `/release` is best-effort: if Cloudflare's tunnel-delete API fails (e.g. the cloudflared connector is still running), it logs a `partialFailures` entry but always wipes the KV record so the subdomain stays reclaimable. The next `/provision` finds the orphan tunnel by name and deletes it before creating a new one — so a partial release isn't a permanent stuck state.

² Stale vmnet plugin processes are the most consistent source of "Apple Container is broken" symptoms (host can't reach container IPs, containers can't reach the internet, `--publish` doesn't forward). A clean stop+bootout-plugins+start gets the host-side bridge interface (`bridge100`, etc.) reconfigured.

³ Apple Container's named volumes live at `~/Library/Application Support/com.apple.container/volumes/rainbow-*/`, which is **outside** `~/Library/Application Support/Rainbow/`. Without explicitly deleting them, postgres and mariadb come up reusing the data dir from the previous install — but with a new password from the wizard's mint-secrets, which doesn't match the existing user, which causes every Authentik / Immich / Seafile auth to fail.

## License

Apache 2.0 — see [LICENSE](LICENSE) for details. Rainbow orchestrates several open-source projects (Immich, Stalwart, CryptPad, Jellyfin, Seafile, Authentik, Caddy, PostgreSQL, MariaDB, Valkey, Restic) which retain their own licenses. Rainbow does not bundle these — they run as separate container processes. See [NOTICE](NOTICE) for full attribution.
