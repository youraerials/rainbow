#!/usr/bin/env bash
#
# preflight.sh — Pre-installation checks for the Rainbow .pkg.
#
# Runs as the FIRST step of the installer (before file copy). If any check
# fails, the installer aborts. Keep this fast and minimal — runtime checks
# (brew installed, container CLI working, etc.) happen later in the web
# wizard's preflight step. This one just verifies the box is even
# remotely capable.
#
# Exit codes:
#   0 = all checks passed
#   1 = system does not meet requirements

set -euo pipefail

ERRORS=()

# macOS 26 (Tahoe) — Apple Container requires it.
MACOS_VERSION=$(sw_vers -productVersion)
MAJOR=$(echo "$MACOS_VERSION" | cut -d. -f1)
if [ "$MAJOR" -lt 26 ]; then
    ERRORS+=("macOS 26 (Tahoe) or later required. Current: $MACOS_VERSION")
fi

# Apple Silicon — we don't support Intel Macs (Apple Container is arm64-only).
ARCH=$(uname -m)
if [ "$ARCH" != "arm64" ]; then
    ERRORS+=("Apple Silicon (arm64) required. Current: $ARCH")
fi

# 8 GB RAM minimum (Authentik + Postgres + Immich ML alone need ~4 GB).
RAM_BYTES=$(sysctl -n hw.memsize)
RAM_GB=$((RAM_BYTES / 1073741824))
if [ "$RAM_GB" -lt 8 ]; then
    ERRORS+=("Minimum 8 GB RAM required. Current: ${RAM_GB} GB")
fi

# 30 GB free for container images + initial service data.
FREE_KB=$(df -k / | tail -1 | awk '{print $4}')
FREE_GB=$((FREE_KB / 1048576))
if [ "$FREE_GB" -lt 30 ]; then
    ERRORS+=("Minimum 30 GB free disk required. Current: ${FREE_GB} GB")
fi

if [ ${#ERRORS[@]} -gt 0 ]; then
    echo "Rainbow installer pre-flight failed:"
    for err in "${ERRORS[@]}"; do echo "  • $err"; done
    exit 1
fi

# ─── Detect existing install + offer to reset ────────────────────
# Runs as root in the .pkg sandbox. The current /Applications/Rainbow
# is still the OLD install at this point — payload extraction
# happens AFTER preinstall returns. So we can read the prior wizard's
# state, prompt the user, and run the OLD reset-local.sh cleanly
# before the new payload lands.
PRIMARY_USER="${USER:-$(stat -f '%Su' /dev/console)}"
USER_HOME=$(eval echo "~$PRIMARY_USER")
SETUP_STATE="$USER_HOME/Library/Application Support/Rainbow/setup/setup-state.json"
PREV_PREFIX=""
if [ -f "$SETUP_STATE" ]; then
    PREV_PREFIX=$(grep -oE '"prefix"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETUP_STATE" \
        | head -1 \
        | sed -E 's/.*"([^"]*)"$/\1/')
fi

OLD_RESET_SCRIPT="/Applications/Rainbow/scripts/reset-local.sh"
if [ -n "$PREV_PREFIX" ] && [ -x "$OLD_RESET_SCRIPT" ]; then
    DOMAIN="${PREV_PREFIX}.rainbow.rocks"
    DIALOG_TEXT="Rainbow is already installed on this Mac (subdomain ${DOMAIN}).

You can keep your existing install (the new package will overwrite the install tree but leave your data, containers, and Keychain entries alone) or reset everything for a clean install.

Resetting wipes:
  • Subdomain claim on rainbow.rocks
  • All Rainbow containers and ~6 GB of named volumes (photos, files, mail — gone)
  • Install tree at /Applications/Rainbow
  • Keychain entries (rainbow-*)
  • Cloudflare tunnel auth (~/.cloudflared)"

    # osascript runs as user (the GUI session). default button is
    # the rightmost — we make Keep the default so destructive Reset
    # requires a deliberate click.
    BUTTON=$(sudo -u "$PRIMARY_USER" osascript \
        -e "set theDialog to \"$DIALOG_TEXT\"" \
        -e "display dialog theDialog buttons {\"Cancel\", \"Reset & install\", \"Keep existing\"} default button \"Keep existing\" cancel button \"Cancel\" with title \"Rainbow installer\" with icon caution" \
        -e "button returned of result" 2>/dev/null || echo "Cancel")

    case "$BUTTON" in
        "Reset & install")
            echo "User chose to reset before installing — running ${OLD_RESET_SCRIPT}"
            sudo -u "$PRIMARY_USER" -E env \
                RAINBOW_SUBDOMAIN_NAME="$PREV_PREFIX" \
                bash "$OLD_RESET_SCRIPT"
            ;;
        "Keep existing")
            echo "User chose to keep existing install — overwriting install tree only"
            ;;
        *)
            echo "User cancelled installation"
            exit 1
            ;;
    esac
fi

exit 0
