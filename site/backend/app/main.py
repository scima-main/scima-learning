import base64
import hashlib
import json
import os
import re
import secrets
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Sequence

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from . import db, ratelimit, scimaschema
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

# Site-default meta description, injected by the safety-net middleware below
# into any HTML response that lacks one (legacy mounts, future pages).
DEFAULT_META_DESCRIPTION = (
    "SCIMA Learning is a private, client-side study app: spaced-repetition "
    "flashcards, written quizzes, a citation-aware reading library and "
    "progress analytics — your data never leaves your browser."
)


@app.middleware("http")
async def ensure_meta_description(request: Request, call_next):
    """SEO safety net: every text/html response must carry a meta
    description. Registered FIRST (innermost) so it sees plaintext before
    GZipMiddleware compresses; content-length is dropped and recomputed."""
    response = await call_next(request)
    ctype = response.headers.get("content-type", "")
    if "text/html" not in ctype or response.status_code >= 400:
        return response
    body = b""
    async for chunk in response.body_iterator:
        body += chunk
    low = body.lower()
    headers = dict(response.headers)
    media = ctype.split(";")[0]
    if b'name="description"' in low or b"name=description" in low or b"name='description'" in low:
        headers.pop("content-length", None)
        return Response(content=body, status_code=response.status_code,
                        headers=headers, media_type=media)
    tag = b'<meta name="description" content="' + DEFAULT_META_DESCRIPTION.encode("utf-8") + b'">'
    injected = False
    for anchor in (b"<head>", b"<head "):
        i = low.find(anchor)
        if i != -1:
            j = body.find(b">", i) + 1
            body = body[:j] + b"\n" + tag + body[j:]
            injected = True
            break
    if not injected:
        for anchor in (b"<html>", b"<html "):
            i = low.find(anchor)
            if i != -1:
                j = body.find(b">", i) + 1
                body = body[:j] + tag + body[j:]
                injected = True
                break
    if not injected:
        body = tag + body
    headers.pop("content-length", None)
    return Response(content=body, status_code=response.status_code,
                    headers=headers, media_type=media)



@app.middleware("http")
async def redirect_http_to_https(request: Request, call_next):
    """Behind Cloudflare the edge terminates TLS, so enforce the redirect
    here: plain-http hits (Bing flags missing https redirect + duplicate
    scheme content) 301 to the https URL. Direct dev uvicorn sends no
    x-forwarded-proto and keeps serving plain http."""
    if request.headers.get("x-forwarded-proto") == "http":
        return RedirectResponse(url=str(request.url.replace(scheme="https")),
                                status_code=301)
    return await call_next(request)


# ── Security headers + Content-Security-Policy ─────────────────────────
# Registered here (i.e. INSIDE GZipMiddleware, which is added below) so the
# HTML body it hashes is still plaintext.
#
# Why hashed script-src instead of 'unsafe-inline': every page carries exactly
# ONE parser-inserted inline <script> (the window.SCIMA_PAGE declaration) and
# nothing else — no inline event handlers, no eval, no document.write into the
# app document (the print-preview popup writes its own document and attaches
# its button listener via property assignment for exactly this reason).
# Hashing the inline blocks at response time keeps the policy strict
# (injected <script> tags and on* handlers fail closed) without breaking any
# page, and survives edits because the hash is recomputed per response.
#
# Directive rationale (see repo review S3):
#   style-src needs 'unsafe-inline' — card/deck markup and the print sheet
#     carry style="" attributes and a <style> block; KaTeX emits none but the
#     app's innerHTML templates do. Google Fonts stylesheet is allowlisted.
#   img-src data:/blob: — EPUB art is re-attached as data: URLs, deck/card
#     images and exports ride blob: URLs.
#   connect-src — same-origin API plus the fonts preconnects and the
#     Define/Translate endpoints the client actually calls.
#   worker-src blob: — pdf.js may fall back to a blob-URL worker.
#   object-src/frame-ancestors 'none' — no plugins, no clickjacking;
#     X-Frame-Options mirrors frame-ancestors for pre-CSP2 clients.
_INLINE_SCRIPT_RE = re.compile(
    rb"<script(?![^>]*\bsrc\s*=)[^>]*>(.*?)</script>", re.S | re.I)

_CSP_TEMPLATE = (
    "default-src 'self'; "
    "script-src 'self'{hashes}; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' data: https://fonts.gstatic.com; "
    "img-src 'self' data: blob:; "
    "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com "
    "https://translate.googleapis.com https://api.dictionaryapi.dev; "
    "worker-src 'self' blob:; "
    "media-src 'self' blob:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)


def _csp_policy(inline_script_hashes: Sequence[str]) -> str:
    hashes = "".join(f" 'sha256-{h}'" for h in inline_script_hashes)
    return _CSP_TEMPLATE.format(hashes=hashes)


# ── Asset URL version stamp ─────────────────────────────────────────
# A stale cached DOCUMENT (browser heuristic cache, CDN edge object from
# before the no-cache policy) references plain asset URLs that a stale
# cached asset can answer, producing the "empty app until Ctrl+Shift+R"
# mix. Stamp every relative .js/.css reference in served HTML with the
# deployed APP_VERSION so a fresh document always pulls fresh assets
# (new query string = cache miss everywhere), while the no-cache policy
# keeps subsequent revalidations cheap. The version is read from the
# served shared.js (the file APP_VERSION is hand-synced into) and cached
# per mtime.
_ASSET_URL_RE = re.compile(
    rb'((?:src|href)=")((?:\.\./)*)(shared|app|lib|assets)/([^"?#]+\.(?:js|css))(")')
_ASSET_V_CACHE: dict = {"mtime": None, "ver": ""}


def _asset_version() -> str:
    try:
        path = STUDY_LANDING_DIR / "shared" / "shared.js"
        st = path.stat()
        if _ASSET_V_CACHE["mtime"] != st.st_mtime:
            txt = path.read_text(encoding="utf-8", errors="ignore")
            m = re.search(r"const APP_VERSION = '([^']+)'", txt)
            _ASSET_V_CACHE["ver"] = m.group(1) if m else str(int(st.st_mtime))
            _ASSET_V_CACHE["mtime"] = st.st_mtime
        return _ASSET_V_CACHE["ver"]
    except OSError:
        return ""


def _stamp_asset_urls(body: bytes, ver: str) -> bytes:
    if not ver:
        return body
    tag = f"?v={ver}".encode("utf-8")
    return _ASSET_URL_RE.sub(
        lambda m: m.group(1) + m.group(2) + m.group(3) + b"/" + m.group(4) + tag + m.group(5),
        body,
    )


def _inline_script_hashes(body: bytes) -> list[str]:
    return [
        base64.b64encode(hashlib.sha256(code).digest()).decode("ascii")
        for code in _INLINE_SCRIPT_RE.findall(body)
    ]


def _apply_security_headers(headers, csp: str, forwarded_proto: str) -> None:
    headers["Content-Security-Policy"] = csp
    headers["X-Content-Type-Options"] = "nosniff"
    headers["X-Frame-Options"] = "DENY"
    headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    headers["Permissions-Policy"] = (
        "camera=(), microphone=(), geolocation=(), payment=()")
    # HSTS is only honoured by browsers over HTTPS, so emitting it
    # unconditionally is safe for plain-http dev uvicorn; behind Cloudflare
    # the edge proto tells us the client really used TLS.
    if forwarded_proto == "https":
        headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Attach the CSP + baseline security headers to every response. HTML
    responses are buffered (they are small static pages) so inline <script>
    blocks can be sha256-hashed into script-src; everything else passes
    through untouched apart from the headers."""
    response = await call_next(request)
    ctype = response.headers.get("content-type", "")
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)

    if "text/html" in ctype and response.status_code < 400:
        body = b""
        async for chunk in response.body_iterator:
            body += chunk
        body = _stamp_asset_urls(body, _asset_version())
        csp = _csp_policy(_inline_script_hashes(body))
        headers = dict(response.headers)
        headers.pop("content-length", None)
        _apply_security_headers(headers, csp, proto)
        return Response(
            content=body,
            status_code=response.status_code,
            headers=headers,
            media_type=ctype.split(";")[0],
        )

    _apply_security_headers(response.headers, _csp_policy(()), proto)
    return response


# ── Middleware ───────────────────────────────────────────────────────

# Minified assets still compress ~70% further on the wire (JS/CSS/JSON are
# text). Filenames are NOT content-hashed, so caching stays no-cache+ETag
# (see STATIC_REVALIDATE below) — gzip is the transfer-size win here.
app.add_middleware(GZipMiddleware, minimum_size=1024)

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

# ── Static-asset revalidation ────────────────────────────────────────
# Starlette's StaticFiles sends no Cache-Control header, so browsers invent
# a heuristic freshness window from Last-Modified and can keep serving
# days-old JS/CSS after a deploy (users then see phantom old UI — e.g. the
# retired pill-shaped page tabs — while the files on disk are current).
# no-cache forces a revalidation on every use; ETags still make unchanged
# files cost only a 304, so this is freshness, not extra bandwidth.
# Every static asset, not just html/js/css: .md (ABOUT.md) and .svg (the
# icon sprite) are fetch()ed by the frontend, and with NO Cache-Control they
# got heuristic freshness — a once-cached stale or failed response (a deploy
# window 404, say) then replayed on every ordinary Ctrl+R while hard
# reloads bypassed it, which is exactly the "icons/changelog missing until
# Ctrl+Shift+R" report. no-cache keeps ETag/304 cheapness but forces the
# revalidation that heuristic freshness skipped. /api/ keeps its own caching
# semantics (JSON responses carry no cache-control and stay heuristic-free
# by being dynamic).
STATIC_REVALIDATE_ALL = True


@app.middleware("http")
async def revalidate_static(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if (
        STATIC_REVALIDATE_ALL
        and request.method in ("GET", "HEAD")
        and not path.startswith("/api/")
    ):
        if "cache-control" not in response.headers:
            response.headers["Cache-Control"] = "no-cache"
    return response


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

        # Backwards compatibility: files written before the three-schema
        # envelope are normalized to a stamped share payload on read
        # (idempotent; app.migrate_db stamps them at rest).
        export_data, _, _ = scimaschema.normalize_export(export_data)

        conn.execute(
            """
            UPDATE decks
            SET downloads = downloads + 1
            WHERE id = ?
            """,
            (deck_id,),
        )

    return export_data


# ── Packs directory listing (hidden /packs/ page) ─────────────────────────


@app.get("/api/v1/packs")
def list_packs(request: Request):
    """List *.json packs in <landing>/assets/packs/, merging optional
    curated metadata from manifest.json. The page falls back to reading
    manifest.json directly when no backend is present (static hosting)."""
    enforce_rate_limit(request, "packs")
    manifest: dict = {}
    mf = PACKS_DIR / "manifest.json"
    if mf.is_file():
        try:
            raw = json.loads(mf.read_text(encoding="utf-8"))
            entries = raw.get("packs") if isinstance(raw, dict) else raw
            for e in entries or []:
                if isinstance(e, dict) and isinstance(e.get("file"), str):
                    manifest[e["file"]] = e
        except (ValueError, OSError):
            manifest = {}
    items = []
    if PACKS_DIR.is_dir():
        for p in sorted(PACKS_DIR.glob("*.json")):
            if p.name == "manifest.json" or not p.is_file():
                continue
            meta = manifest.get(p.name, {})
            items.append({
                "file": p.name,
                "name": str(meta.get("name") or p.stem)[:80],
                "description": str(meta.get("description") or "")[:300],
                "bytes": p.stat().st_size,
            })
    return {"packs": items}



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

    # Storage grade: stamped share/deck envelope (app/scimaschema.py). The
    # DeckUploadRequest validator has already verified any envelope that
    # arrived, expanded skeletal short-key cards, and filled legacy
    # defaults — stamping here is what lands on disk and round-trips
    # through /export.
    export_payload = scimaschema.stamp(
        body.model_dump(
            mode="json",
            by_alias=True,
        ),
        "share",
        "deck",
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
# Registration order matters: Starlette matches routes and mounts in the
# order they were added, so the catch-all "/" mount must stay LAST — every
# API route above and the two specific mounts below win over it.

# Repo-root-relative locations, derived from this file rather than hardcoded
# absolute paths — the checkout can live anywhere (/home/scima/study,
# /home/scima/scima-learning, a dev laptop…) and the mounts follow it.
# main.py sits at <repo>/backend/app/main.py, so parents[2] is <repo>.
REPO_ROOT = Path(__file__).resolve().parents[2]
# Static root probe: THIS FILE (site/backend) is the single canonical
# backend; minified/backend/ is a byte-identical generated copy that the
# deploy bundle ships (minify.sh re-syncs it), so the same code runs with
# REPO_ROOT == site/ (canonical), REPO_ROOT == minified/ (deploy copy), a
# bare repo root, or any checkout layout. SCIMA_STATIC_ROOT overrides
# everything; otherwise first existing candidate wins.
STATIC_CANDIDATES = ("home", "minified/home", "site/home",
                     "../minified/home", "../site/home")
STUDY_LANDING_DIR = Path(os.environ["SCIMA_STATIC_ROOT"]) \
    if os.environ.get("SCIMA_STATIC_ROOT") else \
    next((p for p in (REPO_ROOT / c for c in STATIC_CANDIDATES)
          if (p / "index.html").exists()), REPO_ROOT / "home")
# Legacy standalone community page: the deprecated shell used to be mounted
# at /community/, but it is a trap — a half-dead document ("community loads
# without any of the content") that stale edge objects and old bookmarks can
# still land on. The live community view lives in the landing document at
# /#community, so /community[/] now 302s there; deeper legacy paths keep
# working through the 404 deep-link rewrite below.

PACKS_DIR = STUDY_LANDING_DIR / "assets" / "packs"


@app.get("/community")
@app.get("/community/")
async def community_redirect():
    return RedirectResponse("/#community", status_code=302)


app.mount(
    "/dashboard",
    StaticFiles(directory=STUDY_LANDING_DIR, html=True),
    name="dashboard",
)

app.mount(
    "/",
    StaticFiles(directory=STUDY_LANDING_DIR, html=True),
    name="site",
)


# ── Fallback: unrecognized paths go Home ─────────────────────────────
# Anything no route and no static mount recognizes sends a browser back to
# Home ("/#home" — the hash selects the view; the /dashboard/ family stays
# inside its own family). Two deliberate exceptions keep 404s honest:
#   * /api/* stays a JSON 404 — API clients parse it;
#   * requests whose last path segment has a dot look like assets
#     (.js/.css/.woff2/…), and a redirect would put an HTML body inside a
#     <script> or <link> tag — a far more confusing failure than a 404.
# Registered as an int-keyed handler so only 404s are intercepted; every
# other HTTPException keeps Starlette's default rendering.
@app.exception_handler(404)
async def redirect_unknown_to_home(request: Request, exc: HTTPException):
    path = request.url.path
    if path.startswith("/api/"):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    # Deep links in path form (/decks/Biology/My%20Deck, /library/Fics/book,
    # /packs/spanish-starter) map onto the hash form the frontend parses —
    # checked before the asset-looking 404 rule below because deck/book/pack
    # names may contain dots.
    for prefix in ("/decks/", "/library/", "/packs/"):
        if path.startswith(prefix):
            rest = path[len(prefix):].strip("/")
            if rest:
                target = f"/{prefix.strip('/')}/#{prefix.strip('/')}/{rest}"
                return RedirectResponse(target, status_code=302)
    # Community deck deep links are different: the view lives in the LANDING
    # document (/#community/<deckId>), not under a /community/ route — and the
    # legacy /community mount (when present) 404s anything that isn't one of
    # its own files, landing here too.
    if path.startswith("/community/"):
        rest = path[len("/community/"):].strip("/")
        if rest:
            return RedirectResponse(f"/#community/{rest}", status_code=302)
    last = path.rstrip("/").rsplit("/", 1)[-1]
    if "." in last:
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    family = "/dashboard" if path.startswith("/dashboard/") else ""
    return RedirectResponse(f"{family}/#home", status_code=302)
