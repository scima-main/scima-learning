import sqlite3
from contextlib import contextmanager
from pathlib import Path


DATA_DIR = Path("/data/study/data")
DECKS_DIR = DATA_DIR / "decks"
DB_PATH = DATA_DIR / "scima.db"

SCHEMA_VERSION = "5"


def init_db() -> None:
    DATA_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    DECKS_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    conn = sqlite3.connect(DB_PATH)

    try:
        conn.execute("PRAGMA foreign_keys = ON")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS db_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )

        row = conn.execute(
            """
            SELECT value
            FROM db_meta
            WHERE key = 'schema_version'
            """
        ).fetchone()

        current_version = row[0] if row else None

        if current_version != SCHEMA_VERSION:
            conn.executescript(
                """
                DROP TABLE IF EXISTS deck_tags;
                DROP TABLE IF EXISTS decks_fts;
                DROP TABLE IF EXISTS decks;

                CREATE TABLE decks (
                    id TEXT PRIMARY KEY,
                    source_deck_id TEXT,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    author TEXT,
                    subject TEXT NOT NULL DEFAULT 'misc',
                    emoji TEXT,
                    level TEXT,
                    exam_board TEXT,

                    card_count INTEGER NOT NULL DEFAULT 0
                        CHECK (card_count >= 0),

                    downloads INTEGER NOT NULL DEFAULT 0
                        CHECK (downloads >= 0),

                    rating_sum INTEGER NOT NULL DEFAULT 0
                        CHECK (rating_sum >= 0),

                    rating_count INTEGER NOT NULL DEFAULT 0
                        CHECK (rating_count >= 0),

                    file_path TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX idx_decks_source_deck_id
                    ON decks(source_deck_id);

                CREATE INDEX idx_decks_created_at
                    ON decks(created_at);

                CREATE INDEX idx_decks_downloads
                    ON decks(downloads);


                CREATE TABLE deck_tags (
                    deck_id TEXT NOT NULL
                        REFERENCES decks(id)
                        ON DELETE CASCADE,

                    tag TEXT NOT NULL,

                    PRIMARY KEY (deck_id, tag)
                );

                CREATE INDEX idx_deck_tags_tag
                    ON deck_tags(tag);


                CREATE VIRTUAL TABLE decks_fts USING fts5(
                    name,
                    subject,
                    author,
                    tags,
                    description,
                    content='decks',
                    content_rowid='rowid'
                );


                /*
                 * Keep the FTS external-content table synchronized
                 * with decks.
                 *
                 * Tags are maintained separately by deck_tags triggers.
                 */

                CREATE TRIGGER decks_ai
                AFTER INSERT ON decks
                BEGIN
                    INSERT INTO decks_fts(
                        rowid,
                        name,
                        subject,
                        author,
                        tags,
                        description
                    )
                    VALUES (
                        new.rowid,
                        new.name,
                        new.subject,
                        new.author,
                        COALESCE(
                            (
                                SELECT GROUP_CONCAT(tag, ' ')
                                FROM deck_tags
                                WHERE deck_id = new.id
                            ),
                            ''
                        ),
                        new.description
                    );
                END;


                CREATE TRIGGER decks_ad
                AFTER DELETE ON decks
                BEGIN
                    INSERT INTO decks_fts(
                        decks_fts,
                        rowid,
                        name,
                        subject,
                        author,
                        tags,
                        description
                    )
                    VALUES (
                        'delete',
                        old.rowid,
                        old.name,
                        old.subject,
                        old.author,
                        COALESCE(
                            (
                                SELECT GROUP_CONCAT(tag, ' ')
                                FROM deck_tags
                                WHERE deck_id = old.id
                            ),
                            ''
                        ),
                        old.description
                    );
                END;


                CREATE TRIGGER decks_au
                AFTER UPDATE ON decks
                BEGIN
                    INSERT INTO decks_fts(
                        decks_fts,
                        rowid,
                        name,
                        subject,
                        author,
                        tags,
                        description
                    )
                    VALUES (
                        'delete',
                        old.rowid,
                        old.name,
                        old.subject,
                        old.author,
                        COALESCE(
                            (
                                SELECT GROUP_CONCAT(tag, ' ')
                                FROM deck_tags
                                WHERE deck_id = old.id
                            ),
                            ''
                        ),
                        old.description
                    );

                    INSERT INTO decks_fts(
                        rowid,
                        name,
                        subject,
                        author,
                        tags,
                        description
                    )
                    VALUES (
                        new.rowid,
                        new.name,
                        new.subject,
                        new.author,
                        COALESCE(
                            (
                                SELECT GROUP_CONCAT(tag, ' ')
                                FROM deck_tags
                                WHERE deck_id = new.id
                            ),
                            ''
                        ),
                        new.description
                    );
                END;


                /*
                 * When a tag is added or removed, rebuild the
                 * corresponding FTS row so tags remain searchable.
                 */

                CREATE TRIGGER deck_tags_ai
                AFTER INSERT ON deck_tags
                BEGIN
                    INSERT INTO decks_fts(
                        decks_fts,
                        rowid,
                        name,
                        subject,
                        author,
                        tags,
                        description
                    )
                    SELECT
                        'delete',
                        f.rowid,
                        f.name,
                        f.subject,
                        f.author,
                        f.tags,
                        f.description
                    FROM decks_fts f
                    JOIN decks d
                        ON d.rowid = f.rowid
                    WHERE d.id = new.deck_id;

                    INSERT INTO decks_fts(
                        rowid,
                        name,
                        subject,
                        author,
                        tags,
                        description
                    )
                    SELECT
                        d.rowid,
                        d.name,
                        d.subject,
                        d.author,
                        COALESCE(
                            (
                                SELECT GROUP_CONCAT(tag, ' ')
                                FROM deck_tags
                                WHERE deck_id = d.id
                            ),
                            ''
                        ),
                        d.description
                    FROM decks d
                    WHERE d.id = new.deck_id;
                END;


                CREATE TRIGGER deck_tags_ad
                AFTER DELETE ON deck_tags
                BEGIN
                    INSERT INTO decks_fts(
                        decks_fts,
                        rowid,
                        name,
                        subject,
                        author,
                        tags,
                        description
                    )
                    SELECT
                        'delete',
                        f.rowid,
                        f.name,
                        f.subject,
                        f.author,
                        f.tags,
                        f.description
                    FROM decks_fts f
                    JOIN decks d
                        ON d.rowid = f.rowid
                    WHERE d.id = old.deck_id;

                    INSERT INTO decks_fts(
                        rowid,
                        name,
                        subject,
                        author,
                        tags,
                        description
                    )
                    SELECT
                        d.rowid,
                        d.name,
                        d.subject,
                        d.author,
                        COALESCE(
                            (
                                SELECT GROUP_CONCAT(tag, ' ')
                                FROM deck_tags
                                WHERE deck_id = d.id
                            ),
                            ''
                        ),
                        d.description
                    FROM decks d
                    WHERE d.id = old.deck_id;
                END;
                """
            )

            conn.execute(
                """
                INSERT OR REPLACE INTO db_meta
                    (key, value)
                VALUES
                    ('schema_version', ?)
                """,
                (SCHEMA_VERSION,),
            )

            conn.commit()

    finally:
        conn.close()


@contextmanager
def db_session():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        yield conn
        conn.commit()

    except Exception:
        conn.rollback()
        raise

    finally:
        conn.close()
