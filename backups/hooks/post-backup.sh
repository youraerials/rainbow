#!/usr/bin/env bash
#
# post-backup.sh — Runs after each backup.
# Cleans up temporary files.

set -euo pipefail

PG_DUMP_FILE="/tmp/rainbow-pg-dump.sql"

if [ -f "$PG_DUMP_FILE" ]; then
    rm -f "$PG_DUMP_FILE"
    echo "[post-backup] Cleaned up PostgreSQL dump"
fi

echo "[post-backup] Backup post-processing complete"
