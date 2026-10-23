"""Navigation + common UI flows, page-object style.

Import in tests as:  from helpers import pages

Selector cheat-sheet (stable ids the app itself guarantees):
  #logo-icon      nav drawer toggle (the floating ≡ mark)
  #sidebar #nav   drawer + nav buttons: .nav-btn[data-view="<id>"]
  #view-<id>      one container per view (home decks study library
                  analytics quests community settings about)
  #page-tabs      in-page tab bar (.tab-btn[data-view]) on merged pages
  #modal-backdrop modal container (has class .hidden while closed)
  #modal-box #modal-title #modal-close
  #cmd-backdrop   command palette (Ctrl/Cmd+K), input: #cmd-input
  #tutorial-overlay  guided tour (first run / Replay tutorial)
"""
from __future__ import annotations

import re

from playwright.sync_api import Page, expect

# nav view id → route (path + hash) on the static/prod site
ROUTES = {
    "home": "/",
    "decks": "/decks/",
    "study": "/study/",
    "library": "/library/",
    "analytics": "/analytics/",
    "quests": "/analytics/#quests",
    "community": "/#community",
    "settings": "/settings/",
    "about": "/about/",
}
# legacy URLs → where the meta-refresh stubs send you
REDIRECT_STUBS = {
    "/capture/": "/decks/",
    "/insights/": "/analytics/",
    "/tracker/": "/#home",
}


def origin_of(page_or_url) -> str:
    url = page_or_url if isinstance(page_or_url, str) else page_or_url.url
    m = re.match(r"(https?://[^/]+)", url)
    return m.group(1) if m else ""


def expect_at(page: Page, view_id: str, timeout: float = 10000) -> None:
    """Assert the browser is at the route for `view_id`.

    The site standardizes URLs with a view hash (/decks/#decks, /#home,
    /analytics/#quests), so plain-path equality is wrong — allow it.
    """
    path, _, frag = ROUTES[view_id].partition("#")
    origin = origin_of(page)
    if frag:
        pat = re.escape(origin + path) + r"#" + re.escape(frag) + r"$"
    else:
        pat = re.escape(origin + path) + r"(?:#\w*)?$"
    expect(page).to_have_url(re.compile(pat), timeout=timeout)


def app_ready(page: Page, timeout: float = 15000) -> None:
    """Wait until the dashboard JS has booted (state defined + nav rendered).

    Safe to call after any navigation: wait_for_function re-runs on the new
    document when a click triggers a cross-page jump.
    """
    page.wait_for_function(
        "() => typeof state !== 'undefined'"
        " && document.querySelector('#nav .nav-btn') !== null",
        timeout=timeout,
    )


def goto_app(page: Page, base_url: str, route: str = "/", ready: bool = True) -> None:
    page.goto(base_url.rstrip("/") + route, wait_until="load")
    if ready:
        app_ready(page)


def open_nav(page: Page) -> None:
    """Open the nav drawer if it isn't already open."""
    if page.locator("#nav .nav-btn").first.is_visible():
        return
    page.click("#logo-icon")
    page.locator("#nav .nav-btn").first.wait_for(state="visible", timeout=5000)


def close_nav(page: Page) -> None:
    if page.locator("#nav .nav-btn").first.is_visible():
        page.keyboard.press("Escape")


def nav_to(page: Page, view_id: str) -> None:
    """Click a sidebar nav tab; works across pages (full navigation) and
    in-page (hash) view switches. Ends on the target view, visible."""
    open_nav(page)
    page.click(f"#nav .nav-btn[data-view='{view_id}']")
    page.wait_for_function(
        f"() => typeof state !== 'undefined' && state.view === '{view_id}'"
        " && document.querySelector('#nav .nav-btn') !== null",
        timeout=15000,
    )
    expect(page.locator(f"#view-{view_id}")).to_be_visible(timeout=10000)


def current_view(page: Page) -> str:
    return page.evaluate("() => state.view")


def modal(page: Page):
    """Locator for the open modal box (fails visibility checks when closed)."""
    return page.locator("#modal-backdrop:not(.hidden) #modal-box")


def expect_modal(page: Page, title_contains: str | None = None, timeout: float = 5000):
    expect(modal(page)).to_be_visible(timeout=timeout)
    if title_contains:
        expect(page.locator("#modal-title")).to_contain_text(title_contains, timeout=timeout)


def close_modal(page: Page) -> None:
    if modal(page).is_visible():
        page.click("#modal-close")
        page.locator("#modal-backdrop").evaluate(
            "el => el.classList.contains('hidden')")


def open_command_palette(page: Page) -> None:
    page.keyboard.press("Control+k")
    expect(page.locator("#cmd-backdrop:not(.hidden)")).to_be_visible(timeout=3000)


# ── study flows ─────────────────────────────────────────────────────────────

STUDY_MODES = ["SRS Review", "Cram Mode", "Written Quiz",
               "Fill in the Gaps", "Weakness", "Multiple Choice"]


def start_study_mode(page: Page, mode_label: str = "SRS Review") -> None:
    """From the study picker, press Start on one of the six mode cards."""
    card = page.locator("#view-study .card", has_text=mode_label).first
    card.get_by_role("button", name="Start", exact=True).click()


def study_session_active(page: Page) -> bool:
    """`studySession` is a top-level `let` — a lexical global, NOT on window."""
    return page.evaluate(
        "() => typeof studySession !== 'undefined' && !!studySession && studySession.active")


def reveal(page: Page) -> None:
    """Flip the current flashcard (Reveal → button)."""
    page.get_by_role("button", name=re.compile(r"Reveal")).click()


def rating_buttons(page: Page):
    return page.locator(".rating-btn")


def rate(page: Page, label: str) -> None:
    """Rate the revealed card: Again / Hard / Good / Easy."""
    page.locator(".rating-btn", has_text=label).first.click()


def exit_session(page: Page) -> None:
    page.get_by_role("button", name="Exit").click()


def session_progress(page: Page) -> tuple[int, int]:
    """Parse the "3 / 12" counter shown during a session."""
    txt = page.locator("#view-study span", has_text=re.compile(r"^\d+ / \d+$")).first.inner_text()
    a, b = txt.split("/")
    return int(a), int(b)


def dismiss_tour(page: Page, timeout: float = 8000) -> None:
    """Skip the guided tour if/when it appears (unseeded first-run pages)."""
    skip = page.get_by_role("button", name="Skip tutorial")
    skip.wait_for(state="visible", timeout=timeout)
    skip.click()
    page.locator("#tutorial-overlay").wait_for(state="detached", timeout=timeout)
