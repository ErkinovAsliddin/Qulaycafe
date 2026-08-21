#!/usr/bin/env python3
"""
One-off recovery of the menu items that never made it from Bellscan (the old
PrimeWeb deployment) into Qulaycafe.

Why anything was lost
---------------------
The migration was a plain file copy of a WAL-mode SQLite database:

    cp -a  .../primeweb-main_restaurant-data/_data/restaurant.db  .../qulaycafe_restaurant-data/_data/restaurant.db
    rm -f  .../qulaycafe_restaurant-data/_data/restaurant.db-wal

In WAL mode a committed transaction lives in the `-wal` sidecar file until a
checkpoint folds it into the main `.db` file. Copying only the `.db` file and
throwing the WAL away therefore silently drops every transaction committed
since the last checkpoint -- here, everything added to Bellscan from
2026-08-09 21:51 UTC onwards, which is all 14 drinks plus 7 other dishes.

The old container has since checkpointed its own WAL, so those rows are now in
the old main database file and can be copied across.

What this script does
---------------------
Inserts only the item ids that are missing from the destination. It never
updates or deletes an existing row, so edits made in Qulaycafe after the
migration (four dishes were recategorised, two were re-added by hand) are
preserved. Safe to run twice.
"""

import argparse
import json
import sqlite3
import sys

OLD_DB = '/var/snap/docker/common/var-lib-docker/volumes/primeweb-main_restaurant-data/_data/restaurant.db'
NEW_DB = '/var/snap/docker/common/var-lib-docker/volumes/qulaycafe_restaurant-data/_data/restaurant.db'
RESTAURANT_ID = 'rest-msimwbzg-d753fb2d'  # Prime Restoran

# Bellscan's "Galubsi" (created 2026-08-10 07:38 UTC). The admin re-added this
# dish by hand in Qulaycafe on 2026-08-12 with its own photo, so restoring the
# Bellscan copy would put two Galubsi cards on the customer menu.
SKIP_IDS = {'m-1786347523337-af2078'}


def item_name(data: dict) -> str:
    return data.get('nameUz') or data.get('name') or '(nomsiz)'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='write to the destination database (default: dry run)')
    ap.add_argument('--old', default=OLD_DB)
    ap.add_argument('--new', default=NEW_DB)
    ap.add_argument('--restaurant', default=RESTAURANT_ID)
    args = ap.parse_args()

    src = sqlite3.connect(f'file:{args.old}?mode=ro', uri=True)
    old_items = {
        row[0]: row[1]
        for row in src.execute('SELECT id, data FROM menu_items WHERE restaurant_id = ?', (args.restaurant,))
    }
    src.close()
    if not old_items:
        print(f'No items for {args.restaurant} in {args.old} -- wrong restaurant id?', file=sys.stderr)
        return 1

    dst = sqlite3.connect(args.new, timeout=15)
    dst.execute('PRAGMA busy_timeout = 15000')
    present = {
        row[0] for row in dst.execute('SELECT id FROM menu_items WHERE restaurant_id = ?', (args.restaurant,))
    }

    missing = [i for i in old_items if i not in present and i not in SKIP_IDS]
    missing.sort(key=lambda i: i.split('-')[1])

    print(f'source items: {len(old_items)}   already present: {len(present)}   to restore: {len(missing)}')
    for item_id in missing:
        data = json.loads(old_items[item_id])
        print(f"  + {str(data.get('category')):14} {item_name(data)}")
    for item_id in sorted(SKIP_IDS & set(old_items)):
        print(f"  - skipped (re-added by hand in Qulaycafe): {item_name(json.loads(old_items[item_id]))}")

    # The drinks category was switched off while it looked empty; the restored
    # dishes are invisible to customers until it is active again.
    inactive = dst.execute(
        "SELECT id, name_uz FROM categories WHERE restaurant_id = ? AND is_active = 0", (args.restaurant,)
    ).fetchall()
    for cat_id, name in inactive:
        print(f'  ~ category to re-activate: {cat_id} ({name})')

    if not args.apply:
        print('\ndry run -- nothing written. Re-run with --apply.')
        dst.close()
        return 0

    with dst:  # one transaction: either every row lands or none does
        dst.executemany(
            'INSERT OR IGNORE INTO menu_items (restaurant_id, id, data) VALUES (?, ?, ?)',
            [(args.restaurant, i, old_items[i]) for i in missing],
        )
        dst.execute(
            "UPDATE categories SET is_active = 1, updated_at = datetime('now') "
            'WHERE restaurant_id = ? AND is_active = 0',
            (args.restaurant,),
        )

    total = dst.execute('SELECT COUNT(*) FROM menu_items WHERE restaurant_id = ?', (args.restaurant,)).fetchone()[0]
    print(f'\napplied. {args.restaurant} now has {total} menu items.')
    for cat_id, name, count, active in dst.execute(
        'SELECT c.id, c.name_uz, (SELECT COUNT(*) FROM menu_items m WHERE m.restaurant_id = c.restaurant_id '
        "AND json_extract(m.data, '$.category') = c.id), c.is_active "
        'FROM categories c WHERE c.restaurant_id = ? ORDER BY c.sort_order',
        (args.restaurant,),
    ):
        print(f"  {name:16} {count:3} dishes  {'active' if active else 'HIDDEN'}")
    dst.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
