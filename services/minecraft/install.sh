#!/usr/bin/env bash
#
# install.sh — Download and set up a Paper Minecraft server.
#
# Usage: ./services/minecraft/install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"
MC_DIR="$PROJECT_ROOT/infrastructure/minecraft/server"

# Paper API for latest builds
PAPER_API="https://api.papermc.io/v2"
MC_VERSION="1.21.4"

echo "Installing Minecraft Paper Server..."

# ─── Ensure Java is installed ────────────────────────────────────
if ! command -v java &>/dev/null; then
    echo "Installing Java 21 (required for Minecraft)..."
    brew install openjdk@21
    # Symlink so java is on PATH
    sudo ln -sfn "$(brew --prefix openjdk@21)/libexec/openjdk.jdk" /Library/Java/JavaVirtualMachines/openjdk-21.jdk
else
    JAVA_VERSION=$(java -version 2>&1 | head -1 | cut -d'"' -f2 | cut -d'.' -f1)
    echo "Java found: version $JAVA_VERSION"
    if [ "$JAVA_VERSION" -lt 21 ]; then
        echo "WARNING: Java 21+ recommended for Minecraft. Current: $JAVA_VERSION"
    fi
fi

# ─── Download Paper ��─────────────────────────────────────────────
mkdir -p "$MC_DIR"

echo "Fetching latest Paper build for MC $MC_VERSION..."
LATEST_BUILD=$(curl -s "$PAPER_API/projects/paper/versions/$MC_VERSION/builds" | \
    jq -r '.builds[-1].build')

if [ -z "$LATEST_BUILD" ] || [ "$LATEST_BUILD" = "null" ]; then
    echo "ERROR: Could not fetch latest Paper build. Check your internet connection." >&2
    exit 1
fi

PAPER_JAR="paper-$MC_VERSION-$LATEST_BUILD.jar"
DOWNLOAD_URL="$PAPER_API/projects/paper/versions/$MC_VERSION/builds/$LATEST_BUILD/downloads/$PAPER_JAR"

if [ -f "$MC_DIR/$PAPER_JAR" ]; then
    echo "Paper $PAPER_JAR already downloaded."
else
    echo "Downloading Paper build $LATEST_BUILD..."
    curl -L -o "$MC_DIR/$PAPER_JAR" "$DOWNLOAD_URL"
    # Create/update symlink
    ln -sf "$PAPER_JAR" "$MC_DIR/paper.jar"
    echo "Downloaded: $PAPER_JAR"
fi

# ─��─ Accept EULA ─────────────────────────────────────────────────
echo "eula=true" > "$MC_DIR/eula.txt"

# ─── Generate server.properties ──────────────────────────────────
SERVER_NAME=$(yq eval '.services.minecraft.server_name // "Rainbow MC"' "$CONFIG_FILE")
MAX_PLAYERS=$(yq eval '.services.minecraft.max_players // 20' "$CONFIG_FILE")
DOMAIN=$(yq eval '.domain.primary' "$CONFIG_FILE")

if [ ! -f "$MC_DIR/server.properties" ]; then
    cat > "$MC_DIR/server.properties" <<EOF
# Rainbow Minecraft Server
server-name=$SERVER_NAME
motd=\u00a7b$SERVER_NAME \u00a77- Powered by Rainbow
max-players=$MAX_PLAYERS
server-port=25565
enable-rcon=true
rcon.port=25575
rcon.password=$(openssl rand -hex 16)
online-mode=true
difficulty=normal
gamemode=survival
view-distance=12
simulation-distance=8
spawn-protection=0
white-list=false
enforce-whitelist=false
level-name=world
level-seed=
EOF
    echo "Generated server.properties"

    # Store RCON password in Keychain
    RCON_PASS=$(grep "rcon.password" "$MC_DIR/server.properties" | cut -d= -f2)
    security add-generic-password -s "rainbow-minecraft-rcon-password" -a rainbow -w "$RCON_PASS" -U 2>/dev/null || true
else
    echo "server.properties already exists, preserving."
fi

# ─── Install launchd plist ───────────────────────────────────────
PLIST_SRC="$SCRIPT_DIR/launchd/io.papermc.server.plist"
PLIST_DST="$HOME/Library/LaunchAgents/io.papermc.server.plist"

if [ -f "$PLIST_DST" ]; then
    launchctl unload "$PLIST_DST" 2>/dev/null || true
fi

# Read memory config
MC_MEMORY=$(yq eval '.services.minecraft.memory // "4G"' "$CONFIG_FILE")

# Generate plist with correct paths and memory
sed \
    -e "s|{{MC_DIR}}|$MC_DIR|g" \
    -e "s|{{MC_MEMORY}}|$MC_MEMORY|g" \
    "$PLIST_SRC" > "$PLIST_DST"

echo ""
echo "Minecraft Paper Server installed at $MC_DIR"
echo ""
echo "Start with: rainbow start minecraft"
echo "Or manually: cd $MC_DIR && java -Xms${MC_MEMORY} -Xmx${MC_MEMORY} -jar paper.jar"
echo ""
echo "RCON password stored in Keychain (rainbow-minecraft-rcon-password)"
