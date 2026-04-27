#!/usr/bin/env bash
#
# preflight.sh — Pre-installation checks for Rainbow.
# Verifies the system meets minimum requirements.
#
# Exit codes:
#   0 = all checks passed
#   1 = system does not meet requirements

set -euo pipefail

ERRORS=()

echo "Rainbow pre-flight checks..."

# ─── macOS version ───────────────────────────────────────────────
MACOS_VERSION=$(sw_vers -productVersion)
MAJOR=$(echo "$MACOS_VERSION" | cut -d. -f1)
if [ "$MAJOR" -lt 26 ]; then
    ERRORS+=("macOS 26 (Tahoe) or later required. Current: $MACOS_VERSION")
fi
echo "  macOS version: $MACOS_VERSION"

# ─── Architecture ────────────────────────────────────────────────
ARCH=$(uname -m)
if [ "$ARCH" != "arm64" ]; then
    ERRORS+=("Apple Silicon (arm64) required. Current: $ARCH")
fi
echo "  Architecture: $ARCH"

# ─── RAM ─────────────────────────────────────────────────────────
RAM_BYTES=$(sysctl -n hw.memsize)
RAM_GB=$((RAM_BYTES / 1073741824))
if [ "$RAM_GB" -lt 8 ]; then
    ERRORS+=("Minimum 8GB RAM required. Current: ${RAM_GB}GB")
fi
if [ "$RAM_GB" -lt 16 ]; then
    echo "  RAM: ${RAM_GB}GB (16GB+ recommended for all services)"
else
    echo "  RAM: ${RAM_GB}GB"
fi

# ─── Disk space ──────────────────────────────────────────────────
FREE_SPACE_KB=$(df -k / | tail -1 | awk '{print $4}')
FREE_SPACE_GB=$((FREE_SPACE_KB / 1048576))
if [ "$FREE_SPACE_GB" -lt 30 ]; then
    ERRORS+=("Minimum 30GB free disk space required. Current: ${FREE_SPACE_GB}GB")
fi
echo "  Free disk: ${FREE_SPACE_GB}GB"

# ─── Network ─────────────────────────────────────────────────────
if curl -s --max-time 5 https://cloudflare.com > /dev/null 2>&1; then
    echo "  Internet: connected"
else
    ERRORS+=("Internet connection required for installation")
fi

# ─── Existing installations ──────────────────────────────────────
if command -v container &>/dev/null; then
    echo "  Apple Container: found ($(container --version 2>/dev/null | head -1))"
else
    echo "  Apple Container: not found (will install)"
fi

if command -v brew &>/dev/null; then
    echo "  Homebrew: found"
else
    echo "  Homebrew: not found (will install)"
fi

# ─── Results ─────────────────────────────────────────────────────
echo ""
if [ ${#ERRORS[@]} -gt 0 ]; then
    echo "PRE-FLIGHT FAILED:"
    for err in "${ERRORS[@]}"; do
        echo "  - $err"
    done
    exit 1
else
    echo "All pre-flight checks passed."
    exit 0
fi
