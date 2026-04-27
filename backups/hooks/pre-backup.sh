#!/usr/bin/env bash
#
# pre-backup.sh — Runs before each backup.
# Dumps PostgreSQL databases so they can be backed up consistently.

set -euo pipefail

PG_DUMP_FILE="/tmp/rainbow-pg-dump.sql"

echo "[pre-backup] Dumping PostgreSQL databases..."

container exec rainbow-postgres pg_dumpall -U "${POSTGRES_USER:-rainbow}" > "$PG_DUMP_FILE" 2>/dev/null || {
    echo "[pre-backup] WARNING: PostgreSQL dump failed (is the container running?)"
}

if [ -f "$PG_DUMP_FILE" ]; then
    local_size=$(du -h "$PG_DUMP_FILE" | cut -f1)
    echo "[pre-backup] PostgreSQL dump: $local_size"
fi
