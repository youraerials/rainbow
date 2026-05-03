# Webmail (Snappymail)

Browser-based inbox at `https://<prefix>-webmail.<zone>/`. Talks IMAP/SMTP-
submission to the Stalwart container over the internal frontend network — no
public exposure of mail-server ports needed.

## What just works

The orchestrator pre-seeds Snappymail's per-domain config (via
`services/webmail/setup.sh`) with Stalwart's current IP and the right TLS
settings, so users don't need to know anything about the back end. Sign in
at `https://<prefix>-webmail.<zone>/` with your real Stalwart credentials
(e.g. `aubrey@test.rainbow.rocks` + the password you set during the wizard)
and the Inbox loads.

## Why a config has to be pre-seeded

Snappymail looks up its IMAP/SMTP server config by the email domain (the
part after `@`). With no matching config it falls back to a "default" that
points at `localhost:143` — login then fails with `Can't connect to host
"tcp://localhost:143"`. Apple Container has no DNS-by-name between
containers, so we can't write a generic `host = stalwart` either; the
config needs the current IP. `setup.sh` resolves it via `container inspect`
and writes a JSON config keyed on the email domain.

The setup hook re-runs:
- Once at the end of `start_minimum`
- Inside `services/refresh-caddy.sh`, which is called after every container
  restart through the daemon

So Stalwart IP changes (any restart) propagate without manual intervention.

## Admin panel (optional)

For Snappymail's own admin UI (themes, multi-domain, plugins) visit:
```
https://<prefix>-webmail.<zone>/?admin
```
The default username is `admin`; the password is generated on first run
and stored inside the container at
`/var/lib/snappymail/_data_/_default_/admin_password.txt`. Read it with:
```bash
container exec rainbow-webmail cat /var/lib/snappymail/_data_/_default_/admin_password.txt
```

You don't need this for normal use — only if you want to customize.

## Limitations

- **No external IMAP/SMTP from outside the LAN.** Stalwart's mail-server
  ports (993/465/etc.) aren't exposed via Caddy or Cloudflare Tunnel
  because those paths only carry HTTP. Snappymail is on the same `frontend`
  network as Stalwart and reaches it directly. Mail clients on the public
  internet still can't reach those ports — by design. If you want
  Apple Mail / Thunderbird from anywhere, run a Tailscale mesh or pay
  for Cloudflare Spectrum.
- **Self-signed cert on the IMAP/SMTP listeners.** Stalwart issues its own
  cert during the wizard. Public CA termination would only matter if
  external clients hit those ports, which they can't. The pre-seed sets
  `verify_peer = false / allow_self_signed = true` so Snappymail accepts
  the cert inside the container network.
- **Calendar/Contacts** (CalDAV/CardDAV) live on Stalwart's HTTP port —
  reachable over the tunnel at `https://<prefix>-mail.<zone>/` for clients
  that speak those protocols, but Snappymail itself doesn't surface them.
