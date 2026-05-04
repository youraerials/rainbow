#!/usr/bin/env bash
#
# Reset Rainbow.command — double-click shortcut to wipe Rainbow.
#
# Lands at /Applications/Rainbow/Reset Rainbow.command via the .pkg
# payload. Opens Terminal when double-clicked from Finder. Useful
# when something's wedged and you want to start over without
# reinstalling immediately, or for repeated E2E test cycles.
#
# Confirms before doing anything destructive — the underlying
# scripts/reset-local.sh nukes containers, volumes, install tree,
# Keychain, and the rainbow.rocks subdomain claim.

set -uo pipefail

INSTALL_DIR="/Applications/Rainbow"
RESET_SCRIPT="$INSTALL_DIR/scripts/reset-local.sh"

if [ ! -x "$RESET_SCRIPT" ]; then
    echo "Rainbow doesn't seem to be installed (missing $RESET_SCRIPT)."
    echo "Nothing to reset."
    read -n 1 -s -r -p "Press any key to close this window..."
    exit 0
fi

# Resolve the subdomain to display in the confirm dialog. Same logic
# the reset script uses internally — peek at it so the user knows
# what's about to happen.
PREFIX=""
if [ -x "$INSTALL_DIR/bin/yq" ] && [ -f "$INSTALL_DIR/config/rainbow.yaml" ]; then
    PREFIX=$("$INSTALL_DIR/bin/yq" eval '.domain.prefix // ""' \
        "$INSTALL_DIR/config/rainbow.yaml" 2>/dev/null)
    [ "$PREFIX" = "null" ] && PREFIX=""
fi
if [ -z "$PREFIX" ] \
        && [ -f "$HOME/Library/Application Support/Rainbow/setup/setup-state.json" ]; then
    PREFIX=$(grep -oE '"prefix"[[:space:]]*:[[:space:]]*"[^"]*"' \
        "$HOME/Library/Application Support/Rainbow/setup/setup-state.json" \
        | head -1 | sed -E 's/.*"([^"]*)"$/\1/')
fi
DOMAIN="${PREFIX:+$PREFIX.}rainbow.rocks"

DIALOG_TEXT="This will completely reset Rainbow on this Mac.

Subdomain: $DOMAIN

What gets wiped:
  • Subdomain claim on rainbow.rocks
  • All Rainbow containers + ~6 GB of named volumes
    (photos, files, email — gone)
  • Install tree at /Applications/Rainbow
  • Keychain entries (rainbow-*)
  • Cloudflare tunnel auth (~/.cloudflared)

This cannot be undone. Continue?"

BUTTON=$(osascript \
    -e "set theText to \"$DIALOG_TEXT\"" \
    -e "display dialog theText buttons {\"Cancel\", \"Reset everything\"} default button \"Cancel\" cancel button \"Cancel\" with title \"Reset Rainbow\" with icon caution" \
    -e "button returned of result" 2>/dev/null || echo "Cancel")

if [ "$BUTTON" != "Reset everything" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Resetting Rainbow…"
echo ""
bash "$RESET_SCRIPT"
echo ""
read -n 1 -s -r -p "Done. Press any key to close this window..."
echo ""
