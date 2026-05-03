#!/usr/bin/env bash
#
# webmail/setup.sh — Pre-seed Snappymail's domain config so users don't need
# to know anything about Stalwart's internal IP or port layout.
#
# Snappymail looks up an IMAP/SMTP server config by the email domain (the
# part after @). Without a matching config it falls back to a "default"
# which points at localhost:143 — and login fails with "Can't connect to
# tcp://localhost:143". We write a config keyed on `<zone>.json` whose
# servers point at Stalwart's current container IP with TLS-self-signed
# tolerance, since the cert Stalwart self-issues is only ever seen inside
# the frontend network.
#
# Idempotent. Re-runs are required whenever Stalwart's IP changes (i.e.
# anytime rainbow-stalwart is recreated). The orchestrator and the daemon's
# refresh path both call this.

set -euo pipefail

ORCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAINBOW_ROOT="$(cd "$ORCH_DIR/.." && pwd)"
CONFIG_FILE="$RAINBOW_ROOT/config/rainbow.yaml"

ZONE=$(yq eval '.domain.zone' "$CONFIG_FILE")
PREFIX=$(yq eval '.domain.prefix // ""' "$CONFIG_FILE")
[ "$PREFIX" = "null" ] && PREFIX=""
if [ -z "$ZONE" ] || [ "$ZONE" = "null" ]; then
    echo "[webmail/setup] domain.zone not set in $CONFIG_FILE" >&2
    exit 1
fi
# The email domain (the part after @) is the prefix + zone, e.g.
# `test.rainbow.rocks`. Snappymail keys per-domain configs by this
# value, not by the Cloudflare zone.
if [ -n "$PREFIX" ]; then
    EMAIL_DOMAIN="${PREFIX}.${ZONE}"
else
    EMAIL_DOMAIN="$ZONE"
fi

# Wait for the webmail container to be reachable for exec.
for _ in $(seq 1 20); do
    if container exec rainbow-webmail ls /var/lib/snappymail/_data_/_default_/domains \
            >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

# Resolve Stalwart's IP. Required — Snappymail can't reach it any other way
# (Apple Container has no DNS-by-name between containers).
STALWART_IP=$(container inspect rainbow-stalwart 2>/dev/null \
    | yq -p=json '.[0].networks[0].ipv4Address // ""' 2>/dev/null \
    | sed 's|/.*||' | head -n1)
if [ -z "$STALWART_IP" ]; then
    echo "[webmail/setup] rainbow-stalwart not running — can't resolve IP" >&2
    exit 1
fi

# Snappymail constructs ConnectSettings for IMAP, SMTP, AND Sieve at load
# time, even when Sieve is disabled — and PHP throws if any `host` field is
# null. So all three subsections need to be fully populated. We mirror the
# shape of the auto-generated default.json and only override the bits that
# matter for Stalwart.
SSL_BLOCK='{
            "verify_peer": false,
            "verify_peer_name": false,
            "allow_self_signed": true,
            "SNI_enabled": true,
            "disable_compression": true,
            "security_level": 1
        }'
SASL_BLOCK='[
            "PLAIN",
            "LOGIN"
        ]'

DOMAIN_CONFIG=$(cat <<EOF
{
    "IMAP": {
        "host": "${STALWART_IP}",
        "port": 993,
        "type": 1,
        "timeout": 300,
        "shortLogin": false,
        "lowerLogin": true,
        "sasl": ${SASL_BLOCK},
        "ssl": ${SSL_BLOCK},
        "disabled_capabilities": [
            "METADATA",
            "OBJECTID",
            "PREVIEW",
            "STATUS=SIZE"
        ],
        "use_expunge_all_on_delete": false,
        "fast_simple_search": true,
        "force_select": false,
        "message_all_headers": false,
        "message_list_limit": 10000,
        "search_filter": ""
    },
    "SMTP": {
        "host": "${STALWART_IP}",
        "port": 465,
        "type": 1,
        "timeout": 60,
        "shortLogin": false,
        "lowerLogin": true,
        "sasl": ${SASL_BLOCK},
        "ssl": ${SSL_BLOCK},
        "useAuth": true,
        "setSender": false,
        "usePhpMail": false
    },
    "Sieve": {
        "host": "${STALWART_IP}",
        "port": 4190,
        "type": 0,
        "timeout": 10,
        "shortLogin": false,
        "lowerLogin": true,
        "sasl": ${SASL_BLOCK},
        "ssl": ${SSL_BLOCK},
        "enabled": false
    },
    "whiteList": ""
}
EOF
)

DEST="/var/lib/snappymail/_data_/_default_/domains/${EMAIL_DOMAIN}.json"
echo "$DOMAIN_CONFIG" \
    | container exec -i rainbow-webmail tee "$DEST" >/dev/null

# Match ownership/perms of the other domain files (Snappymail runs as
# www-data and silently ignores files it can't read). The container exec
# wrote as root by default.
container exec rainbow-webmail sh -c "
    chown www-data:www-data '$DEST'
    chmod 600 '$DEST'
"

# Snappymail auto-generates a per-host domain file (rainbow-webmail.json)
# pointing at localhost:143 — that's the wrong default and PHP hangs trying
# to reach it from time to time. Remove it; Snappymail recreates it on its
# own as needed but our test.rainbow.rocks.json is keyed correctly so it
# always wins for the email domain we care about.
container exec rainbow-webmail rm -f \
    /var/lib/snappymail/_data_/_default_/domains/rainbow-webmail.json \
    >/dev/null 2>&1 || true

# Clear cached parsed configs so the next request re-reads from disk.
container exec rainbow-webmail sh -c '
    rm -rf /var/lib/snappymail/_data_/_default_/cache/* 2>/dev/null
' >/dev/null 2>&1 || true

echo "[webmail/setup] Pre-seeded domain ${EMAIL_DOMAIN} → IMAP+SMTP at ${STALWART_IP}"
