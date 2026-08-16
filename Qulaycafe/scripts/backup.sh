#!/usr/bin/env bash
# Simple disaster-recovery backup: copies the live SQLite database to a
# timestamped file, then prunes backups older than 30 days.
#
# Usage on the server (crontab -e):
#   0 3 * * * /path/to/app/scripts/backup.sh >> /var/log/restaurant-backup.log 2>&1
#
# For true disaster recovery, also sync the backups/ folder to off-server
# storage (see DEPLOYMENT_AND_HARDENING.md, section "Backups & Disaster
# Recovery") — a backup that lives on the same disk as the original doesn't
# survive a disk failure.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${DATABASE_DIR:-$APP_DIR/data}"
DB_FILE="$DATA_DIR/restaurant.db"
BACKUP_DIR="$DATA_DIR/backups"
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_FILE" ]; then
  echo "No database file found at $DB_FILE — nothing to back up."
  exit 0
fi

# sqlite3's ".backup" command produces a consistent snapshot even while the
# app is writing (unlike a plain file copy, which could grab a half-written
# WAL-mode file).
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/restaurant-$STAMP.db'"
else
  cp "$DB_FILE" "$BACKUP_DIR/restaurant-$STAMP.db"
fi

echo "Backup written to $BACKUP_DIR/restaurant-$STAMP.db"

# Keep the last 30 days of backups only.
find "$BACKUP_DIR" -name 'restaurant-*.db' -mtime +30 -delete

echo "Old backups (30+ days) pruned."
