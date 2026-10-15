"""One-shot migration: stamp every stored deck export with the share envelope.

Moves pre-envelope deck export files (the version:2 JSON blobs under
/data/study/data/decks/) to the three-schema interchange format:

    {"$schema": "scima", "schema": "share", "schemaVersion": 1,
     "kind": "deck", ...original payload...}

Skeletal short-key cards (f/b/h/t…) inside any payload are expanded to long
keys. Conversion is additive — no stored data is removed, and files that
are already stamped, not deck exports, or unrecognizable are left untouched
and reported.

The SQLite database itself carries no payloads (rows reference files), so
nothing in `decks` rows changes. Completion is recorded as
db_meta 'payload_schema' = 'share-v1'.

This command additionally repairs the deck_tags -> decks_fts sync
triggers in place (DROP + CREATE from db.DECK_TAGS_TRIGGER_SQL). The
triggers shipped with schema v5 read old column values back out of the
external-content FTS table, which crashed every tagged-deck upload with
"no such column: T.tags". The repair is idempotent and touches no table
data.

IMPORTANT: this deliberately does NOT touch db_meta 'schema_version' —
db.init_db() drops and recreates all tables when that value changes, and
this is a payload-only migration.

Usage (on the Pi):
    cd /home/scima/scima-learning/backend
    sudo systemctl stop study
    sudo -u study /opt/study/venv/bin/python -m app.migrate_db --dry-run
    sudo -u study /opt/study/venv/bin/python -m app.migrate_db
    sudo systemctl start study

--dry-run performs every read/classify step and prints the plan without
writing anything (no backup dir either).
"""

import argparse
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from . import db, scimaschema

PAYLOAD_SCHEMA_KEY = "payload_schema"
PAYLOAD_SCHEMA_VALUE = "share-v1"


def _atomic_write_json(path: Path, payload) -> None:
    """Write JSON via a temp file in the same directory + os.replace, so a
    crash mid-write can never leave a half-written export file."""
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent,
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(temp_path, path)
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise


def _collect_targets() -> list:
    """Every export file to consider: files referenced by db rows first
    (canonical), then any orphan *.json in the decks dir."""
    targets = []
    seen = set()

    if db.DB_PATH.is_file():
        try:
            conn = sqlite3.connect(str(db.DB_PATH))
            try:
                rows = conn.execute(
                    "SELECT id, file_path FROM decks ORDER BY created_at"
                ).fetchall()
            except sqlite3.OperationalError:
                rows = []  # no decks table — nothing referenced yet
            finally:
                conn.close()
            for deck_id, file_path in rows:
                p = (db.DATA_DIR.parent / file_path).resolve()
                if p not in seen:
                    seen.add(p)
                    targets.append((deck_id, p))
        except sqlite3.Error as e:
            print(f"warning: could not read {db.DB_PATH}: {e}", file=sys.stderr)

    if db.DECKS_DIR.is_dir():
        for p in sorted(db.DECKS_DIR.glob("*.json")):
            rp = p.resolve()
            if rp not in seen:
                seen.add(rp)
                targets.append((None, rp))
    return targets


def _record_done(dry_run: bool) -> None:
    """Mark the payload migration complete in db_meta (without touching
    schema_version)."""
    if dry_run:
        return
    db.DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db.DB_PATH))
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS db_meta ("
            " key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        conn.execute(
            "INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)",
            (PAYLOAD_SCHEMA_KEY, PAYLOAD_SCHEMA_VALUE),
        )
        conn.commit()
    finally:
        conn.close()


def _repair_fts_triggers(dry_run: bool) -> None:
    """Recreate the deck_tags FTS sync triggers from db.DECK_TAGS_TRIGGER_SQL.

    The triggers shipped with schema v5 built their FTS5 'delete' command
    by SELECTing the old row back out of decks_fts; because decks_fts is
    an external-content table backed by `decks` (which has no `tags`
    column), every tag INSERT/DELETE raised "no such column: T.tags" and
    rolled back the whole tagged-deck upload.

    DROP + CREATE is idempotent, touches no table data, and needs no FTS
    rebuild: while the bug was live no tagged deck could ever commit, so
    no stale tag tokens can exist in the index.
    """
    if not db.DB_PATH.is_file():
        print("fts triggers: no database file — nothing to repair")
        return

    conn = sqlite3.connect(str(db.DB_PATH))
    try:
        has_fts = conn.execute(
            "SELECT 1 FROM sqlite_master "
            "WHERE type IN ('table', 'view') AND name = 'decks_fts'"
        ).fetchone()

        if not has_fts:
            print("fts triggers: decks_fts not present — skipping repair")
            return

        existing = sorted(
            name
            for (name,) in conn.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type = 'trigger' "
                "AND name IN ('deck_tags_ai', 'deck_tags_ad')"
            )
        )

        if dry_run:
            print(
                "fts triggers: WOULD recreate deck_tags_ai, deck_tags_ad "
                f"with fixed SQL (present now: {', '.join(existing) or 'none'})"
            )
            return

        conn.executescript(
            "DROP TRIGGER IF EXISTS deck_tags_ai;\n"
            "DROP TRIGGER IF EXISTS deck_tags_ad;\n"
            + db.DECK_TAGS_TRIGGER_SQL
        )
        conn.commit()
        print(
            "fts triggers: deck_tags_ai, deck_tags_ad recreated with fixed SQL "
            f"(were: {', '.join(existing) or 'none'})"
        )
    finally:
        conn.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="python -m app.migrate_db",
        description="Stamp stored SCIMA deck exports with the share-schema envelope.",
    )
    ap.add_argument(
        "--dry-run", action="store_true",
        help="classify and report only; write nothing",
    )
    args = ap.parse_args(argv)

    print(f"data dir:   {db.DATA_DIR}")
    print(f"decks dir:  {db.DECKS_DIR}")
    print(f"database:   {db.DB_PATH}")

    if not db.DECKS_DIR.is_dir() and not db.DB_PATH.is_file():
        print("Nothing to migrate (no database and no decks directory found).")
        return 0

    targets = _collect_targets()
    print(f"\nfound {len(targets)} export file(s)\n")

    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_dir = db.DATA_DIR / f"schema-backup-{ts}"

    migrated = skipped = untouched = failed = 0
    notes = []

    for deck_id, path in targets:
        label = f"{path.name}" + (f" (deck {deck_id})" if deck_id else " (orphan)")
        try:
            with path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            # Pre-existing damage, not a migration failure: report loudly,
            # leave the file exactly as it is, and don't block completion.
            untouched += 1
            notes.append(f"UNREADABLE {label}: {e} — left untouched (pre-existing damage)")
            continue

        new_payload, changed, note = scimaschema.normalize_export(payload)
        if not changed:
            if note is None:
                skipped += 1
                notes.append(f"ok        {label}: already stamped share/deck")
            else:
                untouched += 1
                notes.append(f"SKIP      {label}: {note}")
            continue

        if args.dry_run:
            migrated += 1
            notes.append(f"WOULD MIGRATE {label}: {note}")
            continue

        try:
            backup_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, backup_dir / path.name)
            _atomic_write_json(path, new_payload)
            migrated += 1
            notes.append(f"migrated  {label}: {note}")
        except OSError as e:
            failed += 1
            notes.append(f"FAILED    {label}: {e}")

    for line in notes:
        print(" ", line)

    mode = "DRY RUN — nothing written" if args.dry_run else "done"
    print(f"\n{mode}: {migrated} to migrate/migrated, {skipped} already stamped, "
          f"{untouched} left untouched (non-deck/unrecognized/unreadable), {failed} failed")
    if not args.dry_run and not failed:
        _record_done(False)
        print(f"db_meta: {PAYLOAD_SCHEMA_KEY} = {PAYLOAD_SCHEMA_VALUE}")
    if not args.dry_run and migrated:
        print(f"originals backed up in: {backup_dir}")

    print()
    _repair_fts_triggers(args.dry_run)

    if failed:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
