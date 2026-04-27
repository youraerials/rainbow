#!/usr/bin/env bash
#
# backup.sh — Run an encrypted backup of all Rainbow data using Restic.
#
# Usage:
#   ./backups/backup.sh           # Full backup
#   ./backups/backup.sh --dry-run # Show what would be backed up

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/config/rainbow.yaml"
HOOKS_DIR="$SCRIPT_DIR/hooks"
DRY_RUN=false

if [ "${1:-}" = "--dry-run" ]; then
    DRY_RUN=true
fi

# ─── Load config ─────────────────────────────────────────────────
if ! command -v yq &>/dev/null; then
    echo "ERROR: yq is required. Install with: brew install yq" >&2
    exit 1
fi

BACKUP_ENABLED=$(yq eval '.backups.enabled // true' "$CONFIG_FILE")
if [ "$BACKUP_ENABLED" != "true" ]; then
    echo "Backups are disabled in rainbow.yaml"
    exit 0
fi

RESTIC_REPOSITORY=$(yq eval '.backups.repository' "$CONFIG_FILE")
if [ -z "$RESTIC_REPOSITORY" ] || [ "$RESTIC_REPOSITORY" = "null" ]; then
    echo "ERROR: No backup repository configured in rainbow.yaml" >&2
    exit 1
fi

# Load Restic password from Keychain
RESTIC_PASSWORD=$(security find-generic-password -s "rainbow-restic-password" -w 2>/dev/null || echo "")
if [ -z "$RESTIC_PASSWORD" ]; then
    echo "ERROR: Restic password not found in Keychain." >&2
    echo "Store it with: security add-generic-password -s rainbow-restic-password -a rainbow -w 'your-password'" >&2
    exit 1
fi

export RESTIC_REPOSITORY
export RESTIC_PASSWORD

# Load cloud credentials from Keychain if using S3
if [[ "$RESTIC_REPOSITORY" == s3:* ]]; then
    export AWS_ACCESS_KEY_ID=$(security find-generic-password -s "rainbow-aws-access-key" -w 2>/dev/null || echo "")
    export AWS_SECRET_ACCESS_KEY=$(security find-generic-password -s "rainbow-aws-secret-key" -w 2>/dev/null || echo "")
fi

KEEP_DAILY=$(yq eval '.backups.retention.keep_daily // 7' "$CONFIG_FILE")
KEEP_WEEKLY=$(yq eval '.backups.retention.keep_weekly // 4' "$CONFIG_FILE")
KEEP_MONTHLY=$(yq eval '.backups.retention.keep_monthly // 6' "$CONFIG_FILE")

# ─── Pre-backup hooks ───────────────────────────────────────────
echo "[backup] Starting backup at $(date)"

if [ -x "$HOOKS_DIR/pre-backup.sh" ]; then
    echo "[backup] Running pre-backup hooks..."
    bash "$HOOKS_DIR/pre-backup.sh"
fi

# ─── Initialize repo if needed ───────────────────────────────────
if ! restic snapshots &>/dev/null; then
    echo "[backup] Initializing restic repository..."
    restic init
fi

# ─── Build file list ─────────────────────────────────────────────
BACKUP_PATHS=()

# PostgreSQL dump (created by pre-backup hook)
PG_DUMP="/tmp/rainbow-pg-dump.sql"
if [ -f "$PG_DUMP" ]; then
    BACKUP_PATHS+=("$PG_DUMP")
fi

# Service data directories
INFRA_DIR="$PROJECT_ROOT/infrastructure"
for dir in \
    "$INFRA_DIR/immich/upload" \
    "$INFRA_DIR/seafile/data" \
    "$INFRA_DIR/cryptpad/blob" \
    "$INFRA_DIR/cryptpad/block" \
    "$INFRA_DIR/cryptpad/data" \
    "$INFRA_DIR/authentik/media" \
    "$INFRA_DIR/minecraft/server/world" \
; do
    if [ -d "$dir" ]; then
        BACKUP_PATHS+=("$dir")
    fi
done

# Stalwart mail data
STALWART_DATA=$(yq eval '.services.stalwart.data_path' "$CONFIG_FILE")
if [ -d "$STALWART_DATA" ]; then
    BACKUP_PATHS+=("$STALWART_DATA")
fi

# Config
BACKUP_PATHS+=("$PROJECT_ROOT/config/rainbow.yaml")

# Custom apps
if [ -d "$PROJECT_ROOT/app-builder/apps" ]; then
    BACKUP_PATHS+=("$PROJECT_ROOT/app-builder/apps")
fi

# ─── Run backup ──────────────────────────────────────────────────
if $DRY_RUN; then
    echo "[backup] DRY RUN - would back up:"
    for p in "${BACKUP_PATHS[@]}"; do
        echo "  $p"
    done
    exit 0
fi

echo "[backup] Backing up ${#BACKUP_PATHS[@]} paths..."
restic backup \
    --verbose \
    --tag rainbow \
    "${BACKUP_PATHS[@]}"

# ─── Retention policy ───────────────────────────────────────────
echo "[backup] Applying retention policy..."
restic forget \
    --keep-daily "$KEEP_DAILY" \
    --keep-weekly "$KEEP_WEEKLY" \
    --keep-monthly "$KEEP_MONTHLY" \
    --prune

# ─── Post-backup hooks ──────────────────────────────────────────
if [ -x "$HOOKS_DIR/post-backup.sh" ]; then
    echo "[backup] Running post-backup hooks..."
    bash "$HOOKS_DIR/post-backup.sh"
fi

echo "[backup] Backup completed at $(date)"
