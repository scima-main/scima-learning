"""In-browser mocking of the community API (/api/v1/*) via page.route().

The community view (landing page, #community hash) only talks to
`${window.SCIMA_API_BASE || '/api/v1'}` public endpoints:

  GET  /health           → {"status": "ok"}
  GET  /decks?...        → DeckListResponse  {items, total, limit, offset}
  GET  /search?q=...     → DeckSearchResponse (same shape)
  GET  /decks/{id}       → deck detail
  GET  /decks/{id}/export→ full deck export JSON
  POST /decks            → upload

Mock shapes mirror backend/app/schemas.py so the UI code paths exercised
are the real ones. No backend process is needed.
"""
from __future__ import annotations

from fnmatch import fnmatch
from urllib.parse import urlparse

HEALTH_OK = {"status": "ok"}
NOW_ISO = "2026-08-22T10:22:41.149Z"


def deck_summary(id: str, name: str, *, subject: str = "chemistry",
                 card_count: int = 42, downloads: int = 7,
                 emoji: str | None = "🧪", author: str | None = "scima",
                 description: str = "", tags: list | None = None,
                 rating_average: float | None = 4.5, rating_count: int = 2,
                 **extra) -> dict:
    """One DeckSummary (backend/app/schemas.py)."""
    d = {
        "id": id,
        "name": name,
        "author": author,
        "subject": subject,
        "emoji": emoji,
        "level": None,
        "examBoard": None,
        "description": description or f"{name} — community deck.",
        "tags": tags if tags is not None else [subject],
        "cardCount": card_count,
        "downloads": downloads,
        "rating": {"average": rating_average, "count": rating_count},
        "createdAt": NOW_ISO,
        "updatedAt": NOW_ISO,
    }
    d.update(extra)
    return d


def deck_list(items: list, *, limit: int = 20, offset: int = 0) -> dict:
    """DeckListResponse / DeckSearchResponse envelope."""
    return {"items": items, "total": len(items), "limit": limit, "offset": offset}


def mock_api(page, handlers: dict, *, base: str = "/api/v1",
             unmatched_status: int = 404) -> list:
    """Route every /api/v1/* request through `handlers`.

    handlers maps path patterns (fnmatch globs relative to `base`, e.g.
    "/health", "/decks*") to either a JSON-serializable body or a dict
    {"status": int, "json": body}. Unmatched API paths get
    `unmatched_status` so the UI's error paths stay testable.

    Returns the list of recorded requests: [{method, path, url}].
    """
    recorded: list = []

    def handle(route):
        url = route.request.url
        path = urlparse(url).path
        if not path.startswith(base):
            route.fallback()
            return
        rel = path[len(base):] or "/"
        recorded.append({"method": route.request.method, "path": path, "url": url})
        for pattern, response in handlers.items():
            if fnmatch(rel, pattern) or fnmatch(path, base + pattern):
                status = 200
                body = response
                if isinstance(response, dict) and "json" in response and "status" in response:
                    status, body = response["status"], response["json"]
                route.fulfill(status=status, json=body)
                return
        route.fulfill(status=unmatched_status,
                      json={"detail": f"no mock for {rel}"})

    page.route(f"**{base}/**", handle)
    return recorded


def sample_online_handlers() -> dict:
    """A minimal 'healthy registry with two decks' handler set."""
    items = [
        deck_summary("d_mock_chem", "GCSE Chemistry — Atomic Structure",
                     subject="chemistry", card_count=58, downloads=23),
        deck_summary("d_mock_french", "French Verbs A-Level",
                     subject="french", emoji="🇫🇷", card_count=120, downloads=9),
    ]
    return {
        "/health": HEALTH_OK,
        "/decks": deck_list(items),
        "/decks*": deck_list(items),
        "/search*": deck_list(items),
    }
