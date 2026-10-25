"""Sanity tests for the /api/v1 surface - enough to confirm the API
framework itself works end to end (create -> list -> get -> search ->
tags/categories) against a throwaway SQLite DB + decks/ folder."""
import shutil
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

SAMPLE_EXPORT = {
    "version": 2,
    "exportedAt": "2026-08-22T10:22:41.149Z",
    "deck": {
        "id": "d_1787394145845_sdcnm",
        "name": "Spanish Basics",
        "emoji": "📖",
        "image": None,
        "subject": "language",
        "folderId": None,
        "color": "var(--blue)",
        "pinned": False,
        "cards": [
            {
                "id": "c_1787394158843_9qmuu",
                "front": "Hello",
                "back": "Hola",
                "answerCount": 1,
                "requiredAnswers": 1,
                "synonyms": [],
                "type": "basic",
                "ease": 2.5,
                "interval": 0,
                "reps": 0,
                "lapses": 0,
                "due": 1787394158843,
                "state": "new",
                "suspended": False,
                "leech": False,
                "created": 1787394158843,
                "lastRated": None,
            }
        ],
    },
    "citedSources": [],
}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import db as db_module
    monkeypatch.setattr(db_module, "DATA_DIR", tmp_path)
    monkeypatch.setattr(db_module, "DECKS_DIR", tmp_path / "decks")
    monkeypatch.setattr(db_module, "DB_PATH", tmp_path / "scima.db")

    from app import ratelimit as ratelimit_module
    ratelimit_module.reset()

    from app.main import app
    # base_url host must be in TrustedHostMiddleware's allowed list,
    # otherwise every request 400s ("Invalid HTTP host").
    with TestClient(app, base_url="http://localhost") as c:
        yield c

    ratelimit_module.reset()
    shutil.rmtree(tmp_path, ignore_errors=True)


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_empty_list(client):
    r = client.get("/api/v1/decks")
    assert r.status_code == 200
    assert r.json() == {"items": [], "total": 0, "limit": 50, "offset": 0}


def test_create_and_fetch_deck(client):
    body = {**SAMPLE_EXPORT, "meta": {"description": "Beginner Spanish", "author": "jdoe", "tags": ["spanish", "language"]}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 201
    created = r.json()
    assert created["id"].startswith("sd_")
    assert created["name"] == "Spanish Basics"
    assert created["emoji"] == "📖"
    assert created["subject"] == "language"
    assert created["author"] == "jdoe"
    assert created["description"] == "Beginner Spanish"
    assert created["cardCount"] == 1
    assert set(created["tags"]) == {"spanish", "language"}
    assert created["downloads"] == 0

    deck_id = created["id"]
    r2 = client.get(f"/api/v1/decks/{deck_id}")
    assert r2.status_code == 200
    assert r2.json() == created

    r3 = client.get("/api/v1/decks")
    assert r3.json()["total"] == 1
    assert r3.json()["items"][0]["id"] == deck_id

    # The export endpoint round-trips a stamped share/deck envelope and keeps
    # the source deck id as provenance inside the payload.
    r4 = client.get(f"/api/v1/decks/{deck_id}/export")
    assert r4.status_code == 200
    export = r4.json()
    assert export["$schema"] == "scima"
    assert export["schema"] == "share"
    assert export["kind"] == "deck"
    assert export["deck"]["id"] == "d_1787394145845_sdcnm"
    assert export["deck"]["cards"][0]["back"] == "Hola"


def test_fork_style_reupload_creates_new_entry(client):
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": []}}
    r1 = client.post("/api/v1/decks", json=body)
    r2 = client.post("/api/v1/decks", json=body)
    assert r1.json()["id"] != r2.json()["id"]
    assert client.get("/api/v1/decks").json()["total"] == 2


def test_search(client):
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": []}}
    client.post("/api/v1/decks", json=body)
    r = client.get("/api/v1/search", params={"q": "Spanish"})
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["name"] == "Spanish Basics"

    r_miss = client.get("/api/v1/search", params={"q": "nonexistent-term-xyz"})
    assert r_miss.json()["total"] == 0


def test_tagged_upload_and_tag_search(client):
    """Regression: tag inserts used to crash inside the deck_tags_ai FTS
    trigger ("no such column: T.tags"), 500ing every tagged upload."""
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": ["spanish", "beginner"]}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 201
    assert set(r.json()["tags"]) == {"spanish", "beginner"}

    r = client.get("/api/v1/search", params={"q": "spanish"})
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["name"] == "Spanish Basics"

    assert client.get("/api/v1/search", params={"q": "beginner"}).json()["total"] == 1
    assert client.get("/api/v1/search", params={"q": "french"}).json()["total"] == 0

    # The tag filter path (deck_tags subselect) agrees with FTS.
    r = client.get("/api/v1/decks", params={"tag": "spanish"})
    assert r.json()["total"] == 1


def test_fts_consistent_after_tag_delete(client):
    """deck_tags_ad must rebuild the FTS row from deck_tags (never read it
    back from decks_fts), leaving no stale tokens behind. Tags chosen so
    they don't collide with the deck name/subject — MATCH hits can then
    only come from the tags column."""
    from app import db as db_module

    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": ["flashcards", "drills"]}}
    client.post("/api/v1/decks", json=body)
    assert client.get("/api/v1/search", params={"q": "drills"}).json()["total"] == 1

    with db_module.db_session() as conn:
        conn.execute("DELETE FROM deck_tags WHERE tag = 'drills'")

    assert client.get("/api/v1/search", params={"q": "drills"}).json()["total"] == 0
    assert client.get("/api/v1/search", params={"q": "flashcards"}).json()["total"] == 1

    # Deleting the last tag must not corrupt the index either ('optimize'
    # merges segments and would surface any inconsistency).
    with db_module.db_session() as conn:
        conn.execute("DELETE FROM deck_tags WHERE tag = 'flashcards'")
        conn.execute("INSERT INTO decks_fts(decks_fts) VALUES('optimize')")

    assert client.get("/api/v1/search", params={"q": "flashcards"}).json()["total"] == 0
    # The deck itself remains searchable by name.
    assert client.get("/api/v1/search", params={"q": "Spanish"}).json()["total"] == 1


def test_tag_and_subject_filters(client):
    """The old /tags and /categories aggregate endpoints are gone (the
    community page derives chips from deck summaries); tag/subject
    filtering lives on the /decks list endpoint."""
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": ["spanish", "beginner"]}}
    client.post("/api/v1/decks", json=body)

    r = client.get("/api/v1/decks", params={"tag": "spanish"})
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert "spanish" in r.json()["items"][0]["tags"]

    assert client.get("/api/v1/decks", params={"tag": "french"}).json()["total"] == 0

    r = client.get("/api/v1/decks", params={"subject": "language"})
    assert r.json()["total"] == 1
    assert client.get("/api/v1/decks", params={"subject": "maths"}).json()["total"] == 0


def test_migrate_db_repairs_buggy_fts_triggers(client, tmp_path):
    """migrate_db._repair_fts_triggers must fix a database created with the
    old v5 triggers (the ones that read old values back out of decks_fts
    and crashed with 'no such column: T.tags' on any tag write)."""
    import sqlite3

    from app import db as db_module
    from app import migrate_db

    # `client` fixture has already monkeypatched db paths + run init_db.
    # Reinstall the historical buggy trigger to simulate an old database.
    buggy_trigger = """
        CREATE TRIGGER deck_tags_ai
        AFTER INSERT ON deck_tags
        BEGIN
            INSERT INTO decks_fts(
                decks_fts, rowid, name, subject, author, tags, description
            )
            SELECT 'delete', f.rowid, f.name, f.subject, f.author, f.tags, f.description
            FROM decks_fts f
            JOIN decks d ON d.rowid = f.rowid
            WHERE d.id = new.deck_id;
        END;
    """
    conn = sqlite3.connect(str(db_module.DB_PATH))
    try:
        conn.execute("DROP TRIGGER deck_tags_ai")
        conn.executescript(buggy_trigger)
        conn.execute(
            "INSERT INTO decks (id, name, description, subject, card_count, "
            "file_path, created_at, updated_at) "
            "VALUES ('sd_old', 'Old Deck', '', 'misc', 0, 'x.json', '', '')"
        )
        conn.commit()

        # The old trigger breaks any tag write...
        with pytest.raises(sqlite3.OperationalError, match="no such column: T.tags"):
            conn.execute("INSERT INTO deck_tags (deck_id, tag) VALUES ('sd_old', 'broken')")
        conn.rollback()
    finally:
        conn.close()

    # Dry run changes nothing.
    migrate_db._repair_fts_triggers(dry_run=True)
    conn = sqlite3.connect(str(db_module.DB_PATH))
    try:
        with pytest.raises(sqlite3.OperationalError):
            conn.execute("INSERT INTO deck_tags (deck_id, tag) VALUES ('sd_old', 'broken')")
        conn.rollback()
    finally:
        conn.close()

    # Real run repairs it; tag writes and FTS queries work afterwards.
    migrate_db._repair_fts_triggers(dry_run=False)
    with db_module.db_session() as conn:
        conn.execute("INSERT INTO deck_tags (deck_id, tag) VALUES ('sd_old', 'fixed')")
    assert client.get("/api/v1/search", params={"q": "fixed"}).json()["total"] == 1

    # Running the repair twice is a no-op (idempotent).
    migrate_db._repair_fts_triggers(dry_run=False)
    assert client.get("/api/v1/search", params={"q": "fixed"}).json()["total"] == 1


def test_get_missing_deck_404(client):
    r = client.get("/api/v1/decks/sd_doesnotexist")
    assert r.status_code == 404


def test_create_deck_rate_limit(client):
    """5 / hour / IP on POST /api/v1/decks."""
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": []}}
    for _ in range(5):
        r = client.post("/api/v1/decks", json=body)
        assert r.status_code == 201
    r6 = client.post("/api/v1/decks", json=body)
    assert r6.status_code == 429
    assert "Retry-After" in r6.headers


def test_search_rate_limit(client):
    """60 / minute / IP on GET /api/v1/search."""
    for _ in range(60):
        r = client.get("/api/v1/search", params={"q": "x"})
        assert r.status_code == 200
    r61 = client.get("/api/v1/search", params={"q": "x"})
    assert r61.status_code == 429


def test_list_decks_rate_limit(client):
    """120 / minute / IP on GET /api/v1/decks."""
    for _ in range(120):
        r = client.get("/api/v1/decks")
        assert r.status_code == 200
    r121 = client.get("/api/v1/decks")
    assert r121.status_code == 429


def test_get_deck_rate_limit(client):
    """120 / minute / IP on GET /api/v1/decks/{id} (no-download requests)."""
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": []}}
    deck_id = client.post("/api/v1/decks", json=body).json()["id"]
    for _ in range(119):  # one create already consumed nothing from this bucket
        r = client.get(f"/api/v1/decks/{deck_id}")
        assert r.status_code == 200
    r_last = client.get(f"/api/v1/decks/{deck_id}")
    assert r_last.status_code == 200
    r_over = client.get(f"/api/v1/decks/{deck_id}")
    assert r_over.status_code == 429


def test_export_deck_rate_limit(client):
    """30 / minute / IP on GET /api/v1/decks/{id}/export, distinct from the
    120/minute summary-fetch bucket, and only the export path increments
    the downloads counter."""
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": []}}
    deck_id = client.post("/api/v1/decks", json=body).json()["id"]

    # Plain summary fetches should NOT move the downloads counter.
    for _ in range(3):
        client.get(f"/api/v1/decks/{deck_id}")
    assert client.get(f"/api/v1/decks/{deck_id}").json()["downloads"] == 0

    for _ in range(30):
        r = client.get(f"/api/v1/decks/{deck_id}/export")
        assert r.status_code == 200
    assert client.get(f"/api/v1/decks/{deck_id}").json()["downloads"] == 30

    r_over = client.get(f"/api/v1/decks/{deck_id}/export")
    assert r_over.status_code == 429
    assert "Retry-After" in r_over.headers


def test_search_query_too_long(client):
    r = client.get("/api/v1/search", params={"q": "x" * 201})
    assert r.status_code == 422


def test_deck_name_too_long_rejected(client):
    bad_deck = {**SAMPLE_EXPORT["deck"], "name": "x" * 201}
    body = {**SAMPLE_EXPORT, "deck": bad_deck, "meta": {"description": "", "author": "", "tags": []}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 422


def test_too_many_cards_rejected(client):
    cards = [{**SAMPLE_EXPORT["deck"]["cards"][0], "id": f"c_{i}"} for i in range(5001)]
    bad_deck = {**SAMPLE_EXPORT["deck"], "cards": cards}
    body = {**SAMPLE_EXPORT, "deck": bad_deck, "meta": {"description": "", "author": "", "tags": []}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 422


def test_card_text_field_too_large_rejected(client):
    bad_card = {**SAMPLE_EXPORT["deck"]["cards"][0], "front": "x" * (100 * 1024 + 1)}
    bad_deck = {**SAMPLE_EXPORT["deck"], "cards": [bad_card]}
    body = {**SAMPLE_EXPORT, "deck": bad_deck, "meta": {"description": "", "author": "", "tags": []}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 422


def test_too_many_tags_rejected(client):
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": [f"t{i}" for i in range(31)]}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 422


def test_tag_too_long_rejected(client):
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": ["x" * 51]}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 422


def test_author_too_long_rejected(client):
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "x" * 201, "tags": []}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 422


def test_description_too_large_rejected(client):
    body = {**SAMPLE_EXPORT, "meta": {"description": "x" * (25 * 1024 + 1), "author": "", "tags": []}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 422


def test_request_body_too_large_rejected(client):
    huge_card = {**SAMPLE_EXPORT["deck"]["cards"][0], "front": "x" * (6 * 1024 * 1024)}
    bad_deck = {**SAMPLE_EXPORT["deck"], "cards": [huge_card]}
    body = {**SAMPLE_EXPORT, "deck": bad_deck, "meta": {"description": "", "author": "", "tags": []}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code in (413, 422)


def test_deck_internal_fields_not_promoted_to_metadata(client):
    """pinned/ease/interval/etc must never leak into community metadata —
    and since uploads are normalized to the typed share payload
    (DeckData/CardItem), they no longer survive into the stored export
    either. Real card content still round-trips."""
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": []}}
    r = client.post("/api/v1/decks", json=body)
    created = r.json()
    study_state_fields = ("pinned", "ease", "interval", "due", "state", "reps", "lapses")
    for study_state_field in study_state_fields:
        assert study_state_field not in created

    export = client.get(f"/api/v1/decks/{created['id']}/export").json()
    for study_state_field in study_state_fields:
        assert study_state_field not in export["deck"]
        assert study_state_field not in export["deck"]["cards"][0]
    assert export["deck"]["cards"][0]["front"] == "Hello"
    assert export["deck"]["cards"][0]["back"] == "Hola"


def test_meta_description_safety_net(client):
    """HTML served without a meta description gets the site default injected."""
    from fastapi.responses import HTMLResponse
    from fastapi.routing import APIRoute
    from app import main as m

    def _nd():
        return HTMLResponse("<html><head><title>x</title></head><body>hi</body></html>")

    # the catch-all static mount outranks late-added routes → insert first
    m.app.routes.insert(0, APIRoute("/tmp-nodesc", _nd, include_in_schema=False))
    r = client.get("/tmp-nodesc")
    assert r.status_code == 200
    assert 'name="description"' in r.text
    assert "SCIMA Learning is a private" in r.text
    assert r.text.index('name="description"') < r.text.index("<title>")


def test_meta_description_not_duplicated(client):
    r = client.get("/")
    assert r.text.lower().count('name="description"') == 1


def test_http_to_https_redirect(client):
    r = client.get("/", headers={"x-forwarded-proto": "http"}, follow_redirects=False)
    assert r.status_code == 301
    assert r.headers["location"].startswith("https://")


def test_no_redirect_without_proxy_header(client):
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 200


def test_packs_endpoint_lists_and_merges_manifest(client, monkeypatch, tmp_path):
    from app import main as m
    packs = tmp_path / "packs"
    packs.mkdir()
    (packs / "manifest.json").write_text(
        '{"packs": [{"file": "a.json", "name": "Alpha", "description": "d"}]}',
        encoding="utf-8")
    (packs / "a.json").write_text('{"deck": {"name": "A", "cards": []}}', encoding="utf-8")
    (packs / "b.json").write_text('{"deck": {"name": "B", "cards": []}}', encoding="utf-8")
    monkeypatch.setattr(m, "PACKS_DIR", packs)
    r = client.get("/api/v1/packs")
    assert r.status_code == 200
    items = r.json()["packs"]
    assert [i["file"] for i in items] == ["a.json", "b.json"]
    assert items[0]["name"] == "Alpha" and items[0]["description"] == "d"
    assert items[1]["name"] == "b"                      # stem fallback
    assert items[0]["bytes"] > 0


def test_packs_endpoint_ships_sample(client):
    r = client.get("/api/v1/packs")
    files = [i["file"] for i in r.json()["packs"]]
    assert "spanish-starter.json" in files


def test_deeplink_rewrite_packs_path_to_hash(client):
    """/packs/<stem> (path form) 302s to the hash form the frontend parses
    (#packs/<stem> opens that pack's detail modal)."""
    r = client.get("/packs/spanish-starter", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "/packs/#packs/spanish-starter"


def test_deeplink_rewrite_community_path_to_hash(client):
    """/community/<deckId> 302s to the LANDING document's hash view —
    the community deck registry lives at /#community/<deckId>, not under
    the deprecated /community/ mount."""
    r = client.get("/community/d_abc123", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "/#community/d_abc123"


def test_deeplink_rewrite_keeps_asset_404s_honest(client):
    """A missing file under /packs/ that the frontend can still parse is
    rewritten (lenient resolution shows the list), but a missing ASSET under
    another route (dotted segment outside the deep-link prefixes) stays a
    JSON 404 — <script>/<link> tags must never receive an HTML redirect."""
    r = client.get("/app/does-not-exist.js", follow_redirects=False)
    assert r.status_code == 404
    assert r.json() == {"detail": "Not Found"}


# ── Security headers / Content-Security-Policy (review S1-S3 hardening) ──

import base64 as _base64
import hashlib as _hashlib
import re as _re


def _csp(response) -> str:
    return response.headers.get("content-security-policy", "")


def test_baseline_security_headers_on_html(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.headers.get("x-content-type-options") == "nosniff"
    assert r.headers.get("x-frame-options") == "DENY"
    assert r.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert "camera=()" in r.headers.get("permissions-policy", "")
    csp = _csp(r)
    assert "default-src 'self'" in csp
    assert "object-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp
    # script-src must stay strict: hashes only, never 'unsafe-inline'
    script_src = csp.split("script-src", 1)[1].split(";", 1)[0]
    assert "'unsafe-inline'" not in script_src
    assert "'unsafe-eval'" not in csp


def test_csp_hashes_cover_inline_page_script(client):
    """Every page's one inline <script> (window.SCIMA_PAGE) must be covered
    by a sha256 source hash, recomputed here independently of the
    middleware — if the hashing regex or the pages drift apart, the app
    would fail to boot in production, so this is a load-bearing test."""
    for route in ("/", "/study/", "/library/", "/decks/"):
        r = client.get(route)
        assert r.status_code == 200, route
        m = _re.search(rb"<script>(.*?)</script>", r.content, _re.S)
        assert m, f"{route} should declare SCIMA_PAGE inline"
        digest = _base64.b64encode(
            _hashlib.sha256(m.group(1)).digest()).decode("ascii")
        assert f"'sha256-{digest}'" in _csp(r), route


def test_csp_on_json_has_no_hashes(client):
    r = client.get("/api/v1/health")
    assert r.headers.get("x-content-type-options") == "nosniff"
    csp = _csp(r)
    assert csp.startswith("default-src 'self'")
    assert "sha256-" not in csp  # non-HTML bodies carry no inline scripts


def test_hsts_only_behind_tls(client):
    plain = client.get("/api/v1/health")
    assert "strict-transport-security" not in plain.headers
    tls = client.get(
        "/api/v1/health", headers={"x-forwarded-proto": "https"})
    assert tls.headers.get(
        "strict-transport-security", "").startswith("max-age=31536000")


def test_non_js_static_assets_also_get_no_cache(client):
    """ABOUT.md and the icon sprite are fetch()ed by the frontend; without
    Cache-Control they got heuristic freshness and a once-cached stale or
    failed response replayed on every ordinary reload (the Ctrl+R bug)."""
    for path in ("/assets/svg/icons.svg", "/ABOUT.md"):
        r = client.get(path)
        assert r.status_code == 200, path
        assert r.headers.get("cache-control") == "no-cache", path


def test_html_asset_urls_carry_version_stamp(client):
    """Served HTML stamps relative .js/.css URLs with ?v=<APP_VERSION> so a
    fresh document can never be answered by stale cached assets (the
    'empty app until hard reload' mix)."""
    import re as _re
    from pathlib import Path as _P
    ver = _re.search(
        rb"const APP_VERSION = '([^']+)'",
        (_P(__file__).resolve().parents[2] / "home" / "shared" / "shared.js").read_bytes(),
    ).group(1).decode()
    for route in ("/", "/study/"):
        body = client.get(route).text
        assert f"?v={ver}" in body, route
        assert 'shared/theme.js?v=' in body or '../shared/theme.js?v=' in body, route
        assert 'app/dashboard.css?v=' in body or '../app/dashboard.css?v=' in body, route
    # external URLs untouched
    assert 'fonts.googleapis.com/css2?family=Nunito' in client.get("/").text
    assert '?v=' not in client.get("/").text.split('fonts.googleapis.com')[1].split('"')[0]


def test_legacy_community_path_redirects_to_landing_view(client):
    """The deprecated standalone shell must never be served again: /community
    and /community/ 302 to the landing document's #community view."""
    for path in ("/community", "/community/"):
        r = client.get(path, follow_redirects=False)
        assert r.status_code == 302, path
        assert r.headers["location"] == "/#community", path
    # deep legacy links keep working through the 404 rewrite
    r = client.get("/community/sd_abc123", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "/#community/sd_abc123"
