#!/usr/bin/env bash
#
# postinstall.sh — Main installer logic for Rainbow.
# Runs after files are copied by the .pkg installer.
#
# This script:
#   1. Installs Homebrew if missing
#   2. Installs Apple Container + container-compose
#   3. Installs native services (Stalwart, Jellyfin)
#   4. Installs CLI tools (yq, jq, restic, cloudflared)
#   5. Sets up the rainbow CLI
#   6. Launches the setup wizard

set -euo pipefail

INSTALL_DIR="/opt/rainbow"
LOG_FILE="/tmp/rainbow-install.log"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

log "Starting Rainbow installation..."

# ─── 1. Homebrew ─────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
    log "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
        </dev/null >> "$LOG_FILE" 2>&1

    # Add to PATH for this session
    eval "$(/opt/homebrew/bin/brew shellenv)"
fi
log "Homebrew: $(brew --version | head -1)"

# ─── 2. Apple Container runtime ─────────────────────────────────
if ! command -v container &>/dev/null; then
    log "Installing Apple Container..."
    brew install container >> "$LOG_FILE" 2>&1

    log "Starting container system service..."
    container system start >> "$LOG_FILE" 2>&1
    # Wait for service to be ready
    for i in {1..15}; do
        if container system status &>/dev/null 2>&1; then
            break
        fi
        sleep 2
    done
fi
log "Apple Container: $(container --version 2>/dev/null || echo 'not ready')"

# ─── 3. container-compose ───────────────────────────────────────
if ! command -v container-compose &>/dev/null; then
    log "Installing container-compose..."
    brew install container-compose >> "$LOG_FILE" 2>&1
fi
log "container-compose: $(container-compose --version 2>/dev/null || echo 'installed')"

# ─── 4. CLI tools ───────────────────────────────────────────────
log "Installing CLI tools..."
brew install yq jq restic cloudflared >> "$LOG_FILE" 2>&1

# ─── 5. Java (for Minecraft, optional) ──────────────────────────
if ! command -v java &>/dev/null; then
    log "Installing Java 21..."
    brew install openjdk@21 >> "$LOG_FILE" 2>&1
fi

# ─── 6. Native services ─────────────────────────────────────────
log "Installing Stalwart mail server..."
brew install stalwart-mail >> "$LOG_FILE" 2>&1 || true

log "Installing Jellyfin..."
brew install jellyfin >> "$LOG_FILE" 2>&1 || true

# ─── 7. Set up Rainbow directory ──────────────────────────────────
log "Setting up Rainbow at $INSTALL_DIR..."

# Ensure directory exists and is owned by the user
if [ ! -d "$INSTALL_DIR" ]; then
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown -R "$(whoami)" "$INSTALL_DIR"
fi

# Copy project files if installing from pkg
if [ -d "/tmp/rainbow-pkg" ]; then
    cp -R /tmp/rainbow-pkg/* "$INSTALL_DIR/"
fi

# ─── 8. Create CLI symlink ──────────────────────────────────────
log "Setting up rainbow CLI..."
sudo mkdir -p /usr/local/bin
sudo ln -sf "$INSTALL_DIR/cli/rainbow" /usr/local/bin/rainbow
chmod +x "$INSTALL_DIR/cli/rainbow"

# ─── 9. Create data directories ─────────────────────────────────
mkdir -p "$INSTALL_DIR/stalwart"/{data,blob,fts,certs,logs,etc,dkim}
mkdir -p "$INSTALL_DIR/logs"

# ─── 10. Pull container images (background) ─────────────────────
log "Pulling container images in background..."
(
    cd "$INSTALL_DIR/infrastructure"
    container-compose pull >> "$LOG_FILE" 2>&1
) &

# ─── 11. Launch setup wizard ────────────────────────────────────
log "Installation complete. Launching setup wizard..."

# If the GUI app exists, launch it
if [ -d "$INSTALL_DIR/installer/gui/.build" ]; then
    open "$INSTALL_DIR/installer/gui/.build/release/SetupWizard"
else
    log "Setup wizard not built. Run manually:"
    log "  cd $INSTALL_DIR && rainbow config edit"
    log "  rainbow config apply"
    log "  rainbow start"
fi

log ""
log "Rainbow installation finished."
log "Log saved to: $LOG_FILE"
