# Networking

Rainbow uses a three-layer networking approach to handle the realities of home internet connections.

## Layer 1: Cloudflare Tunnel (Primary)

All HTTP/HTTPS services are accessed via Cloudflare Tunnel. This is the default and recommended path.

```
Internet -> Cloudflare Edge -> Tunnel (outbound-only) -> Caddy -> Service
```

**Dynamic IP is irrelevant here.** The tunnel maintains a persistent outbound connection. When your ISP changes your IP, `cloudflared` reconnects automatically. DNS records point to the tunnel, not your IP.

## Layer 2: Local Network Access

Users on the same LAN as the Mac Mini can access services directly without routing through Cloudflare. This is faster and works if the internet is down.

```bash
# Set up local access
./services/network/local-dns.sh setup

# Access via LAN IP
http://192.168.1.x:2283    # Photos (Immich)
http://192.168.1.x:8080    # Email (Stalwart)
http://192.168.1.x:8096    # Media (Jellyfin)
```

## Layer 3: Dynamic DNS (Edge Cases)

A few services benefit from having a DNS record pointing to the actual public IP:

- **Minecraft**: Players connecting directly (lower latency than tunnel)
- **SMTP**: Some mail servers prefer direct connections

The DDNS updater runs every 5 minutes via launchd, checks the public IP, and updates Cloudflare DNS records only when the IP changes.

```
mc-direct.yourdomain.rainbow.rocks -> your public IP (A record, unproxied)
smtp.yourdomain.rainbow.rocks      -> your public IP (A record, unproxied)
```

### Setup

The DDNS updater is installed automatically. To manage it manually:

```bash
# Check if running
launchctl list | grep rainbow.ddns

# Run manually
./services/network/ddns-update.sh

# View logs
tail -f /opt/rainbow/logs/ddns.log
```

### Port Forwarding

For direct-IP services, you'll need to forward ports on your router:

| Service | Port | Required? |
|---------|------|-----------|
| Minecraft | 25565 | Only if Minecraft enabled |
| SMTP | 25, 587 | Only if self-hosting email without relay |

All other services use Cloudflare Tunnel and need **no port forwarding**.

## Email Considerations

Self-hosting email on a residential connection has challenges:

1. **Port 25 blocked**: Most ISPs block inbound port 25. Cloudflare Tunnel handles this by proxying TCP.
2. **IP reputation**: Residential IPs are often on spam blocklists. Consider:
   - Using a SMTP relay (Cloudflare Email Routing, Amazon SES, Mailgun) for outbound
   - Keeping Stalwart for inbound + local delivery
3. **Reverse DNS (rDNS)**: Residential ISPs rarely let you set rDNS. Some receiving servers check this. The Cloudflare Tunnel approach sidesteps this since mail comes from Cloudflare's IP.

The pragmatic approach: use Stalwart for everything and see if it works. If deliverability is an issue, add an outbound SMTP relay — this can be configured in Stalwart without changing anything else.
