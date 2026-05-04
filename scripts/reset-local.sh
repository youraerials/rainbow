#!/usr/bin/env bash
#
# reset-local.sh — Full teardown of a Rainbow install on this Mac.
#
# Use this when you want to E2E-test a fresh install: it puts the
# machine back into "never had Rainbow on it" state, including the
# remote subdomain claim on rainbow.rocks. Re-running the .pkg right
# after gives you a clean install.
#
# What it does, in order:
#   1. Captures the subdomain API secret (Keychain, .pkg payload, or
#      Downloads/Rainbow.pkg) before anything is wiped.
#   2. Releases the subdomain claim on the rainbow.rocks Worker so
#      the next install can re-claim it.
#   3. Kills any stuck orchestrator/setup/wizard processes.
#   4. Bootouts the rocks.rainbow.{control,setup} LaunchAgents and
#      removes their plists from disk.
#   5. Cold-restarts Apple Container — including bootouting the
#      vmnet network plugins. Without this step, stale plugin state
#      makes networking look broken on the next install (host can't
#      reach container IPs, container can't reach internet).
#   6. Deletes every container.
#   7. Deletes every cached image.
#   8. Deletes every rainbow-* named volume — these live OUTSIDE the
#      Rainbow install dirs and silently carry stateful data
#      (postgres password hashes, mariadb users, immich uploads)
#      across reinstalls. THIS IS THE STEP MOST CLEANUP SCRIPTS MISS.
#   9. Removes /Applications/Rainbow, ~/Library/Application Support/
#      Rainbow, ~/.cloudflared, and /tmp/rainbow-install.log.
#  10. Clears every rainbow-* macOS Keychain entry.
#
# Safe to re-run on a partially-cleaned system.

set -uo pipefail

WORKER_URL="${RAINBOW_SUBDOMAIN_WORKER_URL:-https://rainbow-subdomain-manager.misteranderson.workers.dev}"
SUBDOMAIN_NAME="${RAINBOW_SUBDOMAIN_NAME:-aubrey}"
CONTAINER_BIN="/usr/local/bin/container"

# ─── 1. Capture API secret ──────────────────────────────────────
echo "=== 1. Capture API secret before wiping ==="
SECRET=$(security find-generic-password -s rainbow-subdomain-api-secret -w 2>/dev/null)
if [ -z "${SECRET:-}" ] && [ -f /Applications/Rainbow/installer/.subdomain-api-secret ]; then
    SECRET=$(cat /Applications/Rainbow/installer/.subdomain-api-secret)
fi
if [ -z "${SECRET:-}" ] && [ -f "$HOME/Downloads/Rainbow.pkg" ]; then
    WORK=$(mktemp -d)
    pkgutil --expand-full "$HOME/Downloads/Rainbow.pkg" "$WORK/expanded" 2>/dev/null
    F=$(find "$WORK/expanded" -name '.subdomain-api-secret' 2>/dev/null | head -1)
    [ -n "$F" ] && SECRET=$(cat "$F")
    rm -rf "$WORK"
fi
echo "  secret captured: $([ -n "${SECRET:-}" ] && echo "yes" || echo "no — subdomain release will be skipped")"

# ─── 2. Release subdomain ──────────────────────────────────────
echo ""
echo "=== 2. Release subdomain on rainbow.rocks ==="
if [ -n "${SECRET:-}" ]; then
    AVAIL=$(curl -sS "$WORKER_URL/check/$SUBDOMAIN_NAME" | grep -o '"available":[a-z]*' | cut -d: -f2)
    if [ "$AVAIL" = "false" ]; then
        echo "  releasing $SUBDOMAIN_NAME..."
        curl -sS -X DELETE -H "Authorization: Bearer $SECRET" \
            "$WORKER_URL/release/$SUBDOMAIN_NAME"
        echo ""
    else
        echo "  $SUBDOMAIN_NAME already available"
    fi
else
    echo "  skipped (no secret)"
fi

# ─── 3. Kill stuck processes ───────────────────────────────────
echo ""
echo "=== 3. Kill any stuck Rainbow processes ==="
for p in 'orchestrator.sh' 'seafile/setup.sh' 'phase-b-setup' 'bootstrap-admin' 'setup-providers'; do
    pkill -f "$p" 2>/dev/null
done
sleep 1

# ─── 4. Bootout Rainbow LaunchAgents ───────────────────────────
echo "=== 4. Bootout Rainbow LaunchAgents + remove plists ==="
launchctl bootout "gui/$(id -u)/rocks.rainbow.setup"   2>/dev/null
launchctl bootout "gui/$(id -u)/rocks.rainbow.control" 2>/dev/null
rm -f "$HOME/Library/LaunchAgents/rocks.rainbow.control.plist" \
      "$HOME/Library/LaunchAgents/rocks.rainbow.setup.plist"

# ─── 5. Cold-restart Apple Container ───────────────────────────
echo "=== 5. Cold-restart Apple Container (clears stale vmnet plugins) ==="
"$CONTAINER_BIN" builder stop   2>/dev/null
"$CONTAINER_BIN" builder delete 2>/dev/null
"$CONTAINER_BIN" system stop    >/dev/null 2>&1
launchctl bootout "gui/$(id -u)/com.apple.container.apiserver" 2>/dev/null
for plugin in default backend frontend; do
    launchctl bootout "gui/$(id -u)/com.apple.container.container-network-vmnet.$plugin" 2>/dev/null
done
sleep 2
"$CONTAINER_BIN" system start --enable-kernel-install >/dev/null 2>&1
sleep 3

# ─── 6. Delete containers ──────────────────────────────────────
echo "=== 6. Delete all containers ==="
for c in $("$CONTAINER_BIN" ls -a 2>/dev/null | awk 'NR>1 {print $1}'); do
    "$CONTAINER_BIN" delete --force "$c" >/dev/null 2>&1
done

# ─── 7. Delete images ──────────────────────────────────────────
echo "=== 7. Delete all images ==="
for img in $("$CONTAINER_BIN" image ls 2>/dev/null | awk 'NR>1 {print $1":"$2}' | grep -v '^:'); do
    "$CONTAINER_BIN" image delete "$img" >/dev/null 2>&1
done

# ─── 8. Delete rainbow-* volumes (the gotcha) ──────────────────
echo "=== 8. Delete all rainbow-* container volumes ==="
for v in $("$CONTAINER_BIN" volume ls 2>/dev/null | awk 'NR>1 && /^rainbow-/ {print $1}'); do
    "$CONTAINER_BIN" volume delete "$v" >/dev/null 2>&1
    echo "  deleted: $v"
done

# ─── 9. Filesystem ─────────────────────────────────────────────
echo "=== 9. Remove install tree, support dir, tunnel auth, install log ==="
rm -rf /Applications/Rainbow
rm -rf "$HOME/Library/Application Support/Rainbow"
rm -rf "$HOME/.cloudflared"
rm -f /tmp/rainbow-install.log

# ─── 10. Keychain ──────────────────────────────────────────────
echo "=== 10. Clear all rainbow-* Keychain entries ==="
for s in $(security dump-keychain 2>/dev/null | awk -F'"' '/"svce"<blob>="rainbow-/ {print $4}' | sort -u); do
    security delete-generic-password -s "$s" >/dev/null 2>&1
done

echo ""
echo "=== Final state ==="
echo "Subdomain $SUBDOMAIN_NAME:        $(curl -sS "$WORKER_URL/check/$SUBDOMAIN_NAME" | grep -o '"available":[a-z]*' | cut -d: -f2)"
echo "Apple Container:           $("$CONTAINER_BIN" --version 2>/dev/null | head -1)"
echo "Containers:                $("$CONTAINER_BIN" ls -a 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
echo "Images:                    $("$CONTAINER_BIN" image ls 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
echo "Rainbow volumes:           $("$CONTAINER_BIN" volume ls 2>/dev/null | awk 'NR>1 && /^rainbow-/' | wc -l | tr -d ' ')"
echo "/Applications/Rainbow:     $(test -e /Applications/Rainbow && echo EXISTS || echo gone)"
echo "App Support/Rainbow:       $(test -e "$HOME/Library/Application Support/Rainbow" && echo EXISTS || echo gone)"
echo "~/.cloudflared:            $(test -e "$HOME/.cloudflared" && echo EXISTS || echo gone)"
echo "rainbow plists on disk:    $(ls "$HOME/Library/LaunchAgents/" 2>/dev/null | grep -c rainbow)"
echo "Port 9001:                 $(lsof -nP -iTCP:9001 -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
echo "rainbow-* keychain:        $(security dump-keychain 2>/dev/null | awk -F'"' '/"svce"<blob>="rainbow-/ {print $4}' | sort -u | wc -l | tr -d ' ')"
echo "/tmp/rainbow-install.log:  $(test -e /tmp/rainbow-install.log && echo EXISTS || echo gone)"
echo ""
echo "Ready for a fresh Rainbow.pkg install."
