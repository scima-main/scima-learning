import json
import os
import secrets
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Sequence

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import db, ratelimit
from .schemas import (
    DeckListResponse,
    DeckSearchResponse,
    DeckSummary,
    DeckUploadRequest,
    MAX_REQUEST_BODY_BYTES,
    MAX_SEARCH_QUERY_CHARS,
    Rating,
)


app = FastAPI(
    title="SCIMA Community Deck Registry",
    version="1.0.0",
)


# ── Middleware ───────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=[
        "study.scima-net.com",
        "localhost",
        "127.0.0.1",
    ],
)


# ── Body Size Middleware ─────────────────────────────────────────────

@app.middleware("http")
async def enforce_max_body_size(request: Request, call_next):
    content_length = request.headers.get("content-length")

    if content_length is not None:
        try:
            if int(content_length) > MAX_REQUEST_BODY_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={
                        "detail": (
                            f"Request body exceeds "
                            f"{MAX_REQUEST_BODY_BYTES} bytes"
                        )
                    },
                )
        except ValueError:
            pass

    received = 0
    original_receive = request._receive

    async def limited_receive():
        nonlocal received

        message = await original_receive()

        if message["type"] == "http.request":
            body = message.get("body", b"")
            received += len(body)

            if received > MAX_REQUEST_BODY_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=(
                        f"Request body exceeds "
                        f"{MAX_REQUEST_BODY_BYTES} bytes"
                    ),
                )

        return message

    request._receive = limited_receive

    try:
        return await call_next(request)
    except HTTPException as exc:
        if exc.status_code == 413:
            return JSONResponse(
                status_code=413,
                content={"detail": exc.detail},
            )
        raise


# ── Startup ──────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    db.init_db()


# ── Helpers ──────────────────────────────────────────────────────────

def enforce_rate_limit(request: Request, bucket: str):
    allowed, rule, retry_after = ratelimit.check(request, bucket)

    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Rate limit exceeded: "
                f"{rule.limit} requests / {rule.window_seconds}s."
            ),
            headers={"Retry-After": str(retry_after)},
        )


def now() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def new_id() -> str:
    # 128-bit random identifier.
    return f"sd_{secrets.token_hex(16)}"


def build_summaries_batch(
    conn,
    rows: Sequence,
) -> list[DeckSummary]:
    if not rows:
        return []

    deck_ids = [row["id"] for row in rows]
    placeholders = ",".join(["?"] * len(deck_ids))

    tag_rows = conn.execute(
        f"""
        SELECT deck_id, tag
        FROM deck_tags
        WHERE deck_id IN ({placeholders})
        ORDER BY tag
        """,
        deck_ids,
    ).fetchall()

    tags_map: dict[str, list[str]] = {}

    for tag_row in tag_rows:
        tags_map.setdefault(tag_row["deck_id"], []).append(
            tag_row["tag"]
        )

    summaries = []

    for row in rows:
        rating_count = row["rating_count"]

        summaries.append(
            DeckSummary(
                id=row["id"],
                name=row["name"],
                author=row["author"],
                subject=row["subject"],
                emoji=row["emoji"],
                level=row["level"],
                examBoard=row["exam_board"],
                description=row["description"],
                tags=tags_map.get(row["id"], []),
                cardCount=row["card_count"],
                downloads=row["downloads"],
                rating=Rating(
                    average=(
                        row["rating_sum"] / rating_count
                        if rating_count
                        else None
                    ),
                    count=rating_count,
                ),
                createdAt=row["created_at"],
                updatedAt=row["updated_at"],
            )
        )

    return summaries


def get_export_path(file_path: str) -> Path:
    path = (db.DATA_DIR.parent / file_path).resolve()
    base_dir = db.DECKS_DIR.resolve()

    try:
        path.relative_to(base_dir)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="invalid file path",
        )

    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail="export file missing",
        )

    return path


def write_export_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    fd, temp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )

    temp_path = Path(temp_name)

    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(
                payload,
                f,
                indent=2,
                ensure_ascii=False,
            )
            f.flush()
            os.fsync(f.fileno())

        os.replace(temp_path, path)

    except Exception:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def make_fts_query(query: str) -> str:
    tokens = query.strip().split()
    parts = []

    for token in tokens:
        token = token.replace('"', '""')

        if token:
            parts.append(f'"{token}"*')

    return " AND ".join(parts)


# ── API ──────────────────────────────────────────────────────────────

@app.get("/api/v1/health")
def health():
    return {"status": "ok"}


@app.get(
    "/api/v1/decks",
    response_model=DeckListResponse,
)
def list_decks(
    request: Request,
    subject: Optional[str] = None,
    tag: Optional[str] = None,
    sort: str = Query(
        "newest",
        pattern="^(newest|popularity)$",
    ),
    limit: int = Query(
        50,
        ge=1,
        le=100,
    ),
    offset: int = Query(
        0,
        ge=0,
        le=10000,
    ),
):
    enforce_rate_limit(request, "list_decks")

    where = []
    params = []

    if subject:
        where.append("d.subject = ?")
        params.append(subject)

    if tag:
        where.append(
            "d.id IN "
            "(SELECT deck_id FROM deck_tags WHERE tag = ?)"
        )
        params.append(tag.lower())

    where_sql = (
        "WHERE " + " AND ".join(where)
        if where
        else ""
    )

    if sort == "popularity":
        order_sql = (
            "d.downloads DESC, "
            "d.created_at DESC"
        )
    else:
        order_sql = "d.created_at DESC"

    with db.db_session() as conn:
        total = conn.execute(
            f"""
            SELECT COUNT(*) AS c
            FROM decks d
            {where_sql}
            """,
            params,
        ).fetchone()["c"]

        rows = conn.execute(
            f"""
            SELECT d.*
            FROM decks d
            {where_sql}
            ORDER BY {order_sql}
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()

        items = build_summaries_batch(conn, rows)

    return DeckListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


@app.get(
    "/api/v1/search",
    response_model=DeckSearchResponse,
)
def search(
    request: Request,
    q: str = "",
    sort: str = Query(
        "relevance",
        pattern="^(relevance|newest|popularity)$",
    ),
    limit: int = Query(
        50,
        ge=1,
        le=100,
    ),
    offset: int = Query(
        0,
        ge=0,
        le=10000,
    ),
):
    enforce_rate_limit(request, "search")

    if len(q) > MAX_SEARCH_QUERY_CHARS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"search query exceeds "
                f"{MAX_SEARCH_QUERY_CHARS} characters"
            ),
        )

    with db.db_session() as conn:
        if not q.strip():
            total = conn.execute(
                "SELECT COUNT(*) AS c FROM decks"
            ).fetchone()["c"]

            if sort == "popularity":
                order_sql = (
                    "d.downloads DESC, "
                    "d.created_at DESC"
                )
            else:
                order_sql = "d.created_at DESC"

            rows = conn.execute(
                f"""
                SELECT d.*
                FROM decks d
                ORDER BY {order_sql}
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ).fetchall()

        else:
            fts_q = make_fts_query(q)

            if not fts_q:
                return DeckSearchResponse(
                    items=[],
                    total=0,
                    limit=limit,
                    offset=offset,
                )

            try:
                total = conn.execute(
                    """
                    SELECT COUNT(*) AS c
                    FROM decks_fts
                    WHERE decks_fts MATCH ?
                    """,
                    (fts_q,),
                ).fetchone()["c"]

                if sort == "popularity":
                    order_sql = (
                        "d.downloads DESC, "
                        "d.created_at DESC"
                    )
                elif sort == "newest":
                    order_sql = "d.created_at DESC"
                else:
                    order_sql = (
                        "bm25("
                        "decks_fts, "
                        "10.0, 5.0, 3.0, 2.0, 1.0"
                        ") ASC, "
                        "d.created_at DESC"
                    )

                rows = conn.execute(
                    f"""
                    SELECT d.*
                    FROM decks d
                    JOIN decks_fts
                      ON decks_fts.rowid = d.rowid
                    WHERE decks_fts MATCH ?
                    ORDER BY {order_sql}
                    LIMIT ? OFFSET ?
                    """,
                    (fts_q, limit, offset),
                ).fetchall()

            except sqlite3.OperationalError as e:
                error = str(e).lower()

                if "fts5" in error or "syntax error" in error:
                    pattern = f"%{q.strip()}%"

                    total = conn.execute(
                        """
                        SELECT COUNT(DISTINCT d.id) AS c
                        FROM decks d
                        LEFT JOIN deck_tags t
                          ON d.id = t.deck_id
                        WHERE
                            d.name LIKE ?
                            OR d.subject LIKE ?
                            OR d.author LIKE ?
                            OR d.description LIKE ?
                            OR t.tag LIKE ?
                        """,
                        (
                            pattern,
                            pattern,
                            pattern,
                            pattern,
                            pattern,
                        ),
                    ).fetchone()["c"]

                    if sort == "popularity":
                        order_sql = (
                            "d.downloads DESC, "
                            "d.created_at DESC"
                        )
                    else:
                        order_sql = "d.created_at DESC"

                    rows = conn.execute(
                        f"""
                        SELECT DISTINCT d.*
                        FROM decks d
                        LEFT JOIN deck_tags t
                          ON d.id = t.deck_id
                        WHERE
                            d.name LIKE ?
                            OR d.subject LIKE ?
                            OR d.author LIKE ?
                            OR d.description LIKE ?
                            OR t.tag LIKE ?
                        ORDER BY {order_sql}
                        LIMIT ? OFFSET ?
                        """,
                        (
                            pattern,
                            pattern,
                            pattern,
                            pattern,
                            pattern,
                            limit,
                            offset,
                        ),
                    ).fetchall()

                else:
                    raise

        items = build_summaries_batch(conn, rows)

    return DeckSearchResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


@app.get(
    "/api/v1/decks/{deck_id}",
    response_model=DeckSummary,
)
def get_deck(
    deck_id: str,
    request: Request,
):
    enforce_rate_limit(request, "get_deck")

    with db.db_session() as conn:
        row = conn.execute(
            "SELECT * FROM decks WHERE id = ?",
            (deck_id,),
        ).fetchone()

        if row is None:
            raise HTTPException(
                status_code=404,
                detail="deck not found",
            )

        return build_summaries_batch(
            conn,
            [row],
        )[0]


@app.get("/api/v1/decks/{deck_id}/export")
def export_deck(
    deck_id: str,
    request: Request,
):
    enforce_rate_limit(request, "export_deck")

    with db.db_session() as conn:
        row = conn.execute(
            "SELECT * FROM decks WHERE id = ?",
            (deck_id,),
        ).fetchone()

        if row is None:
            raise HTTPException(
                status_code=404,
                detail="deck not found",
            )

        file_path = get_export_path(row["file_path"])

        try:
            with file_path.open(
                "r",
                encoding="utf-8",
            ) as f:
                export_data = json.load(f)

        except (OSError, json.JSONDecodeError):
            raise HTTPException(
                status_code=500,
                detail="export file is corrupt or unreadable",
            )

        conn.execute(
            """
            UPDATE decks
            SET downloads = downloads + 1
            WHERE id = ?
            """,
            (deck_id,),
        )

    return export_data


@app.post(
    "/api/v1/decks",
    response_model=DeckSummary,
    status_code=201,
)
def create_deck(
    body: DeckUploadRequest,
    request: Request,
):
    enforce_rate_limit(request, "create_deck")

    deck_data = body.deck
    deck_id = new_id()
    timestamp = now()

    file_path = db.DECKS_DIR / f"{deck_id}.json"

    rel_path_str = str(
        file_path.relative_to(
            db.DATA_DIR.parent
        )
    )

    export_payload = body.model_dump(
        mode="json",
        by_alias=True,
    )

    write_export_atomic(
        file_path,
        export_payload,
    )

    try:
        with db.db_session() as conn:
            conn.execute(
                """
                INSERT INTO decks (
                    id,
                    source_deck_id,
                    name,
                    description,
                    author,
                    subject,
                    emoji,
                    level,
                    exam_board,
                    card_count,
                    downloads,
                    rating_sum,
                    rating_count,
                    file_path,
                    created_at,
                    updated_at
                )
                VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    0, 0, 0, ?, ?, ?
                )
                """,
                (
                    deck_id,
                    deck_data.id,
                    deck_data.name,
                    body.meta.description,
                    body.meta.author,
                    deck_data.subject,
                    deck_data.emoji,
                    deck_data.level,
                    deck_data.examBoard,
                    len(deck_data.cards),
                    rel_path_str,
                    timestamp,
                    timestamp,
                ),
            )

            for tag in body.meta.tags:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO deck_tags
                        (deck_id, tag)
                    VALUES (?, ?)
                    """,
                    (deck_id, tag),
                )

            row = conn.execute(
                "SELECT * FROM decks WHERE id = ?",
                (deck_id,),
            ).fetchone()

            summary = build_summaries_batch(
                conn,
                [row],
            )[0]

    except Exception:
        try:
            file_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise

    return summary


# ── Static Mounts ────────────────────────────────────────────────────

app.mount(
    "/dashboard",
    StaticFiles(
        directory="/home/scima/study/home/scima-standalone-landing",
        html=True,
    ),
    name="dashboard",
)

app.mount(
    "/community",
    StaticFiles(
        directory="/home/scima/study/community",
        html=True,
    ),
    name="community",
)


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/dashboard/")
