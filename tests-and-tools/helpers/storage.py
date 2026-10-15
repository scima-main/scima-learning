"""Seeding + reading the site's localStorage blobs.

The frontend persists everything in two localStorage keys:

  mf_state      decks, folders, sources, libraryFolders, reviewHistory,
                achievements, sessionLog, streak, lastStreakDate, settings
                (settings are MERGED onto the app's defaults at load, so a
                seed only needs the keys it wants to override)
  SCIMATracker  XP / subjects / grade tracker (sanitized by shared.js's
                sanitizeState — unknown fields dropped, missing defaulted,
                so partial seeds are safe)

Seeding uses Playwright's add_init_script, which runs BEFORE any page
script on every navigation — so the app boots straight into the seeded
state and the first-run guided tour never fires (seeds set
settings.onboarding.completed=true; see seed.py).
"""
from __future__ import annotations

import json
import uuid

MF_KEY = "mf_state"
TRACKER_KEY = "SCIMATracker"
_SENTINEL_KEY = "__scima_seed_id"


def build_seed_js(mf_state=None, tracker=None, extra: dict | None = None,
                  clear: bool = False, seed_id: str | None = None) -> str:
    """JS snippet (for add_init_script) that installs the seed blobs.

    Sentinel-guarded: the seed is applied on the FIRST navigation of a tab
    only. Later navigations (in-page jumps, reloads) keep whatever the app
    itself persisted — so tests can assert that edits survive a reload.
    Every call embeds a fresh seed id, so seeding twice in one context
    (e.g. render.py's `seed` step) takes effect on the next navigation.
    """
    seed_id = seed_id or uuid.uuid4().hex
    items: dict = {}
    if clear:
        items[MF_KEY] = None
        items[TRACKER_KEY] = None
    if mf_state is not None:
        items[MF_KEY] = mf_state
    if tracker is not None:
        items[TRACKER_KEY] = tracker
    for k, v in (extra or {}).items():
        items[k] = v
    return f"""
(() => {{
  try {{
    const KEY = {json.dumps(_SENTINEL_KEY)};
    const ID = {json.dumps(seed_id)};
    if (sessionStorage.getItem(KEY) === ID) return;  // this seed already applied
    sessionStorage.setItem(KEY, ID);
    const items = {json.dumps(items)};
    for (const [k, v] of Object.entries(items)) {{
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }}
  }} catch (e) {{ /* about:blank etc. — no storage, nothing to seed */ }}
}})();
"""


def seed_context(context, mf_state=None, tracker=None, extra=None, clear=False):
    """Seed every page created/navigated in this BrowserContext."""
    context.add_init_script(build_seed_js(mf_state, tracker, extra, clear))


def seed_page(page, mf_state=None, tracker=None, extra=None, clear=False):
    """Seed every navigation of this Page (use before the first goto)."""
    page.add_init_script(build_seed_js(mf_state, tracker, extra, clear))

def clear_storage(page) -> None:
    page.evaluate("() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} }")


def read_local(page, key: str):
    """Read + JSON-parse one localStorage key (None when absent/unparsable)."""
    raw = page.evaluate(f"() => localStorage.getItem({json.dumps(key)})")
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def read_mf_state(page):
    return read_local(page, MF_KEY)


def read_tracker(page):
    return read_local(page, TRACKER_KEY)


def read_app_state(page) -> dict:
    """Snapshot of the LIVE in-memory `state` global (post-sanitization).

    JSON-safe projection — enough for assertions without dragging blobs
    (source content, images) across the wire.
    """
    return page.evaluate("""() => ({
        view: state.view,
        page: (window.SCIMA_PAGE && window.SCIMA_PAGE.id) || null,
        streak: state.streak,
        decks: state.decks.map(d => ({
            id: d.id, name: d.name, emoji: d.emoji, subject: d.subject,
            folderId: d.folderId, pinned: !!d.pinned,
            cards: d.cards.map(c => ({
                id: c.id, front: c.front, back: c.back, type: c.type,
                state: c.state, due: c.due, suspended: !!c.suspended,
                ease: c.ease, interval: c.interval, reps: c.reps,
                lapses: c.lapses, leech: !!c.leech, created: c.created,
                hint: c.hint ?? null, tags: c.tags || [],
                lastRated: c.lastRated ?? null,
            })),
        })),
        folders: state.folders.map(f => ({ id: f.id, name: f.name,
            subjectKey: f.subjectKey || null, parentId: f.parentId || null })),
        sources: state.sources.map(s => ({ id: s.id, name: s.name })),
        reviewHistoryLen: (state.reviewHistory || []).length,
        settings: {
            dailyGoal: state.settings.dailyGoal,
            algorithm: state.settings.algorithm,
            highContrast: !!state.settings.highContrast,
            onboardingCompleted: !!(state.settings.onboarding || {}).completed,
            themeBg: (state.settings.theme || {}).bg || null,
        },
        trackerXP: (state.trackerState && state.trackerState.totalXP) || 0,
    })""")
