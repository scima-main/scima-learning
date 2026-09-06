from typing import Optional
from pydantic import BaseModel, Field, field_validator

# ── Limits ───────────────────────────────────────────────────────────

MAX_CARDS_PER_DECK = 5000
MAX_CARD_TEXT_BYTES = 100 * 1024

MAX_DECK_NAME_CHARS = 200
MAX_DESCRIPTION_BYTES = 25 * 1024
MAX_AUTHOR_CHARS = 200

MAX_TAGS = 30
MAX_TAG_CHARS = 50

MAX_SEARCH_QUERY_CHARS = 200
MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024
MAX_SUBJECT_CHARS = 100
MAX_EMOJI_CHARS = 16  # generous — covers multi-codepoint emoji (ZWJ sequences, skin tones)
MAX_LEVEL_CHARS = 50
MAX_EXAM_BOARD_CHARS = 50

def _utf8_len(value: str) -> int:
    return len(value.encode("utf-8"))

# ── Strictly Typed Deck Objects ──────────────────────────────────────

class CardItem(BaseModel):
    front: str = ""
    back: str = ""
    hint: Optional[str] = None

    @field_validator("front", "back")
    @classmethod
    def validate_card_text(cls, value: str) -> str:
        if _utf8_len(value) > MAX_CARD_TEXT_BYTES:
            raise ValueError(f"card text exceeds {MAX_CARD_TEXT_BYTES} bytes")
        return value

    @field_validator("hint")
    @classmethod
    def validate_hint(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and _utf8_len(value) > MAX_CARD_TEXT_BYTES:
            raise ValueError(f"hint exceeds {MAX_CARD_TEXT_BYTES} bytes")
        return value


class DeckData(BaseModel):
    id: Optional[str] = None
    name: str = "untitled"
    subject: str = "misc"
    # Deck-level cover emoji/exam metadata, ported through from the dashboard's
    # own deck object (community/app.js already forwards these on upload via
    # `...cleanDeck` — they were just silently dropped here before, since
    # pydantic ignores undeclared fields by default). Also stored as their own
    # `decks` columns (see db.py, schema v5) so DeckSummary/list/search cards
    # pick them up too, not just the /export round trip.
    emoji: Optional[str] = None
    level: Optional[str] = None
    examBoard: Optional[str] = None
    # Deliberately no `image` field: community/app.js's sanitiseDeck() already
    # strips per-card images before upload specifically to avoid storing large
    # embedded image payloads server-side, so a deck-level cover image isn't
    # accepted here either, by the same design intent.
    cards: list[CardItem] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) > MAX_DECK_NAME_CHARS:
            raise ValueError(f"deck name exceeds {MAX_DECK_NAME_CHARS} characters")
        return value or "untitled"

    @field_validator("emoji")
    @classmethod
    def validate_emoji(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if len(value) > MAX_EMOJI_CHARS:
            raise ValueError(f"emoji exceeds {MAX_EMOJI_CHARS} characters")
        return value or None

    @field_validator("level")
    @classmethod
    def validate_level(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if len(value) > MAX_LEVEL_CHARS:
            raise ValueError(f"level exceeds {MAX_LEVEL_CHARS} characters")
        return value or None

    @field_validator("examBoard")
    @classmethod
    def validate_exam_board(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if len(value) > MAX_EXAM_BOARD_CHARS:
            raise ValueError(f"examBoard exceeds {MAX_EXAM_BOARD_CHARS} characters")
        return value or None

    @field_validator("subject")
    @classmethod
    def validate_subject(cls, value: str) -> str:
        value = value.strip()
        if len(value) > MAX_SUBJECT_CHARS:
            raise ValueError(f"subject exceeds {MAX_SUBJECT_CHARS} characters")
        return value or "misc"

    @field_validator("cards")
    @classmethod
    def validate_cards(cls, cards: list[CardItem]) -> list[CardItem]:
        if len(cards) > MAX_CARDS_PER_DECK:
            raise ValueError(f"deck has too many cards (max {MAX_CARDS_PER_DECK})")
        return cards

# ── Upload Schemas ───────────────────────────────────────────────────

class DeckMeta(BaseModel):
    description: str = ""
    author: Optional[str] = None
    tags: list[str] = Field(default_factory=list)

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str) -> str:
        value = value.strip()
        if _utf8_len(value) > MAX_DESCRIPTION_BYTES:
            raise ValueError(f"description exceeds {MAX_DESCRIPTION_BYTES} bytes")
        return value

    @field_validator("author")
    @classmethod
    def validate_author(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if len(value) > MAX_AUTHOR_CHARS:
            raise ValueError(f"author exceeds {MAX_AUTHOR_CHARS} characters")
        return value or None

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, value: list[str]) -> list[str]:
        if len(value) > MAX_TAGS:
            raise ValueError(f"too many tags (max {MAX_TAGS})")

        result = []
        seen = set()
        for tag in value:
            tag = tag.strip().lower()  # Force lowercasing for consistent tag storage
            if not tag:
                continue
            if len(tag) > MAX_TAG_CHARS:
                raise ValueError(f"tag exceeds {MAX_TAG_CHARS} characters")
            if tag not in seen:
                seen.add(tag)
                result.append(tag)
        return result


class DeckUploadRequest(BaseModel):
    version: int
    exportedAt: str
    deck: DeckData
    citedSources: list[str] = Field(default_factory=list)
    meta: DeckMeta = Field(default_factory=DeckMeta)

# ── Catalogue Schemas ────────────────────────────────────────────────

class Rating(BaseModel):
    average: Optional[float] = None
    count: int = 0


class DeckSummary(BaseModel):
    id: str
    name: str
    author: Optional[str] = None
    subject: str
    emoji: Optional[str] = None
    level: Optional[str] = None
    examBoard: Optional[str] = None
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    cardCount: int
    downloads: int = 0
    rating: Rating = Field(default_factory=Rating)
    createdAt: str
    updatedAt: str


class DeckListResponse(BaseModel):
    items: list[DeckSummary]
    total: int
    limit: int
    offset: int


class DeckSearchResponse(BaseModel):
    items: list[DeckSummary]
    total: int
    limit: int
    offset: int
