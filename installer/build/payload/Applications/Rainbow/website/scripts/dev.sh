#!/usr/bin/env bash
#
# dev.sh — Run the Rainbow brand site locally.
#
# Uses wrangler pages dev for parity with production (headers, redirects, etc.).
#
# Usage:
#   ./website/scripts/dev.sh           # Default port 8788
#   ./website/scripts/dev.sh --port 3000

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PORT=8788
for arg in "$@"; do
    case "$arg" in
        --port=*) PORT="${arg#--port=}" ;;
        --port)   shift; PORT="${1:-8788}" ;;
    esac
done

cd "$SITE_DIR"

echo "Serving Rainbow site on http://localhost:$PORT"
echo "Use Cmd+C to stop."
echo ""

# Use wrangler pages dev for header/redirect parity with production
exec npx --yes wrangler@4 pages dev . --port="$PORT" --compatibility-date=2024-12-01
