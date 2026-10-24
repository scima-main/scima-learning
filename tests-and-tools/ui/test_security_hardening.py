"""Security-hardening regression guards (review findings S1/S2/S3).

These tests pin the three client-side hardening measures in place:

  S1  every pdf.js getDocument() call site disables eval
      (CVE-2024-4367 workaround — the vendored 3.11 legacy bundle has no
      upstream patch, so isEvalSupported:false is the only mitigation);
  S2  the book-HTML sanitizer (scSanitizeBookDom) actually disarms inline
      event handlers, script-bearing embeds and javascript:/vbscript:/
      data:text/html URLs while keeping layout attrs and data: images;
  S3  no shipped page or app template reintroduces inline event handlers,
      which the backend's hashed script-src CSP would (correctly) block.

The sanitizer is unit-tested live in the browser because it runs against
DOMParser output; the rest are source-level guards so a refactor cannot
silently drop a mitigation.
"""
import re

import pytest

from helpers import pages
from helpers.server import SITE_DIR

pytestmark = [pytest.mark.library]


def _strip_js_comments(text: str) -> str:
    """Remove /* … */ blocks and // … line comments (a `//` preceded by `:`
    is a URL scheme, not a comment) so source guards scan code only."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"(?<!:)//[^\n]*", "", text)


# ── S2: sanitizer behaviour, live in the page ──────────────────────────

SANITIZE_PROBE = """() => {
  const html = [
    '<div id="keep" class="c" style="color:red">hi</div>',
    '<img id="img" src="x" onerror="window.__pwned=1">',
    '<svg id="svg" onload="window.__pwned=2"></svg>',
    '<iframe id="frm" srcdoc="<script>window.__pwned=3</script>"></iframe>',
    '<object id="obj" data="javascript:alert(1)"></object>',
    '<embed id="emb" src="javascript:alert(2)">',
    '<a id="js" href="JaVaScRiPt:alert(3)">click</a>',
    '<a id="vb" href="vbscript:msgbox(1)">click</a>',
    '<a id="ok" href="chapter2.xhtml#frag">ok</a>',
    '<img id="dataimg" src="data:image/png;base64,iVBORw0KGgo=">',
    '<img id="dhtml" src="DaTa:text/html;base64,PHNjcmlwdD4=">',
    '<form id="frm2" action="https://evil.example"><input id="in" name="x"></form>',
    '<p id="clk" onclick="window.__pwned=4">x</p>',
    '<script id="scr">window.__pwned=5</script>',
  ].join('');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  scSanitizeBookDom(doc);
  const g = (id) => doc.getElementById(id);
  return {
    handlerImg:   g('img') !== null && !g('img').hasAttribute('onerror'),
    handlerSvg:   g('svg') !== null && !g('svg').hasAttribute('onload'),
    handlerP:     g('clk') !== null && !g('clk').hasAttribute('onclick'),
    iframeGone:   g('frm') === null,
    objectGone:   g('obj') === null,
    embedGone:    g('emb') === null,
    scriptGone:   g('scr') === null,
    formGone:     g('frm2') === null && g('in') === null,
    jsHrefGone:   g('js') !== null && !g('js').hasAttribute('href'),
    vbHrefGone:   g('vb') !== null && !g('vb').hasAttribute('href'),
    dataHtmlGone: g('dhtml') !== null && !g('dhtml').hasAttribute('src'),
    okHrefKept:   g('ok') !== null && g('ok').getAttribute('href') === 'chapter2.xhtml#frag',
    dataImgKept:  g('dataimg') !== null &&
                  (g('dataimg').getAttribute('src') || '').startsWith('data:image/'),
    layoutKept:   g('keep') !== null && g('keep').getAttribute('class') === 'c' &&
                  g('keep').getAttribute('style') === 'color:red',
    nothingExecuted: typeof window.__pwned === 'undefined',
  };
}"""


def test_book_sanitizer_disarms_untrusted_markup(page, base_url, seeded):
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/library/")
    result = page.evaluate(SANITIZE_PROBE)
    offenders = [k for k, ok in result.items() if not ok]
    assert not offenders, f"sanitizer let through: {offenders}"


def test_book_reader_path_calls_sanitizer():
    src = (SITE_DIR / "app" / "dashboard-library.js").read_text(encoding="utf-8")
    # buildPartDiv is the single innerHTML sink for third-party book markup
    body = src.split("function buildPartDiv", 1)[1]
    assert "scSanitizeBookDom(parsed)" in body.split("partDiv.innerHTML", 1)[0], \
        "buildPartDiv must sanitize the parsed book DOM before innerHTML"


# ── S1: pdf.js eval stays disabled at every call site ──────────────────

def test_every_pdfjs_getdocument_disables_eval():
    offenders = []
    for js in (SITE_DIR / "app").glob("*.js"):
        src = _strip_js_comments(js.read_text(encoding="utf-8"))
        for m in re.finditer(r"getDocument\(\s*\{([^}]*)\}", src):
            opts = m.group(1).replace(" ", "")
            if "isEvalSupported:false" not in opts:
                offenders.append(f"{js.name}: getDocument({{{m.group(1)}}})")
    assert not offenders, (
        "pdf.js eval must stay disabled (CVE-2024-4367; vendored 3.11 legacy "
        f"bundle is unpatched): {offenders}")


# ── S3: no inline event handlers anywhere the CSP must allow ───────────

def test_shipped_pages_have_no_inline_event_handlers():
    bad = []
    for html in list(SITE_DIR.rglob("*.html")):
        text = html.read_text(encoding="utf-8", errors="ignore")
        for attr in ("onclick=", "onerror=", "onload=", "onmouseover=",
                     "onfocus=", "onsubmit="):
            if re.search(attr, text, re.I):
                bad.append(f"{html.relative_to(SITE_DIR)}:{attr}")
    assert not bad, (
        "inline event handlers are blocked by the hashed script-src CSP: "
        f"{bad}")


def test_app_templates_have_no_inline_event_handlers():
    """innerHTML templates in app code must not carry on* attributes either:
    injected into the app document they would silently do nothing under the
    CSP (or worse, be a dormant XSS if the policy ever relaxes)."""
    bad = []
    for js in list((SITE_DIR / "app").glob("*.js")) + list((SITE_DIR / "shared").glob("*.js")):
        text = _strip_js_comments(js.read_text(encoding="utf-8"))
        for m in re.finditer(r"\son[a-z]+\s*=\s*[\\\"']", text, re.I):
            line = text[:m.start()].count("\n") + 1
            bad.append(f"{js.name}:{line}:{m.group(0).strip()}")
    assert not bad, f"inline event handler attributes in templates: {bad}"


def test_print_sheet_button_uses_attached_listener():
    src = (SITE_DIR / "app" / "dashboard-decks.js").read_text(encoding="utf-8")
    assert 'id="sc-print-btn"' in src
    assert "printBtn.onclick" in src or "print-btn" in src
    assert 'onclick="window.print()"' not in src
