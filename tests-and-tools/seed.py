#!/usr/bin/env python3
"""Deterministic seed data for SCIMA Learning frontend tests.

Builds the two localStorage blobs the site reads at boot:

  mf_state      {"decks": [...], "folders": [...], "sources": [...],
                 "reviewHistory": [...], "streak": N, "settings": {...}}
  SCIMATracker  XP/subject tracker — partial seeds are fine; shared.js's
                sanitizeState() fills every missing field with its default.

Shapes mirror home/shared/shared.js (sanitizeCard/sanitizeDeck/sanitizeFolder/
sanitizeSource/sanitizeMfState). Fields you omit get the app's own defaults,
and settings are MERGED onto the app defaults — a seed only lists overrides.

The default seeds set settings.onboarding.completed=true so the first-run
guided tour does NOT fire (pass tour_done=False to test the tour instead).

Library use:
    import seed
    mf = seed.make_mf_state(decks=[seed.make_deck("X", [seed.make_card("a","b")])])

CLI use:
    python tests/seed.py --list
    python tests/seed.py --preset demo --print
    python tests/seed.py --preset demo --out tests/scenarios/seeds/demo.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone

DAY_MS = 86_400_000
_COUNTER = {"n": 0}

# The built-in AQA subjects from home/shared/shared.js SUBJECTS (the tracker
# seed only lists the ones it wants to give XP to; sanitizeState fills the
# rest). 'misc' (Miscellaneous) is the catch-all decks get by default.
BUILTIN_SUBJECTS = [
    "englishLanguage", "englishLiterature", "mathematics", "furtherMathematics",
    "biology", "chemistry", "physics", "computerScience", "economics",
    "french", "geography", "music",
]
MISC_SUBJECT = {"name": "Miscellaneous", "short": "Misc", "board": "N/A",
                "examMarks": 100, "defaultColor": "#AAAAAA"}


def now_ms() -> int:
    return int(time.time() * 1000)


def _uid(prefix: str) -> str:
    _COUNTER["n"] += 1
    return f"{prefix}_seed_{_COUNTER['n']:03d}"


def utc_day(offset_days: int = 0) -> str:
    """YYYY-MM-DD in UTC — matches the app's today() (toISOString-based)."""
    return (datetime.now(timezone.utc) + timedelta(days=offset_days)).strftime("%Y-%m-%d")


# ── cards ────────────────────────────────────────────────────────────────────

def make_card(front: str, back: str, *, card_id: str | None = None,
              type: str = "basic", due_offset_ms: int = -1000,
              due_ms: int | None = None, state: str | None = None,
              ease: float = 2.5, interval: int = 0, reps: int = 0,
              lapses: int = 0, suspended: bool = False, leech: bool = False,
              hint: str | None = None, tags: list | None = None,
              answer_count: int = 1, required_answers: int = 1,
              synonyms: list | None = None, created_offset_ms: int = -7 * DAY_MS,
              last_rated_ms: int | None = None, **extra) -> dict:
    """One flashcard. Defaults = a brand-new card that is due right now.

    due_offset_ms  due = now + offset (negative → already due)
    state          'new' | 'learning' | 'review' (defaults from reps)
    type           basic cloze reversal markscheme process calculation table
    """
    now = now_ms()
    if state is None:
        state = "new" if reps == 0 else "review"
    card = {
        "id": card_id or _uid("c"),
        "front": front,
        "back": back,
        "answerCount": answer_count,
        "requiredAnswers": required_answers,
        "synonyms": synonyms or [],
        "type": type,
        "ease": ease,
        "interval": interval,
        "reps": reps,
        "lapses": lapses,
        "due": due_ms if due_ms is not None else now + due_offset_ms,
        "state": state,
        "suspended": suspended,
        "leech": leech,
        "created": now + created_offset_ms,
        "lastRated": last_rated_ms,
    }
    if hint is not None:
        card["hint"] = hint
    if tags is not None:
        card["tags"] = tags
    card.update(extra)
    return card


def make_deck(name: str, cards: list | None = None, *, deck_id: str | None = None,
              emoji: str = "📚", subject: str = "misc", folder_id: str | None = None,
              color: str = "var(--blue)", pinned: bool = False,
              image: str | None = None) -> dict:
    return {
        "id": deck_id or _uid("d"),
        "name": name,
        "emoji": emoji,
        "image": image,
        "subject": subject,
        "folderId": folder_id,
        "color": color,
        "pinned": pinned,
        "cards": cards or [],
    }


def make_folder(name: str, *, folder_id: str | None = None, emoji: str = "📁",
                subject: str = "misc", parent_id: str | None = None) -> dict:
    return {
        "id": folder_id or _uid("f"),
        "name": name,
        "emoji": emoji,
        "image": None,
        "subjectKey": subject,
        "parentId": parent_id,
        "color": "var(--blue)",
    }


def make_source(name: str, content: str = "", *, source_id: str | None = None,
                type: str = "text", subject_key: str | None = None,
                chars_read: int | None = None, time_spent_sec: int = 0) -> dict:
    return {
        "id": source_id or _uid("src"),
        "name": name,
        "type": type,
        "content": content,
        "chapters": [],
        "hasPdf": False,
        "hasHtml": False,
        "libraryFolderId": None,
        "bookmarks": [],
        "autoBookmark": None,
        "subjectKey": subject_key,
        "timeSpentSec": time_spent_sec,
        "charsRead": chars_read if chars_read is not None else len(content),
        "added": now_ms() - 3 * DAY_MS,
    }


def make_review_history(days: int = 9, *, base_total: int = 8,
                        correct_pct: float = 0.85, include_today: bool = True,
                        today_total: int = 12, today_correct: int = 10) -> list:
    """reviewHistory entries {date,total,correct,newSeen} — UTC dates."""
    hist = []
    start = 0 if include_today else 1
    for back in range(start, start + days):
        if back == 0:
            total, correct = today_total, today_correct
        else:
            total = base_total + (back * 3) % 7          # deterministic wiggle
            correct = max(1, round(total * correct_pct))
        hist.append({"date": utc_day(-back), "total": total,
                     "correct": correct, "newSeen": min(3, total)})
    return hist


# ── top-level blobs ──────────────────────────────────────────────────────────

def make_mf_state(decks: list | None = None, folders: list | None = None,
                  sources: list | None = None, library_folders: list | None = None,
                  *, streak: int = 0, last_streak_date: str | None = None,
                  review_history: list | None = None, achievements: list | None = None,
                  session_log: list | None = None, settings: dict | None = None,
                  tour_done: bool = True) -> dict:
    s = {"onboarding": {"completed": tour_done, "step": 0, "version": 1}}
    s.update(settings or {})
    return {
        "decks": decks or [],
        "folders": folders or [],
        "sources": sources or [],
        "libraryFolders": library_folders or [],
        "reviewHistory": review_history or [],
        "achievements": achievements or [],
        "sessionLog": session_log or [],
        "streak": streak,
        "lastStreakDate": last_streak_date,
        "settings": s,
    }


def make_tracker(*, total_xp: int = 0, subject_xp: dict | None = None,
                 theme: str = "dark", history: list | None = None,
                 streak_current: int = 0, streak_longest: int = 0) -> dict:
    """SCIMATracker blob. Partial is fine — sanitizeState() fills defaults
    (xpCoef=1000, capMult=5, every built-in subject at 0 XP, ...)."""
    subjects = {}
    for key, xp in (subject_xp or {}).items():
        subjects[key] = {"predictedGrade": None, "color": "#AAAAAA",
                         "totalXP": xp, "totalMarks": 0}
    return {
        "version": 1,
        "totalXP": total_xp,
        "subjects": subjects,
        "monthlyMarks": {},
        "history": history or [],
        "streak": {"current": streak_current, "longest": streak_longest,
                   "lastDate": utc_day() if streak_current else None},
        "config": {"xpCoef": 1000, "capMult": 5, "theme": theme,
                   "customSubjects": {"misc": dict(MISC_SUBJECT)}},
    }


# ── presets ──────────────────────────────────────────────────────────────────

def preset_empty() -> dict:
    """Pristine account, tour already completed: Home shows the
    'Welcome to SCIMA Learning' empty state. 5 due cards: none."""
    return {
        "mf_state": make_mf_state(),
        "SCIMATracker": make_tracker(),
    }


def preset_demo() -> dict:
    """A lived-in account:

    Decks   'Spanish Basics'   4 new cards, ALL due now, in folder 'Languages'
            'Biology - Cells'  3 cards: 1 due (review), 2 future → subject biology
    Folders 'Languages'
    Sources 'Cells - A Short Introduction.txt' (plain text, shows in Library)
    Stats   streak 5 · 9 days of reviewHistory · today: 12 reviews (10 correct)
            tracker totalXP 1240 (maths 500, english 740)

    Due totals: 5 due / 7 cards overall — Home 'Due Today' = 5,
    study picker 'All Decks' = '7 total cards · 5 due'.
    """
    lang_folder = make_folder("Languages", folder_id="f_seed_lang")
    spanish = make_deck("Spanish Basics", [
        make_card("Hello", "Hola", card_id="c_seed_es1", hint="The most common greeting"),
        make_card("Goodbye", "Adiós", card_id="c_seed_es2"),
        make_card("Thank you", "Gracias", card_id="c_seed_es3", tags=["politeness"]),
        make_card("Water", "El agua", card_id="c_seed_es4"),
    ], deck_id="d_seed_spanish", emoji="🇪🇸", folder_id=lang_folder["id"])
    biology = make_deck("Biology - Cells", [
        make_card("Which organelle performs photosynthesis?", "Chloroplast",
                  card_id="c_seed_bio1", state="review", interval=5, reps=3,
                  ease=2.6, due_offset_ms=-3_600_000),
        make_card("Which organelle is the powerhouse of the cell?", "Mitochondria",
                  card_id="c_seed_bio2", state="review", interval=2, reps=1,
                  due_offset_ms=2 * DAY_MS),
        make_card("What is the basic unit of life?", "The cell",
                  card_id="c_seed_bio3", due_offset_ms=5 * DAY_MS),
    ], deck_id="d_seed_bio", emoji="🧬", subject="biology")
    source = make_source("Cells - A Short Introduction.txt",
                         "Chapter 1\nThe cell is the basic unit of life.\n"
                         "Mitochondria release energy from glucose.\n",
                         source_id="src_seed_cells", subject_key="biology",
                         time_spent_sec=240)
    return {
        "mf_state": make_mf_state(
            decks=[spanish, biology],
            folders=[lang_folder],
            sources=[source],
            streak=5,
            last_streak_date=utc_day(),
            review_history=make_review_history(),
        ),
        "SCIMATracker": make_tracker(total_xp=1240,
                                     subject_xp={"mathematics": 500,
                                                 "englishLanguage": 740}),
    }


def preset_first_run() -> dict:
    """NO seed at all is the true first run, but this blob gives you one
    with the tour still PENDING (onboarding not completed) — the guided
    tutorial fires ~300ms after load."""
    return {"mf_state": make_mf_state(tour_done=False),
            "SCIMATracker": make_tracker()}


PRESETS = {
    "empty": preset_empty,
    "demo": preset_demo,
    "first_run": preset_first_run,
}


def resolve_seed(spec) -> dict:
    """Normalize any of the accepted seed forms into {'mf_state','SCIMATracker'}:
      None                    → preset 'empty'
      'preset:demo' / 'demo'  → named preset
      'path.json'              → file: {"mf_state":...} or a raw mf_state
      dict with mf_state/SCIMATracker keys → used as-is
      dict that looks like mf_state (has 'decks'/'settings'/...) → wrapped
    """
    if spec is None:
        return preset_empty()
    if isinstance(spec, str):
        name = spec[len("preset:"):] if spec.startswith("preset:") else spec
        if name in PRESETS:
            return PRESETS[name]()
        with open(name, encoding="utf-8") as f:
            spec = json.load(f)
    if isinstance(spec, dict):
        if "mf_state" in spec or "SCIMATracker" in spec:
            return {"mf_state": spec.get("mf_state"),
                    "SCIMATracker": spec.get("SCIMATracker")}
        if any(k in spec for k in ("decks", "settings", "streak", "reviewHistory")):
            return {"mf_state": spec, "SCIMATracker": None}
    raise ValueError(f"unrecognized seed spec: {spec!r}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Emit SCIMA test seed blobs.")
    ap.add_argument("--preset", choices=sorted(PRESETS), default="demo")
    ap.add_argument("--out", help="write JSON here instead of stdout")
    ap.add_argument("--print", dest="do_print", action="store_true",
                    help="also print to stdout when --out is used")
    ap.add_argument("--list", action="store_true", help="list presets and exit")
    args = ap.parse_args(argv)

    if args.list:
        for name, fn in PRESETS.items():
            print(f"{name:12s} {(fn.__doc__ or '').strip().splitlines()[0]}")
        return 0

    blob = PRESETS[args.preset]()
    text = json.dumps(blob, indent=2, ensure_ascii=False)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        print(f"wrote {args.out}", file=sys.stderr)
    if args.do_print or not args.out:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
