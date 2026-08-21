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

# A plain `cp` of the database file is NOT a backup here: the database runs in
# WAL mode, where a committed transaction lives in the `restaurant.db-wal`
# sidecar until a checkpoint folds it into the main file. Copying the main file
# alone silently loses every transaction since the last checkpoint — that is
# exactly how the Bellscan -> Qulaycafe migration lost 21 dishes, including a
# whole drinks section.
#
# Both branches below take a consistent snapshot of the WHOLE database:
#   - sqlite3 ".backup" uses SQLite's online backup API;
#   - "VACUUM INTO" (SQLite 3.27+) writes a fully checkpointed copy.
# The node branch exists because the app's own container ships node and
# better-sqlite3 but no sqlite3 CLI, so this script must not depend on the CLI.
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/restaurant-$STAMP.db'"
elif command -v node >/dev/null 2>&1; then
  node -e '
    const Database = require("better-sqlite3");
    const db = new Database(process.argv[1], { readonly: true });
    db.prepare("VACUUM INTO ?").run(process.argv[2]);
    db.close();
  ' "$DB_FILE" "$BACKUP_DIR/restaurant-$STAMP.db"
else
  echo "Neither sqlite3 nor node is available — refusing to take an unsafe file-copy backup." >&2
  echo "Install sqlite3, or run this script where the app's node runtime lives." >&2
  exit 1
fi

echo "Backup written to $BACKUP_DIR/restaurant-$STAMP.db"

# Keep the last 30 days of backups only.
find "$BACKUP_DIR" -name 'restaurant-*.db' -mtime +30 -delete

echo "Old backups (30+ days) pruned."
