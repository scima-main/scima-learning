"""scimaschema.py — Python mirror of home/shared/scima-schema.js.

The three-schema interchange system, server side:

  skeletal  Bare-minimum text cards under one-letter keys (f/b/h/t/…).
            Import-only: accepted on upload, expanded to long keys before
            validation. Never produced by the backend.

  share     Human-readable long keys, no user-specific metadata. The grade
            the backend stores and serves: every deck export file on disk
            is (or is normalized to) a stamped share envelope.

  full      The dashboard's own storage/account-backup grade. Recognized
            on upload (its user fields simply don't survive DeckData/
            CardItem validation) and produced only by the client.

Envelope:
  {"$schema": "scima", "schema": ..., "schemaVersion": 1, "kind": ..., ...}

classify() recognizes stamped payloads first, then the pre-envelope
generations the app has produced (version:2 deck/folder/collection exports,
version:3 account backups, raw mf_state snapshots, header-less card lists)
and returns None for anything unrecognized — callers must not guess.

Keep the rules in lockstep with the JS module; harness section S25 pins
the JS side, backend/tests pin this side.
"""

from typing import Any, Optional

SCHEMA_VERSION = 1
SCHEMAS = ("skeletal", "share", "full")
KINDS = ("cards", "deck", "folder", "collection", "account")

# skeletal short key → long card key. Text-content fields only, covering
# every card type (basic, multi-answer, markscheme/process, calculation,
# table). Must match SKELETAL_KEYS in scima-schema.js exactly.
SKELETAL_KEYS = {
    "f": "front", "b": "back", "h": "hint", "t": "tags", "ty": "type",
    "an": "answerCount", "rq": "requiredAnswers", "sy": "synonyms",
    "mp": "methodPool", "mr": "methodRequired",
    "cu": "calcUnit", "ct": "calcTolerance", "cm": "calcToleranceMode",
    "td": "tableData", "tt": "tableTolerance", "tm": "tableToleranceMode",
}
_LONG_KEYS = set(SKELETAL_KEYS.values())

# User-specific fields that never travel in a share payload.
USER_CARD_FIELDS = (
    "id", "ease", "interval", "reps", "lapses", "due", "state",
    "created", "lastRated", "suspended", "leech",
)
USER_DECK_FIELDS = ("id", "pinned")


def _is_obj(v: Any) -> bool:
    return isinstance(v, dict)


def skeletal_to_card(s: Optional[dict]) -> dict:
    """Expand skeletal short keys to the long-key card shape (long keys win;
    unknown keys are dropped — skeletal is a closed set)."""
    out: dict = {}
    for k, v in (s or {}).items():
        long = SKELETAL_KEYS.get(k) or (k if k in _LONG_KEYS else None)
        if long is not None and v is not None:
            out[long] = v
    return out


def cards_to_long(cards: Any) -> list:
    """Normalize a card list that may mix skeletal short keys and long keys
    into long-key dicts."""
    if not isinstance(cards, list):
        return []
    out = []
    for c in cards:
        if (_is_obj(c) and ("f" in c or "b" in c)
                and "front" not in c and "back" not in c):
            out.append(skeletal_to_card(c))
        else:
            out.append(c)
    return out


def stamp(payload: dict, schema: str, kind: str) -> dict:
    """Add the envelope to a payload dict (returns a new dict, envelope
    keys first)."""
    return {
        "$schema": "scima",
        "schema": schema,
        "schemaVersion": SCHEMA_VERSION,
        "kind": kind,
        **payload,
    }


def classify(p: Any) -> Optional[dict]:
    """Classify any payload → {"schema", "kind", "legacy"} or None.

    schema is 'skeletal'|'share'|'full' for stamped payloads, or carries a
    'legacy-*' marker (in "legacy") for recognized pre-envelope shapes.
    Anything unrecognized → None; callers reject instead of guessing.
    Mirrors scimaClassify() in home/shared/scima-schema.js branch for branch.
    """
    # 0) Bare card arrays (header-less skeletal/share lists)
    if isinstance(p, list):
        if not p or not all(_is_obj(c) for c in p):
            return None
        has_short = any(("f" in c or "b" in c) and "front" not in c and "back" not in c for c in p)
        return {"schema": "skeletal" if has_short else "share",
                "kind": "cards", "legacy": False if has_short else "bare-array"}
    if not _is_obj(p):
        return None
    # 1) Stamped envelope
    if p.get("$schema") == "scima" and isinstance(p.get("schema"), str):
        schema = p["schema"]
        if schema not in SCHEMAS:
            return None
        if isinstance(p.get("kind"), str):
            kind: Optional[str] = p["kind"]
        elif _is_obj(p.get("deck")):
            kind = "deck"
        elif p.get("decks") is not None:
            kind = "account" if (p.get("sources") or p.get("settings")) else "collection"
        elif isinstance(p.get("cards"), list):
            kind = "cards"
        else:
            kind = None
        if kind in KINDS:
            return {"schema": schema, "kind": kind, "legacy": False}
        return None
    # 2) Legacy generations (pre-envelope), by shape
    if p.get("version") == 3 and isinstance(p.get("decks"), list):
        return {"schema": "full", "kind": "account", "legacy": "v3-account"}
    if p.get("version") == 2:
        if _is_obj(p.get("deck")) and isinstance(p["deck"].get("cards"), list):
            return {"schema": "share", "kind": "deck", "legacy": "v2-deck"}
        if _is_obj(p.get("folder")) and isinstance(p.get("decks"), list):
            return {"schema": "share", "kind": "folder", "legacy": "v2-folder"}
        if isinstance(p.get("decks"), list):
            return {"schema": "share", "kind": "collection", "legacy": "v2-collection"}
    # 3) Header-less shapes
    if isinstance(p.get("decks"), list) and (p.get("settings") is not None or p.get("reviewHistory") is not None):
        return {"schema": "full", "kind": "account", "legacy": "mf-state"}
    if _is_obj(p.get("deck")) and isinstance(p["deck"].get("cards"), list):
        return {"schema": "share", "kind": "deck", "legacy": "unversioned-deck"}
    cards = p.get("cards")
    if isinstance(cards, list) and cards and all(_is_obj(c) for c in cards):
        has_short = any(("f" in c or "b" in c) and "front" not in c and "back" not in c for c in cards)
        return {"schema": "skeletal" if has_short else "share",
                "kind": "cards", "legacy": False if has_short else "long-cards"}
    return None


def deck_to_share(deck: dict, keep_ids: bool = False) -> dict:
    """Strip user-specific fields from one deck → share grade. (Stored
    backend payloads are share-grade by construction — CardItem carries no
    scheduling fields — so this is mainly for parity/tests and any future
    richer payloads.)"""
    out = dict(deck or {})
    if not keep_ids:
        for f in USER_DECK_FIELDS:
            out.pop(f, None)
    cards = out.get("cards")
    if isinstance(cards, list):
        cleaned = []
        for c in cards:
            if _is_obj(c):
                c = dict(c)
                for f in USER_CARD_FIELDS:
                    c.pop(f, None)
            cleaned.append(c)
        out["cards"] = cleaned
    return out


def normalize_export(payload: Any) -> tuple:
    """Normalize a stored/served deck-export payload to a stamped share
    envelope.

    Returns (payload, changed, note):
      - already a stamped share deck      → (same, False, None)
      - recognized legacy/other grade     → (converted copy, True, legacy name)
      - not a deck payload / unrecognized → (same, False, note) — left alone,
        never corrupted.

    Conversion is additive: it stamps the envelope and expands skeletal
    short-key cards to long keys. It never removes stored data (deck.id is
    provenance server-side — it maps to the source_deck_id column).
    Idempotent, so the read path can call it on every export.
    """
    cls = classify(payload)
    if cls is None:
        return payload, False, "unrecognized payload — left untouched"
    if cls["kind"] != "deck":
        return payload, False, f"not a deck export (kind={cls['kind']}) — left untouched"
    if not cls["legacy"] and cls["schema"] == "share":
        return payload, False, None

    rest = {k: v for k, v in payload.items()
            if k not in ("$schema", "schema", "schemaVersion", "kind")}
    out = stamp(rest, "share", "deck")
    deck = out.get("deck")
    if _is_obj(deck) and isinstance(deck.get("cards"), list):
        out["deck"] = {**deck, "cards": cards_to_long(deck["cards"])}
    return out, True, (cls["legacy"] or f"{cls['schema']}→share")
