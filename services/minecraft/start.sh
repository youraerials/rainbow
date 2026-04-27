#!/usr/bin/env bash
#
# start.sh — Start the Minecraft Paper server with optimized JVM flags.
#
# Uses Aikar's flags optimized for Paper servers, adapted for Apple Silicon.
# See: https://docs.papermc.io/paper/aikars-flags
#
# Usage: ./services/minecraft/start.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"
MC_DIR="$PROJECT_ROOT/infrastructure/minecraft/server"

if [ ! -f "$MC_DIR/paper.jar" ]; then
    echo "ERROR: Paper server not installed. Run: ./services/minecraft/install.sh" >&2
    exit 1
fi

MC_MEMORY=$(yq eval '.services.minecraft.memory // "4G"' "$CONFIG_FILE")

echo "Starting Minecraft server (memory: $MC_MEMORY)..."

cd "$MC_DIR"

# Aikar's flags adapted for Paper + Apple Silicon
exec java \
    -Xms"$MC_MEMORY" \
    -Xmx"$MC_MEMORY" \
    -XX:+UseG1GC \
    -XX:+ParallelRefProcEnabled \
    -XX:MaxGCPauseMillis=200 \
    -XX:+UnlockExperimentalVMOptions \
    -XX:+DisableExplicitGC \
    -XX:+AlwaysPreTouch \
    -XX:G1NewSizePercent=30 \
    -XX:G1MaxNewSizePercent=40 \
    -XX:G1HeapRegionSize=8M \
    -XX:G1ReservePercent=20 \
    -XX:G1HeapWastePercent=5 \
    -XX:G1MixedGCCountTarget=4 \
    -XX:InitiatingHeapOccupancyPercent=15 \
    -XX:G1MixedGCLiveThresholdPercent=90 \
    -XX:G1RSetUpdatingPauseTimePercent=5 \
    -XX:SurvivorRatio=32 \
    -XX:+PerfDisableSharedMem \
    -XX:MaxTenuringThreshold=1 \
    -Dusing.aikars.flags=https://mcflags.emc.gs \
    -Daikars.new.flags=true \
    -jar paper.jar \
    --nogui
