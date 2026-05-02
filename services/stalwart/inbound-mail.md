# Inbound mail via Cloudflare Email Workers

How real mail addressed to `you@<zone>` reaches Stalwart's Inbox without
opening any inbound ports on the Mac.

## Architecture

```
Sender's MTA  →  MX lookup → Cloudflare's MX servers
                              ↓
                       Cloudflare Email Routing
                              ↓
                  Email Worker (rainbow-email-receiver)
                              ↓  (HTTPS POST + HMAC)
                  https://<web>/api/inbound-mail
                              ↓
                    Caddy → web tier → JMAP Email/import
                              ↓
                       Stalwart Inbox
```

Cloudflare runs the SMTP listener on their network. The Worker turns the
RFC822 message into an HTTPS POST that flows through our existing tunnel —
no router port-forwarding, no Spectrum, no PTR/IP-reputation problems.

## One-time setup

Pre-requisite: Stalwart's wizard is complete, `rainbow-stalwart-jmap-user` and
`rainbow-stalwart-jmap-password` are in Keychain, mcp-email is registered.

### 1. Deploy the Worker

The shared HMAC secret is auto-minted in Keychain by `start_web` as
`rainbow-inbound-mail-secret`. Mirror it into the Worker:

```bash
cd cloudflare
SECRET=$(security find-generic-password -s rainbow-inbound-mail-secret -w)
echo "$SECRET" | wrangler secret put INBOUND_MAIL_SECRET \
    --config wrangler-email-receiver.toml
wrangler deploy --config wrangler-email-receiver.toml
```

(If `INBOUND_MAIL_URL` in `wrangler-email-receiver.toml` doesn't match your
deployment, edit it before deploying. Default is `https://test.rainbow.rocks/api/inbound-mail`.)

### 2. Enable Email Routing on your zone

In Cloudflare dashboard for the zone (`test.rainbow.rocks`):

1. **Email → Email Routing → Get started.** Cloudflare will offer to add the
   required MX + SPF records. Accept; that's how senders find your zone.
2. **Email Routing → Routes → Custom address.** Create a route:
   - Custom address: `aubrey@test.rainbow.rocks`
   - Action: **Send to a Worker**
   - Destination: `rainbow-email-receiver`
3. (Optional) **Catch-all address** with the same Worker if you want every
   address at this domain to land in your Inbox.

### 3. Test it

Send a test message from any external address (Gmail, etc.) to
`aubrey@test.rainbow.rocks`. Within 30s it should appear in Stalwart's Inbox
at `https://test-mail.rainbow.rocks/`. If it doesn't:

- **Cloudflare → Email Routing → Activity log:** shows whether the message
  reached the Worker.
- **Worker logs:** `wrangler tail --config wrangler-email-receiver.toml`.
- **Web tier logs:** `make logs web` — `[inbound-mail] import failed: ...`
  lines surface JMAP errors.
- **Curl smoke test (host):**
  ```bash
  SECRET=$(security find-generic-password -s rainbow-inbound-mail-secret -w)
  BODY="From: t@example.com
  To: aubrey@test.rainbow.rocks
  Subject: smoke test
  Date: $(date -u +'%a, %d %b %Y %H:%M:%S +0000')
  Message-ID: <smoke-$(date +%s)@example.com>

  body"
  SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')
  curl -X POST https://test.rainbow.rocks/api/inbound-mail \
    -H "Content-Type: message/rfc822" \
    -H "X-Rainbow-Inbound-Signature: sha256=$SIG" \
    --data-binary "$BODY"
  ```
  Expect `{"ok":true,"id":"..."}`. Anything else → tunnel or web tier issue.

## What's not handled yet

- **Multi-user routing.** Every accepted message currently lands in the JMAP
  user's Inbox (the one whose creds are in Keychain). When Rainbow grows
  multi-user we'll route by `To:` header → per-user mailbox.
- **Outbound mail.** This document is inbound only. Sending requires either
  a paid SMTP relay (Mailgun/Postmark/SES) or an outbound Worker that proxies
  Stalwart's submission traffic — separate piece of work.
- **DKIM signing.** Without outbound, this is moot. When we add outbound,
  generate the keypair, publish the public TXT record, and point Stalwart's
  signing config at the private key.
