#!/usr/bin/env bash
#
# manage.sh — Unified service management for native (non-Docker) services.
# Used by the CLI for Stalwart, Jellyfin, and Minecraft.
#
# Usage: ./services/manage.sh <start|stop|status|restart> <service>

set -euo pipefail

ACTION="${1:-}"
SERVICE="${2:-}"

if [ -z "$ACTION" ] || [ -z "$SERVICE" ]; then
    echo "Usage: manage.sh <start|stop|status|restart> <stalwart|jellyfin|minecraft>" >&2
    exit 1
fi

case "$SERVICE" in
    stalwart)
        case "$ACTION" in
            start)   brew services start stalwart-mail ;;
            stop)    brew services stop stalwart-mail ;;
            restart) brew services restart stalwart-mail ;;
            status)
                if pgrep -x stalwart-mail &>/dev/null; then
                    echo "stalwart: running (pid $(pgrep -x stalwart-mail))"
                else
                    echo "stalwart: stopped"
                fi
                ;;
        esac
        ;;
    jellyfin)
        case "$ACTION" in
            start)   brew services start jellyfin ;;
            stop)    brew services stop jellyfin ;;
            restart) brew services restart jellyfin ;;
            status)
                if pgrep -x jellyfin &>/dev/null; then
                    echo "jellyfin: running (pid $(pgrep -x jellyfin))"
                else
                    echo "jellyfin: stopped"
                fi
                ;;
        esac
        ;;
    minecraft)
        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        MC_DIR="$SCRIPT_DIR/../infrastructure/minecraft/server"
        case "$ACTION" in
            start)
                if pgrep -f "paper.*\.jar" &>/dev/null; then
                    echo "Minecraft is already running"
                else
                    bash "$SCRIPT_DIR/minecraft/start.sh"
                fi
                ;;
            stop)
                pkill -f "paper.*\.jar" 2>/dev/null && echo "Minecraft stopped" || echo "Minecraft was not running"
                ;;
            restart)
                pkill -f "paper.*\.jar" 2>/dev/null || true
                sleep 2
                bash "$SCRIPT_DIR/minecraft/start.sh"
                ;;
            status)
                if pgrep -f "paper.*\.jar" &>/dev/null; then
                    echo "minecraft: running (pid $(pgrep -f 'paper.*\.jar' | head -1))"
                else
                    echo "minecraft: stopped"
                fi
                ;;
        esac
        ;;
    *)
        echo "Unknown service: $SERVICE" >&2
        exit 1
        ;;
esac
