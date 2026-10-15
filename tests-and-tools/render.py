#!/usr/bin/env python3
"""render.py — drive the SCIMA site through an arbitrary sequence of
interactions and output a photo (screenshot) of the result.

This is the "eyes" tool for humans and LLM agents: describe what to do in a
JSON scenario (or quick-mode flags), and render.py executes it in a real
Chromium via Playwright, writes a PNG, and prints a machine-readable trace
of every step (plus console output and any JS page errors).

USAGE
  python tests-and-tools/render.py tests-and-tools/scenarios/02-home-demo.json
  python tests-and-tools/render.py tests-and-tools/scenarios/03-study-session.json --out shot.png
  python tests-and-tools/render.py --goto /study/ --seed demo --out study.png \
      --steps-json '[{"pause": 800}, {"click": "#tutorial-target-study-start"}, {"pause": 500}]'
  python tests-and-tools/render.py --list-steps        # full step reference
  python tests-and-tools/render.py --serve-only        # just start a server and print its URL

No base URL given → a throwaway static server for minified/home is started
automatically (set SCIMA_BASE_URL or --base-url to use a running one, e.g.
`python tests-and-tools/serve.py` or the real backend).

SCENARIO FILE
{
  "name":         "my-scenario",              // used for default output name
  "description":  "what this shows",
  "base_url":     "http://127.0.0.1:8013",    // optional
  "browser":      "chromium",                 // chromium | firefox | webkit
  "viewport":     {"width": 1280, "height": 800},
  "device":       "iPhone 13",                // Playwright device descriptor
  "color_scheme": "dark",                     // prefers-color-scheme emulation
  "locale":       "en-GB", "timezone_id": "Europe/London",
  "seed":         "preset:demo",              // see SEED below
  "block_external": true,                     // abort non-localhost requests (default)
  "video":        false,                      // also save a .webm next to the photo
  "output":       "screenshots/my.png",       // final photo (relative → tests-and-tools/)
  "full_page":    false,                      // final photo captures whole page
  "steps": [ ... ]                            // any sequence, see --list-steps
}

SEED — installed into localStorage before any page script runs (so the app
boots straight into it; the first-run tour is suppressed by default):
  "seed": "preset:demo" | "preset:empty" | "preset:first_run"
  "seed": "scenarios/seeds/custom.json"   ({"mf_state":..,"SCIMATracker":..})
  "seed": {"mf_state": {...}, "SCIMATracker": {...}}   (inline)
  "seed": {"decks": [...], ...}                        (inline mf_state)
Build custom seeds with:  python tests-and-tools/seed.py  (see its --help / docstring).

STEPS — each step is an object with exactly ONE action key.
Run `python tests-and-tools/render.py --list-steps` for the full reference.
Selectors are Playwright selectors: CSS, text=..., role locators via
{"selector": "..."}, xpath=..., plus #id shortcuts.

OUTPUT
  <output>.png            the photo (default: tests-and-tools/screenshots/<name>.png)
  <output>.trace.json     step-by-step results, console log, page errors
  <output>-FAIL.png       captured automatically when a step fails
Exit code 0 on success, 1 on any step/assert failure.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import shutil
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS_DIR))

import seed as seedlib  # noqa: E402
from helpers import pages as pages_helpers  # noqa: E402
from helpers import storage  # noqa: E402
from helpers.server import start_static_server, stop_static_server  # noqa: E402

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    raise SystemExit(
        "Playwright is not installed. Run:\n"
        "  pip install -r tests-and-tools/requirements.txt\n"
        "  python -m playwright install chromium"
    )

SCREENSHOTS_DIR = TESTS_DIR / "screenshots"

STEP_REFERENCE = """
SCENARIO STEP REFERENCE  (one action key per step object)

Navigation & timing
  goto        "/decks/" or full URL            navigate (relative → base_url)
  reload      true                             reload current page
  back        true                             browser back
  pause       1200                             sleep (ms). also {"seconds": 1.2}
  wait_for    {"selector": ".flashcard",       wait for selector state
               "state": "visible|hidden|attached|detached", "timeout": 8000}
              {"text": "Server online"}        wait for text anywhere
              {"url": "/study/"}               wait until URL contains/globs
              {"js": "() => state.view==='study'"}   wait for expression truthy
              {"load_state": "networkidle"}    wait for load state

Interaction
  click       "#id" | {"selector":..., "button":"right", "click_count":2,
                        "force":true, "timeout":5000, "modifiers":["Shift"]}
  dblclick    "#id" | {"selector":...}
  hover       "#id" | {"selector":...}
  focus       "#id" | {"selector":...}
  fill        {"selector": "#x", "text": "hi"}          set value instantly
  type        {"selector": "#x", "text": "hi",          keystroke by keystroke
               "delay": 40, "submit": true}             (submit → Enter after)
  press       "Space" | {"key": "Enter", "selector": "#x"}
  check       "#id" | {"selector":...}      (also: uncheck)
  select      {"selector": "select#x", "value": "sm2"}  (or "label"/"index")
  scroll      {"y": 400} | {"to": "bottom"} | {"selector": "#main", "to": "bottom"}

State & seeding
  seed        {"mf_state": {...}, "SCIMATracker": {...}} | "preset:demo"
              re-seed localStorage (auto-reloads if a page is open)
  clear_storage  {"reload": true}           wipe local+sessionStorage
  eval        "state.decks.length"          evaluate JS, result → trace
  mock_route  {"url": "/api/v1/health", "json": {"status":"ok"},
               "status": 200, "times": 3}   fulfill matching requests
              url: path substring or *glob; json|body; content_type
  set_theme   "light"                       apply a THEME_PRESETS preset
  set_viewport {"width": 390, "height": 844}

Output & assertions
  screenshot  "mid.png" | {"path":..., "full_page":true, "selector":"#main"}
              intermediate photo (relative → tests-and-tools/screenshots/)
  assert      {"selector": "#view-study", "visible": true,
               "text_contains": "Study Mode", "count": 6,
               "url_contains": "/study/", "title_contains": "SCIMA",
               "value": "35", "js": "state.view", "equals": "study"}
              any subset; every listed check must pass
  dump        {"dom": "#main"} | {"text": ".deck-name"} | {"console": true}
              capture HTML/text/console into the trace
""".strip()


class RenderError(Exception):
    pass


# ── helpers ──────────────────────────────────────────────────────────────────

def _as_spec(step_value):
    """Normalize 'selector-string' vs {selector:..., ...opts} step args."""
    if isinstance(step_value, str):
        return {"selector": step_value}
    if isinstance(step_value, dict) and "selector" in step_value:
        return dict(step_value)
    raise RenderError(f"expected a selector string or {{selector:...}} object, got {step_value!r}")


def _timeout(spec, default):
    return float(spec.get("timeout", default))


def _resolve_url(base_url: str, target: str) -> str:
    if re.match(r"^https?://", target):
        return target
    return base_url.rstrip("/") + "/" + target.lstrip("/")


def _resolve_out_path(path_str: str, default_name: str) -> Path:
    p = Path(path_str) if path_str else Path(default_name)
    if not p.is_absolute():
        p = TESTS_DIR / p if str(p).startswith(("scenarios/", "screenshots/")) else SCREENSHOTS_DIR / p
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _shorten(value, limit=400):
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return s if len(s) <= limit else s[:limit] + f" …[{len(s)} chars]"


# ── the engine ───────────────────────────────────────────────────────────────

class Renderer:
    def __init__(self, scenario: dict, args):
        self.scenario = scenario
        self.args = args
        self.name = scenario.get("name") or args.scenario_name or "scenario"
        self.base_url = (args.base_url or scenario.get("base_url")
                         or os.environ.get("SCIMA_BASE_URL") or "").rstrip("/")
        self.own_server = None
        self.default_timeout = args.timeout
        self.console: list = []
        self.page_errors: list = []
        self.trace_steps: list = []
        self.dumps: list = []
        self.mock_counters: dict = {}
        self.video_path: Path | None = None
        SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
        out_override = args.out or scenario.get("output")
        self.output = _resolve_out_path(out_override, f"{self.name}.png")
        self.trace_path = self.output.with_suffix("").with_name(self.output.stem + ".trace.json")

    # -- lifecycle -----------------------------------------------------------

    def run(self) -> int:
        if not self.base_url:
            self.base_url, self.own_server = start_static_server()
            print(f"ℹ started throwaway static server at {self.base_url}")

        started = time.time()
        with sync_playwright() as pw:
            browser_name = self.args.browser or self.scenario.get("browser", "chromium")
            browser_type = getattr(pw, browser_name, None)
            if browser_type is None:
                raise RenderError(f"unknown browser {browser_name!r}")
            browser = browser_type.launch(headless=not self.args.headed,
                                          slow_mo=self.args.slowmo or 0)
            context = self._make_context(browser, pw)
            page = context.new_page()
            self._attach_listeners(page, context)

            exit_code = 0
            try:
                self._apply_initial_seed(context)
                steps = self.scenario.get("steps") or []
                for i, step in enumerate(steps, 1):
                    self._run_step(i, step, page, context)
                self._final_screenshot(page)
            except Exception as e:  # noqa: BLE001
                exit_code = 1
                self._capture_failure(page, e)
            finally:
                if self.scenario.get("video") or self.args.video:
                    try:
                        vid = page.video
                        context.close()
                        if vid:
                            src = Path(vid.path())
                            if src.exists():
                                self.video_path = self.output.with_suffix(".webm")
                                shutil.copy(src, self.video_path)
                    except Exception:  # noqa: BLE001
                        pass
                else:
                    context.close()
                browser.close()

        if self.own_server:
            stop_static_server(self.own_server)

        trace = self._build_trace(started, exit_code)
        if not self.args.no_trace:
            self.trace_path.write_text(json.dumps(trace, indent=2, ensure_ascii=False),
                                       encoding="utf-8")
        self._print_summary(trace, exit_code)
        return exit_code

    def _make_context(self, browser, pw):
        sc = self.scenario
        kwargs: dict = {}
        device = self.args.device or sc.get("device")
        if device:
            try:
                kwargs.update(pw.devices[device])
            except KeyError:
                raise RenderError(f"unknown device descriptor {device!r}")
        viewport = sc.get("viewport")
        if self.args.viewport:
            w, h = self.args.viewport.lower().split("x")
            viewport = {"width": int(w), "height": int(h)}
        if viewport and "viewport" not in kwargs:
            kwargs["viewport"] = viewport
        elif "viewport" not in kwargs and not device:
            kwargs["viewport"] = {"width": 1280, "height": 800}
        for key in ("locale", "timezone_id"):
            if sc.get(key):
                kwargs[key] = sc[key]
        if sc.get("color_scheme"):
            kwargs["color_scheme"] = sc["color_scheme"]
        if self.scenario.get("video") or self.args.video:
            kwargs["record_video_dir"] = str(SCREENSHOTS_DIR / "videos")
        return browser.new_context(**kwargs)

    def _attach_listeners(self, page, context):
        def wire(p):
            p.on("console", lambda m: self.console.append(
                {"type": m.type, "text": m.text}))
            p.on("pageerror", lambda e: self.page_errors.append(str(e)))
        wire(page)
        context.on("page", wire)

        block_external = self.scenario.get("block_external", True)
        if block_external and not self.args.no_block_external:
            base_host = urlparse(self.base_url).netloc.split(":")[0]

            def blocker(route):
                url = route.request.url
                host = urlparse(url).netloc.split(":")[0]
                if host in (base_host, "localhost", "127.0.0.1", ""):
                    route.continue_()
                else:
                    route.abort()
            context.route("**/*", blocker)

    def _apply_initial_seed(self, context):
        spec = self.args.seed if self.args.seed else self.scenario.get("seed")
        if spec is None and not self.args.no_seed:
            spec = "preset:empty"       # deterministic by default: tour off
        if spec is None:
            return
        blob = seedlib.resolve_seed(spec)
        storage.seed_context(context, mf_state=blob.get("mf_state"),
                             tracker=blob.get("SCIMATracker"))
        self.trace_steps.append({"i": 0, "action": "seed(initial)", "status": "ok",
                                 "note": _shorten(spec, 120)})

    # -- step dispatch ---------------------------------------------------------

    def _run_step(self, i: int, step, page, context):
        if not isinstance(step, dict) or len(step) != 1:
            raise RenderError(f"step {i}: expected one action key per object, got {step!r}")
        (action, arg), = step.items()
        handler = getattr(self, f"_do_{action}", None)
        if handler is None:
            raise RenderError(
                f"step {i}: unknown action {action!r}. "
                f"Run with --list-steps for the reference.")
        t0 = time.time()
        note = handler(arg, page, context)
        ms = int((time.time() - t0) * 1000)
        entry = {"i": i, "action": action, "status": "ok", "ms": ms,
                 "arg": _shorten(arg, 160)}
        if note is not None:
            entry["note"] = _shorten(note, 400)
        self.trace_steps.append(entry)
        print(f"  [{i:02d}] {action:14s} {_shorten(arg, 70):70s} ok {ms:5d}ms"
              + (f"  → {_shorten(note, 90)}" if note is not None else ""))

    # navigation & timing
    def _do_goto(self, arg, page, context):
        if isinstance(arg, str):
            url, wait_until, ready = arg, "load", True
        else:
            url = arg.get("url")
            wait_until = arg.get("wait_until", "load")
            ready = arg.get("ready", True)
        page.goto(_resolve_url(self.base_url, url), wait_until=wait_until)
        if ready:
            self._try_app_ready(page)
        return page.url

    def _do_reload(self, arg, page, context):
        page.reload(wait_until="load")
        self._try_app_ready(page)
        return page.url

    def _do_back(self, arg, page, context):
        page.go_back(wait_until="load")
        return page.url

    def _do_pause(self, arg, page, context):
        if isinstance(arg, dict):
            ms = arg.get("ms") or int(float(arg.get("seconds", 0)) * 1000)
        else:
            ms = int(arg)
        page.wait_for_timeout(ms)
        return f"{ms}ms"

    def _do_wait_for(self, arg, page, context):
        if isinstance(arg, str):
            arg = {"selector": arg}
        t = _timeout(arg, self.default_timeout)
        if "selector" in arg:
            page.wait_for_selector(arg["selector"],
                                   state=arg.get("state", "visible"), timeout=t)
        elif "text" in arg:
            page.get_by_text(arg["text"]).first.wait_for(state="visible", timeout=t)
        elif "url" in arg:
            page.wait_for_url(_url_matcher(self.base_url, arg["url"]), timeout=t)
            self._try_app_ready(page)
        elif "js" in arg:
            page.wait_for_function(arg["js"], timeout=t)
        elif "load_state" in arg:
            page.wait_for_load_state(arg["load_state"], timeout=t)
        else:
            raise RenderError(f"wait_for: need selector/text/url/js/load_state, got {arg!r}")
        return "matched"

    # interaction
    def _do_click(self, arg, page, context):
        spec = _as_spec(arg)
        page.click(spec["selector"],
                   button=spec.get("button", "left"),
                   click_count=spec.get("click_count", 1),
                   force=spec.get("force", False),
                   modifiers=spec.get("modifiers"),
                   timeout=_timeout(spec, self.default_timeout))

    def _do_dblclick(self, arg, page, context):
        spec = _as_spec(arg)
        page.dblclick(spec["selector"], timeout=_timeout(spec, self.default_timeout))

    def _do_hover(self, arg, page, context):
        spec = _as_spec(arg)
        page.hover(spec["selector"], timeout=_timeout(spec, self.default_timeout))

    def _do_focus(self, arg, page, context):
        spec = _as_spec(arg)
        page.focus(spec["selector"], timeout=_timeout(spec, self.default_timeout))

    def _do_fill(self, arg, page, context):
        page.fill(arg["selector"], str(arg.get("text", "")),
                  timeout=_timeout(arg, self.default_timeout))

    def _do_type(self, arg, page, context):
        loc = page.locator(arg["selector"]).first
        loc.press_sequentially(str(arg.get("text", "")),
                               delay=arg.get("delay", 30))
        if arg.get("submit"):
            loc.press("Enter")
        return arg.get("text")

    def _do_press(self, arg, page, context):
        if isinstance(arg, str):
            page.keyboard.press(arg)
        elif arg.get("selector"):
            page.locator(arg["selector"]).first.press(arg["key"])
        else:
            page.keyboard.press(arg["key"])

    def _do_check(self, arg, page, context):
        spec = _as_spec(arg)
        page.check(spec["selector"], timeout=_timeout(spec, self.default_timeout))

    def _do_uncheck(self, arg, page, context):
        spec = _as_spec(arg)
        page.uncheck(spec["selector"], timeout=_timeout(spec, self.default_timeout))

    def _do_select(self, arg, page, context):
        sel = {k: arg[k] for k in ("value", "label", "index") if k in arg}
        page.select_option(arg["selector"], **sel,
                           timeout=_timeout(arg, self.default_timeout))

    def _do_scroll(self, arg, page, context):
        arg = arg if isinstance(arg, dict) else {"y": int(arg)}
        sel = arg.get("selector")
        to = arg.get("to")
        if sel:
            if to == "bottom":
                js = "([s]) => { const e = document.querySelector(s); e.scrollTop = e.scrollHeight; }"
            elif to == "top":
                js = "([s]) => { document.querySelector(s).scrollTop = 0; }"
            else:
                js = ("([s, x, y]) => { const e = document.querySelector(s); "
                      "e.scrollLeft += x; e.scrollTop += y; }")
                page.evaluate(js, [sel, arg.get("x", 0), arg.get("y", 0)])
                return
            page.evaluate(js, [sel])
        else:
            if to == "bottom":
                page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            elif to == "top":
                page.evaluate("() => window.scrollTo(0, 0)")
            else:
                page.mouse.wheel(arg.get("x", 0), arg.get("y", 0))

    # state & seeding
    def _do_seed(self, arg, page, context):
        blob = seedlib.resolve_seed(arg)
        storage.seed_context(context, mf_state=blob.get("mf_state"),
                             tracker=blob.get("SCIMATracker"))
        if page.url.startswith("http"):
            page.reload(wait_until="load")
            self._try_app_ready(page)
        return "seeded (reloaded)" if page.url.startswith("http") else "seeded"

    def _do_clear_storage(self, arg, page, context):
        storage.clear_storage(page)
        if isinstance(arg, dict) and arg.get("reload", True):
            page.reload(wait_until="load")
        return "cleared"

    def _do_eval(self, arg, page, context):
        js = arg if isinstance(arg, str) else arg.get("js")
        if not js.lstrip().startswith(("(", "function", "async")):
            js = f"() => ({js})"
        return page.evaluate(js)

    def _do_mock_route(self, arg, page, context):
        url_pat = arg["url"]
        status = int(arg.get("status", 200))
        content_type = arg.get("content_type")
        body = arg.get("body")
        payload = arg.get("json")
        key = f"{url_pat}#{len(self.mock_counters)}"
        self.mock_counters[key] = {"n": 0, "max": arg.get("times")}

        def handler(route):
            req_url = route.request.url
            full = url_pat if url_pat.startswith("http") else None
            match = (fnmatch.fnmatch(req_url, full) if full
                     else (fnmatch.fnmatch(urlparse(req_url).path, url_pat)
                           if ("*" in url_pat or urlparse(req_url).path == url_pat
                               or url_pat.startswith("/"))
                           else url_pat in req_url))
            if not match:
                route.fallback()
                return
            self.mock_counters[key]["n"] += 1
            mx = self.mock_counters[key]["max"]
            if mx is not None and self.mock_counters[key]["n"] > mx:
                route.fallback()
                return
            kwargs = {"status": status}
            if content_type:
                kwargs["content_type"] = content_type
            if arg.get("headers"):
                kwargs["headers"] = {str(k): str(v) for k, v in arg["headers"].items()}
            if payload is not None:
                kwargs["json"] = payload
            elif body is not None:
                kwargs["body"] = body
            else:
                kwargs["json"] = {}
            route.fulfill(**kwargs)

        context.route("**/*", handler)
        return f"mocking {url_pat} → {status}"

    def _do_set_theme(self, arg, page, context):
        name = arg if isinstance(arg, str) else arg.get("preset")
        page.evaluate(f"""() => {{
            if (typeof THEME_PRESETS === 'undefined' || !THEME_PRESETS[{json.dumps(name)}])
                throw new Error('unknown theme preset: {name}');
            state.settings.theme = {{ ...THEME_PRESETS[{json.dumps(name)}] }};
            applyThemeVars(state.settings.theme);
            if (typeof scheduleSave === 'function') scheduleSave();
        }}""")
        return name

    def _do_set_viewport(self, arg, page, context):
        page.set_viewport_size({"width": int(arg["width"]), "height": int(arg["height"])})
        return f"{arg['width']}x{arg['height']}"

    # output & assertions
    def _do_screenshot(self, arg, page, context):
        if isinstance(arg, str):
            arg = {"path": arg}
        idx = len([s for s in self.trace_steps if s.get("action") == "screenshot"]) + 1
        default = f"steps/{self.name}-{idx:02d}.png"
        path = _resolve_out_path(arg.get("path") or arg.get("name") or default,
                                 default)
        kwargs = {"path": str(path), "full_page": bool(arg.get("full_page"))}
        if arg.get("selector"):
            page.locator(arg["selector"]).first.screenshot(path=str(path))
        else:
            page.screenshot(**kwargs)
        return str(path)

    def _do_assert(self, arg, page, context):
        failures = []

        def check(desc, ok):
            if not ok:
                failures.append(desc)

        t = _timeout(arg, self.default_timeout)
        if "selector" in arg:
            loc = page.locator(arg["selector"])
            if arg.get("visible"):
                try:
                    loc.first.wait_for(state="visible", timeout=t)
                except Exception:  # noqa: BLE001
                    failures.append(f"selector not visible: {arg['selector']}")
            if arg.get("hidden"):
                try:
                    loc.first.wait_for(state="hidden", timeout=t)
                except Exception:  # noqa: BLE001
                    failures.append(f"selector not hidden: {arg['selector']}")
            if "count" in arg:
                check(f"count {arg['selector']} == {arg['count']} (got {loc.count()})",
                      loc.count() == int(arg["count"]))
        if "text" in arg or "text_contains" in arg:
            sel = arg.get("selector")
            text = (page.locator(sel).first.inner_text(timeout=t) if sel
                    else page.locator("body").inner_text(timeout=t))
            if "text" in arg:
                check(f"text == {arg['text']!r} (got {_shorten(text, 80)!r})",
                      text.strip() == arg["text"].strip())
            if "text_contains" in arg:
                check(f"text contains {arg['text_contains']!r}",
                      arg["text_contains"] in text)
        if "value" in arg:
            v = page.input_value(arg["selector"], timeout=t)
            check(f"value == {arg['value']!r} (got {v!r})", v == str(arg["value"]))
        if "checked" in arg:
            c = page.is_checked(arg["selector"], timeout=t)
            check(f"checked == {arg['checked']} (got {c})", c == bool(arg["checked"]))
        if "url_contains" in arg:
            check(f"url contains {arg['url_contains']!r} (got {page.url!r})",
                  arg["url_contains"] in page.url)
        if "url" in arg:
            check(f"url == {arg['url']!r} (got {page.url!r})",
                  page.url == _resolve_url(self.base_url, arg["url"]))
        if "title_contains" in arg:
            check(f"title contains {arg['title_contains']!r} (got {page.title()!r})",
                  arg["title_contains"] in page.title())
        if "js" in arg:
            js = arg["js"]
            if not js.lstrip().startswith(("(", "function", "async")):
                js = f"() => ({js})"
            got = page.evaluate(js)
            if "equals" in arg:
                check(f"js {arg['js']!r} == {arg['equals']!r} (got {got!r})",
                      got == arg["equals"])
            else:
                check(f"js {arg['js']!r} truthy (got {got!r})", bool(got))
        if failures:
            raise AssertionError("; ".join(failures))
        return "all checks passed"

    def _do_dump(self, arg, page, context):
        if isinstance(arg, str):
            arg = {"dom": arg}
        out = {}
        if "dom" in arg:
            sel = arg["dom"]
            out["dom"] = (page.content() if sel in (True, "page", None)
                          else page.locator(sel).first.evaluate("e => e.outerHTML"))
        if "text" in arg:
            out["text"] = page.locator(arg["text"]).first.inner_text()
        if arg.get("console"):
            out["console"] = list(self.console[-50:])
        self.dumps.append(out)
        return {k: _shorten(v, 300) for k, v in out.items()}

    # -- finishing -----------------------------------------------------------

    def _try_app_ready(self, page):
        try:
            pages_helpers.app_ready(page, timeout=8000)
        except Exception:  # noqa: BLE001
            pass  # redirect stubs / non-app pages have no `state`

    def _final_screenshot(self, page):
        full = bool(self.args.full_page or self.scenario.get("full_page"))
        page.screenshot(path=str(self.output), full_page=full)

    def _capture_failure(self, page, exc):
        print(f"\n✗ FAILED: {exc}", file=sys.stderr)
        fail_shot = self.output.with_name(self.output.stem + "-FAIL.png")
        try:
            page.screenshot(path=str(fail_shot))
            print(f"  📸 failure photo → {fail_shot}")
        except Exception as e2:  # noqa: BLE001
            print(f"  (failure screenshot unavailable: {e2})", file=sys.stderr)
        self.failure = {"error": str(exc), "traceback": traceback.format_exc(limit=8),
                        "screenshot": str(fail_shot)}
        if self.console:
            tail = [c for c in self.console[-15:] if c["type"] in ("error", "warning")]
            if tail:
                print("  console tail:", file=sys.stderr)
                for c in tail:
                    print(f"    [{c['type']}] {_shorten(c['text'], 160)}", file=sys.stderr)

    def _build_trace(self, started, exit_code) -> dict:
        return {
            "scenario": self.name,
            "description": self.scenario.get("description", ""),
            "base_url": self.base_url,
            "ran_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "duration_ms": int((time.time() - started) * 1000),
            "exit_code": exit_code,
            "screenshot": str(self.output),
            "video": str(self.video_path) if self.video_path else None,
            "steps": self.trace_steps,
            "dumps": self.dumps or None,
            "console": self.console[-200:],
            "page_errors": self.page_errors,
            "failure": getattr(self, "failure", None),
        }

    def _print_summary(self, trace, exit_code):
        print()
        if exit_code == 0:
            print(f"📸 photo      → {self.output}")
            if self.video_path:
                print(f"🎬 video      → {self.video_path}")
            print(f"🧾 trace      → {self.trace_path}")
            print(f"✓ {len(self.trace_steps)} steps in {trace['duration_ms']}ms")
        else:
            print(f"✗ failed — see {self.trace_path}", file=sys.stderr)
        if self.page_errors:
            print(f"⚠ {len(self.page_errors)} JS page error(s):")
            for e in self.page_errors[:5]:
                print(f"    {_shorten(e, 200)}")
        return exit_code


def _url_matcher(base_url: str, pat: str):
    if "*" in pat:
        return re.compile(fnmatch.translate(pat if pat.startswith("http") else "*" + pat))
    return re.compile(re.escape(_resolve_url(base_url, pat)))


# ── CLI ──────────────────────────────────────────────────────────────────────

def _quick_scenario(args) -> dict:
    steps = json.loads(args.steps_json) if args.steps_json else []
    if not isinstance(steps, list):
        raise SystemExit("--steps-json must be a JSON array of step objects")
    sc = {"name": args.name or "quick", "steps": steps}
    if args.goto:
        sc["steps"] = [{"goto": args.goto}] + sc["steps"]
    if args.viewport:
        w, h = args.viewport.lower().split("x")
        sc["viewport"] = {"width": int(w), "height": int(h)}
    if args.full_page:
        sc["full_page"] = True
    return sc


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Render a SCIMA interaction scenario to a screenshot.",
        epilog="Run with --list-steps for the full step reference.")
    ap.add_argument("scenario", nargs="?", help="scenario JSON file")
    ap.add_argument("--base-url", help="site URL (default: auto-start static server)")
    ap.add_argument("--out", help="output PNG path (overrides scenario)")
    ap.add_argument("--seed", help="override scenario seed: preset name, JSON file, or inline JSON")
    ap.add_argument("--no-seed", action="store_true",
                    help="no default seeding (true first-run state, tour fires)")
    ap.add_argument("--browser", choices=["chromium", "firefox", "webkit"])
    ap.add_argument("--device", help="Playwright device descriptor, e.g. 'iPhone 13'")
    ap.add_argument("--viewport", help="WxH, e.g. 1366x768 (overrides scenario)")
    ap.add_argument("--full-page", action="store_true", help="final photo = full page")
    ap.add_argument("--headed", action="store_true", help="show the browser window")
    ap.add_argument("--slowmo", type=int, help="slow every Playwright op by N ms")
    ap.add_argument("--video", action="store_true", help="record a .webm beside the photo")
    ap.add_argument("--timeout", type=float, default=10000,
                    help="default per-step timeout ms (default 10000)")
    ap.add_argument("--no-block-external", action="store_true",
                    help="allow external requests (Google Fonts etc.)")
    ap.add_argument("--no-trace", action="store_true", help="skip writing the trace JSON")
    ap.add_argument("--json", action="store_true",
                    help="print the trace JSON to stdout at the end")
    # quick mode (no scenario file)
    ap.add_argument("--goto", help="quick mode: start URL/path")
    ap.add_argument("--steps-json", help="quick mode: JSON array of steps")
    ap.add_argument("--name", help="scenario name override")
    ap.add_argument("--list-steps", action="store_true", help="print step reference and exit")
    ap.add_argument("--serve-only", action="store_true",
                    help="start a static server, print its URL, and idle")
    args = ap.parse_args(argv)

    if args.list_steps:
        print(STEP_REFERENCE)
        return 0
    if args.serve_only:
        base, httpd = start_static_server()
        print(base)
        sys.stdout.flush()
        try:
            while True:
                time.sleep(0.5)
        except KeyboardInterrupt:
            stop_static_server(httpd)
        return 0

    if args.seed and (args.seed.startswith("{") or args.seed.startswith("[")):
        args.seed = json.loads(args.seed)

    if args.scenario:
        path = Path(args.scenario)
        if not path.exists():
            raise SystemExit(f"scenario file not found: {path}")
        scenario = json.loads(path.read_text(encoding="utf-8"))
        args.scenario_name = path.stem
    elif args.goto or args.steps_json:
        scenario = _quick_scenario(args)
        args.scenario_name = args.name or "quick"
    else:
        ap.error("give a scenario file, or --goto/--steps-json, or --list-steps")

    renderer = Renderer(scenario, args)
    code = renderer.run()
    if args.json and renderer.trace_path.exists():
        print(json.dumps(json.loads(renderer.trace_path.read_text(encoding="utf-8")),
                         ensure_ascii=False))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
