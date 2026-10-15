"""Content-integrity checkers — JS probes run inside the page.

Each function returns a list of human-readable violations ([] = clean), so
tests can `assert check(page) == []` and failures name the offender. They
are deliberately conservative: intentional patterns (off-canvas drawer,
inner scrollers, fixed toasts, ellipsis truncation) are exempt.
"""
from __future__ import annotations

BUG_MARKERS = ("undefined", "NaN", "[object Object]")

_JS_OVERFLOW = """(tol) => {
  const doc = document.documentElement;
  const docW = doc.clientWidth;
  const els = [];
  const scrollableAncestor = el => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return p;
    }
    return null;
  };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.visibility === 'hidden') continue;
    if (el.closest('.hidden') || el.closest('#sidebar[aria-hidden="true"]')) continue;
    if (scrollableAncestor(el)) continue;              // lives in an inner scroller
    if (r.right > docW + tol) {
      els.push(el.tagName.toLowerCase() +
               (el.className ? '.' + String(el.className).trim().split(/\\s+/)[0] : '') +
               ' right=' + Math.round(r.right) + ' > ' + docW);
    }
  }
  return { docScrolls: doc.scrollWidth > docW + tol, els: els.slice(0, 10) };
}"""

_JS_CLIPPED = """(tol) => {
  const out = [];
  for (const el of document.querySelectorAll('#main *')) {
    if (el.children.length || !el.textContent.trim()) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis') continue;       // intentional truncation
    if (cs.overflowX !== 'visible') continue;           // scroller / clipped by design
    if (el.closest('.hidden') || el.closest('#sidebar[aria-hidden="true"]')) continue;
    if (el.scrollWidth > el.clientWidth + tol) {
      out.push(el.tagName.toLowerCase() + ':' + el.textContent.trim().slice(0, 40) +
               ' (' + el.scrollWidth + '>' + el.clientWidth + ')');
    }
  }
  return out.slice(0, 10);
}"""

_JS_BROKEN_IMAGES = """() => [...document.images]
  .filter(i => i.complete && i.naturalWidth === 0)
  .map(i => (i.src || '').slice(0, 90))"""

_JS_DUP_IDS = """() => {
  const counts = {};
  for (const el of document.querySelectorAll('[id]')) counts[el.id] = (counts[el.id] || 0) + 1;
  return Object.entries(counts).filter(([, n]) => n > 1).map(([id, n]) => id + ' x' + n);
}"""

_JS_UNNAMED_BUTTONS = """([exempt]) => [...document.querySelectorAll('button')]
  .filter(b => {
    const r = b.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (b.closest('.hidden') || b.closest('#sidebar[aria-hidden="true"]')) return false;
    if (exempt && b.matches(exempt)) return false;
    return !((b.textContent || '').trim() || b.getAttribute('aria-label') || b.getAttribute('title'));
  })
  .map(b => b.className || b.id || 'button')"""

_JS_BUG_MARKERS = """(markers) => {
  const t = document.body.innerText || '';
  return markers.filter(m => t.includes(m));
}"""


def horizontal_overflow(page, tolerance: int = 1) -> list[str]:
    """Elements sticking out past the right viewport edge + whether the
    document itself scrolls sideways."""
    res = page.evaluate(_JS_OVERFLOW, tolerance)
    out = []
    if res["docScrolls"]:
        out.append("document scrolls horizontally")
    out.extend(res["els"])
    return out


def clipped_text(page, tolerance: int = 1) -> list[str]:
    """Visible leaf text nodes whose content is wider than their box
    (i.e. silently cut off, not ellipsized or scrollable)."""
    return page.evaluate(_JS_CLIPPED, tolerance)


def broken_images(page) -> list[str]:
    return page.evaluate(_JS_BROKEN_IMAGES)


def duplicate_ids(page) -> list[str]:
    return page.evaluate(_JS_DUP_IDS)


def unnamed_visible_buttons(page, exempt: str | None = None) -> list[str]:
    """Visible buttons with no accessible name (text/aria-label/title) —
    invisible to screen readers and to get_by_role().

    The app's toggle switches used to be the one violation (bare
    `button.toggle` knobs); makeToggle() in dashboard-settings.js now gives
    them role="switch" + aria-checked + aria-label, so nothing is exempted
    by default. `exempt` remains for scoping future findings.
    """
    return page.evaluate(_JS_UNNAMED_BUTTONS, [exempt])


def bug_markers(page) -> list[str]:
    """Raw JS leakage in rendered text: undefined / NaN / [object Object]."""
    return page.evaluate(_JS_BUG_MARKERS, list(BUG_MARKERS))


def all_content_checks(page, tolerance: int = 1) -> dict:
    """Run every checker at once — handy from render.py's `eval` step or a
    debugging session. Returns {name: [violations]}."""
    return {
        "horizontal_overflow": horizontal_overflow(page, tolerance),
        "clipped_text": clipped_text(page, tolerance),
        "broken_images": broken_images(page),
        "duplicate_ids": duplicate_ids(page),
        "unnamed_buttons": unnamed_visible_buttons(page),
        "bug_markers": bug_markers(page),
    }
