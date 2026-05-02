# Stalwart — first-run setup

Stalwart 0.16 boots into bootstrap mode on first start (no persistent
`config.json` yet). Setup is web-driven and we drive it manually for now —
attempts to render a valid TOML config up-front and pre-empt the wizard ran
into Stalwart's strict per-store schema requirements (the daemon parses our
file fine but rejects the data-store section as malformed). The wizard runs
once and writes the canonical config to disk; subsequent restarts skip it.

Until that setup is complete `mcp-email` returns a "not configured" error —
no JMAP user exists for it to authenticate as, so there's nothing to do.

## One-time bring-up

1. **Find the temporary admin password.** Stalwart prints it to stdout on first
   boot. After `make start`:
   ```
   make logs stalwart | head -20
   ```
   Look for the box with `username: admin` and a 16-character password.

2. **Open the admin UI.** From the host:
   ```
   https://<prefix>-mail.<zone>/
   ```
   (e.g. `https://aubrey-mail.rainbow.rocks/`). Log in with `admin` and the
   password from step 1.

3. **Complete the wizard.** Click through the setup pages. Pick:
   - Storage backend: **RocksDB** (the default, embedded). Other choices are
     valid but require external services we haven't wired up.
   - Cluster: leave blank (single node).
   - Hostname: pre-filled from your config.

4. **Create your real admin user + a personal mailbox.** After the wizard, in
   the admin UI go to *Directory → Accounts* and create:
   - One **superuser** (email `you@<zone>`) — this is the JMAP login `mcp-email`
     uses.
   - Set a strong password.

5. **Save the JMAP credential to Keychain** so the orchestrator injects it into
   the rainbow-web container:
   ```
   security add-generic-password \
     -s rainbow-stalwart-jmap-user -a rainbow -w "you@<zone>" -U
   security add-generic-password \
     -s rainbow-stalwart-jmap-password -a rainbow -w "<password>" -U
   ```

6. **Restart the web tier** so it picks up the new env vars:
   ```
   curl -X POST -H "Authorization: Bearer $(security find-generic-password -s rainbow-control-token -w)" \
     http://localhost:9001/restart/rainbow-web
   ```

## Verifying mcp-email works

From the dashboard's Apps view, generate or hand-write an app that calls
`rainbow.email.search` and `rainbow.email.send`. Or call the MCP gateway
directly with a session cookie.

## What's deferred

- **Inbound mail (port 25 SMTP).** Needs a Cloudflare TCP-tunnel ingress or
  router port-forward. Until then Stalwart can only deliver/receive locally.
- **Outbound mail (relayed via SMTP/465 + DKIM).** DKIM key generation and the
  `[signature.dkim]` config block are out of the MVP. Re-add to
  `config/templates/stalwart/config.toml.j2` once mail flow is in scope.
- **Auto-config of the wizard.** Tracked in the `# Phase-1` comment at the top
  of `config.toml.j2`.
