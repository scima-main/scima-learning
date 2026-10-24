#!/usr/bin/env python3
"""SCIMA icon factory — the single source of truth for the SVG icon set.

Every icon the frontend draws lives in ICONS below as raw SVG body markup on
one shared grid:

  * 24x24 viewBox, ~2px safe margin (art lives inside 3..21 where possible)
  * stroke-based line art — `currentColor` inherited from the embedding
    <svg> (standalone file) or the referencing <svg class="sc-icon">
    (sprite <use>); no hard-coded colours anywhere except the brand `logo`
  * stroke-width 1.75, round caps + joins (set on the file/sprite root, so
    bodies here carry geometry only; the few solid accents opt in locally
    with fill="currentColor" stroke="none")

This script regenerates BOTH artefacts next to it — run it after editing an
icon, never hand-edit the outputs:

  python3 build.py
    -> <name>.svg    one standalone file per icon (direct <img>/CSS/inline
                     embedding; the favicon uses logo.svg)
    -> icons.svg     the <symbol> sprite consumed at runtime: shared/icons.js
                     fetches it once per page and inlines it, then every icon
                     in the app is an <svg class="sc-icon"><use
                     href="#i-NAME"/></svg> — zero further requests, colour
                     and size follow the surrounding text.

Naming: lowercase kebab-case, semantic (what it MEANS, not what it happens
to look like): `download`, `folder-open`, `flag-checkered`.

Mapping note for maintainers — the icons replace the old emoji glyphs
one-for-one in the app modules; e.g. 🏠→home, 📚→books, 🧠→brain, 📖→book-open,
📊→chart-bar, 🌐→globe, ⚙️→gear, ❓→help, 🎯→target, 📦→package, ➕→plus,
⬇→download, ⬆→upload, ✏→pencil, 🗑→trash, 📌→pin, 🔥→flame, ⭐→star, 🏆→trophy,
✅→check-circle, ❌→x-circle, 🟡→circle-half, ⬜→square, ⚠→alert, ✕→close,
✓→check, ▶→play, 🔍→search, 🔗→link, 📋→clipboard, ✨→sparkles, 🃏→card,
🎴→cards, 🧩→puzzle, 💨→wind, 🔄→refresh, 🔁→repeat, ⏱→stopwatch, 🕒→clock,
🕘→history, ⏳→hourglass, 📅→calendar, 🗓→calendar-days, 🧾→receipt, 📝→note,
📄→file-text, 🆕→file-plus, 📁→folder, 📂→folder-open, 🗂→dividers, 🗃→archive,
📥→download, 📤→upload, 💾→save, 🖨→print, 🔌→plug, 🤖→robot, ♿→accessibility,
🎨→palette, 🖍→highlighter, 🔖→bookmark, 📑→tabs, 📎→paperclip, 🖼→image,
🗜→compress, 📱→phone, ⌨→keyboard, 🔠/🔡/🔤→type, ⌫→backspace, ⏭→skip-forward,
💀→skull, ⚡→zap, 🌍→globe, 🌱→seedling, 🌳→tree, 🌲→pine, 🏔→mountain,
🏛→landmark, 🏗→construction, 🧭→compass, 🎓→graduation, 💯→hundred, 👑→crown,
🏅→medal, 🎆→fireworks, 🌩→cloud-zap, 🏃→runner, 🗿→moai, 🎉→party, 👍→thumbs-up,
💪→dumbbell, 🩹→bandage, 💥→burst, ❤→heart, 🏁→flag-checkered, 🏳→flag,
🕹→joystick, ☀→sun, 🌙→moon, 🌅→sunrise, ◐→contrast, 📍→map-pin, 🔒→lock,
🔓→unlock, 🧹→broom, 〰→wave, 🎲→dice, 🧬→dna, 🧮→abacus, ▦→table, ⛶→maximize,
🗗→minimize, ⌖→crosshair, ↶→undo, ↷→redo, ↺→rotate-ccw, ↻→rotate-cw, ⇄→swap,
🔀→shuffle, ≡→menu, ☰→list, ⋯→dots, ×/✕→close, 🀄→translate, 🫣/🙈→eye-off,
👁→eye, 📭→mailbox, 🔎→search, 🏷→tag, 📈→trending-up, 🧠→brain, ✂→scissors,
⠿→grip, ☑→check-square, 🖊→pen, ✍→pen, 🕐→clock, 📕/📘/📗→book, ✦→spark.
"""
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
VIEWBOX = "0 0 24 24"

# Shared presentation attributes — identical on every standalone file root
# so any icon renders correctly when embedded directly.
ROOT_ATTRS = ('xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
              'fill="none" stroke="currentColor" stroke-width="1.75" '
              'stroke-linecap="round" stroke-linejoin="round"')

# The gear rim+teeth outline is regular geometry — generated, not hand-typed.
GEAR = ("M9.57 5.38L10.65 5.08L10.58 2.66L13.42 2.66L13.35 5.08L14.43 5.38"
        "L15 5.62L15.97 6.16L17.64 4.4L19.65 6.41L17.89 8.08L18.43 9.05"
        "L18.67 9.62L18.97 10.7L21.39 10.63L21.39 13.47L18.97 13.4"
        "L18.67 14.48L18.43 15.05L17.89 16.02L19.65 17.69L17.64 19.7"
        "L15.97 17.94L15 18.48L14.43 18.72L13.35 19.02L13.42 21.44"
        "L10.58 21.44L10.65 19.02L9.57 18.72L9 18.48L8.03 17.94L6.36 19.7"
        "L4.35 17.69L6.11 16.02L5.57 15.05L5.33 14.48L5.03 13.4L2.61 13.47"
        "L2.61 10.63L5.03 10.7L5.33 9.62L5.57 9.05L6.11 8.08L4.35 6.41"
        "L6.36 4.4L8.03 6.16L9 5.62Z")

ICONS = {
    # ── brand ───────────────────────────────────────────────────────────────
    "logo": '<defs><linearGradient id="scima-logo-g" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#5BCEFA"/><stop offset="1" stop-color="#A78BFA"/></linearGradient></defs><path d="M12 2.2 14.55 9.45 21.8 12 14.55 14.55 12 21.8 9.45 14.55 2.2 12 9.45 9.45Z" fill="url(#scima-logo-g)" stroke="none"/><circle cx="18.9" cy="5.1" r="1.7" fill="#F5A9B8" stroke="none"/>',
    "spark": '<path d="M12 2.6 14.4 9.6 21.4 12 14.4 14.4 12 21.4 9.6 14.4 2.6 12 9.6 9.6Z"/>',

    # ── navigation / views ──────────────────────────────────────────────────
    "home": '<path d="m3.3 10.4 8.7-7 8.7 7"/><path d="M5.6 9.1v10.3a1.4 1.4 0 0 0 1.4 1.4h10a1.4 1.4 0 0 0 1.4-1.4V9.1"/><path d="M9.6 20.8v-5.9a1 1 0 0 1 1-1h2.8a1 1 0 0 1 1 1v5.9"/>',
    "books": '<rect x="3.6" y="4.4" width="3.5" height="15.2" rx="1"/><rect x="9.3" y="4.4" width="3.5" height="15.2" rx="1"/><rect x="15.2" y="4.9" width="3.4" height="14.4" rx="1" transform="rotate(11 16.9 12.1)"/>',
    "brain": '<path d="M12 5.2a3 3 0 0 0-5.7-1A3 3 0 0 0 3.6 7a3.1 3.1 0 0 0-.5 4.2A3.2 3.2 0 0 0 3.7 16a3 3 0 0 0 2.9 3.6A2.8 2.8 0 0 0 12 18.9Z"/><path d="M12 5.2a3 3 0 0 1 5.7-1A3 3 0 0 1 20.4 7a3.1 3.1 0 0 1 .5 4.2A3.2 3.2 0 0 1 20.3 16a3 3 0 0 1-2.9 3.6A2.8 2.8 0 0 1 12 18.9Z"/><path d="M12 5.2v13.7"/><path d="M7.4 9.2c1.3 0 2 .9 2 2M16.6 9.2c-1.3 0-2 .9-2 2M7.8 14.6c1.2 0 1.9.8 1.9 1.9M16.2 14.6c-1.2 0-1.9.8-1.9 1.9"/>',
    "book-open": '<path d="M12 6.6C10.4 5 8.3 4.3 5.6 4.3c-.9 0-1.7.1-2.5.3v13.3c.8-.2 1.6-.3 2.5-.3 2.7 0 4.8.7 6.4 2.3 1.6-1.6 3.7-2.3 6.4-2.3.9 0 1.7.1 2.5.3V4.6c-.8-.2-1.6-.3-2.5-.3-2.7 0-4.8.7-6.4 2.3Z"/><path d="M12 6.6v13.3"/>',
    "book": '<path d="M4.3 19.3A2.4 2.4 0 0 1 6.7 17h13.1"/><path d="M6.7 2.9h13.1v18.2H6.7a2.4 2.4 0 0 1-2.4-2.4V5.3a2.4 2.4 0 0 1 2.4-2.4Z"/><path d="M14.2 2.9v5.6l-2.1-1.5-2.1 1.5V2.9"/>',
    "chart-bar": '<path d="M3.4 20.6h17.2"/><rect x="5.3" y="11.4" width="3.4" height="6.4" rx=".9"/><rect x="10.3" y="6.4" width="3.4" height="11.4" rx=".9"/><rect x="15.3" y="13.9" width="3.4" height="3.9" rx=".9"/>',
    "trending-up": '<path d="m3.6 16.6 5.6-5.6 3.4 3.4 7-7"/><path d="M14.8 7.4h4.8v4.8"/>',
    "globe": '<circle cx="12" cy="12" r="8.7"/><path d="M3.5 12h17"/><path d="M12 3.3c2.3 2.4 3.5 5.3 3.5 8.7s-1.2 6.3-3.5 8.7c-2.3-2.4-3.5-5.3-3.5-8.7S9.7 5.7 12 3.3Z"/>',
    "gear": f'<path d="{GEAR}"/><circle cx="12" cy="12.05" r="2.9"/>',
    "help": '<circle cx="12" cy="12" r="8.8"/><path d="M9.4 9.5a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.3-2.6 4"/><circle cx="12" cy="17.3" r="1" fill="currentColor" stroke="none"/>',
    "info": '<circle cx="12" cy="12" r="8.8"/><path d="M12 11.2v5.4"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/>',
    "target": '<circle cx="12" cy="12" r="8.8"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    "package": '<path d="m12 3 8.4 4.5v9L12 21l-8.4-4.5v-9Z"/><path d="m3.9 7.7 8.1 4.3 8.1-4.3"/><path d="M12 12v9"/><path d="m7.8 5.3 8.4 4.4"/>',
    "box": '<path d="m12 3 8.4 4.5v9L12 21l-8.4-4.5v-9Z"/><path d="m3.9 7.7 8.1 4.3 8.1-4.3"/><path d="M12 12v9"/>',
    "gamepad": '<path d="M7.6 7.8h8.8a5.4 5.4 0 0 1 5.3 4.4l.6 3.7a3 3 0 0 1-5.5 1.9l-1.2-1.6H8.4l-1.2 1.6a3 3 0 0 1-5.5-1.9l.6-3.7a5.4 5.4 0 0 1 5.3-4.4Z"/><path d="M6.6 11.6v3M5.1 13.1h3"/><circle cx="16.1" cy="12.4" r=".9" fill="currentColor" stroke="none"/><circle cx="18.1" cy="14.6" r=".9" fill="currentColor" stroke="none"/>',
    "joystick": '<circle cx="12" cy="6" r="2.7"/><path d="M12 8.7v6.6"/><path d="M5.6 20.4a2.6 2.6 0 0 1 2.6-2.6h7.6a2.6 2.6 0 0 1 2.6 2.6Z"/>',
    "menu": '<path d="M4 7h16M4 12h16M4 17h16"/>',
    "list": '<path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12"/><circle cx="4.4" cy="6.5" r="1.05" fill="currentColor" stroke="none"/><circle cx="4.4" cy="12" r="1.05" fill="currentColor" stroke="none"/><circle cx="4.4" cy="17.5" r="1.05" fill="currentColor" stroke="none"/>',
    "dots": '<circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
    "grid": '<rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/>',

    # ── generic actions ─────────────────────────────────────────────────────
    "close": '<path d="m6.2 6.2 11.6 11.6M17.8 6.2 6.2 17.8"/>',
    "check": '<path d="m4.8 12.6 4.9 4.9 9.5-11"/>',
    "check-circle": '<circle cx="12" cy="12" r="8.8"/><path d="m8.2 12.2 2.7 2.7 5.1-5.8"/>',
    "check-square": '<rect x="4.2" y="4.2" width="15.6" height="15.6" rx="2.4"/><path d="m8.3 12.2 2.6 2.6 5-5.7"/>',
    "x-circle": '<circle cx="12" cy="12" r="8.8"/><path d="m9.3 9.3 5.4 5.4M14.7 9.3l-5.4 5.4"/>',
    "circle-half": '<circle cx="12" cy="12" r="8.8"/><path d="M12 3.2a8.8 8.8 0 0 1 0 17.6Z" fill="currentColor" stroke="none"/>',
    "square": '<rect x="4.4" y="4.4" width="15.2" height="15.2" rx="2.2"/>',
    "alert": '<path d="M10.6 4.4 2.9 18a1.6 1.6 0 0 0 1.4 2.4h15.4A1.6 1.6 0 0 0 21.1 18L13.4 4.4a1.6 1.6 0 0 0-2.8 0Z"/><path d="M12 9.6v4"/><circle cx="12" cy="16.8" r="1" fill="currentColor" stroke="none"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "play": '<path d="M8.2 5.6 18.3 12 8.2 18.4Z"/>',
    "download": '<path d="M12 3.6v11.2"/><path d="m7.6 10.6 4.4 4.4 4.4-4.4"/><path d="M4.4 16.4v2.2a2 2 0 0 0 2 2h11.2a2 2 0 0 0 2-2v-2.2"/>',
    "upload": '<path d="M12 15.2V4"/><path d="m7.6 8.2 4.4-4.4 4.4 4.4"/><path d="M4.4 16.4v2.2a2 2 0 0 0 2 2h11.2a2 2 0 0 0 2-2v-2.2"/>',
    "save": '<path d="M5.4 3.6h10.2L20.4 8.4v10.2a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8V5.4a1.8 1.8 0 0 1 1.8-1.8Z"/><path d="M7.6 3.6v5h7v-5"/><rect x="7.2" y="13.2" width="9.6" height="7.2" rx="1"/>',
    "print": '<path d="M7 9.2V4.4h10v4.8"/><rect x="3.8" y="9.2" width="16.4" height="7.2" rx="1.6"/><path d="M7 14h10v6.4H7Z"/><circle cx="17.2" cy="11.6" r=".8" fill="currentColor" stroke="none"/>',
    "pencil": '<path d="M4.6 19.4 5.2 16 16.6 4.6a2.1 2.1 0 0 1 3 3L8.2 19Z"/><path d="m14.9 6.3 3 3"/>',
    "pen": '<path d="M12.5 20.4H21"/><path d="M16.6 3.9a2.1 2.1 0 0 1 3 3L7.6 18.9l-4 1 1-4Z"/><path d="m14.8 5.7 3 3"/>',
    "trash": '<path d="M4.6 6.6h14.8"/><path d="M9.4 6.6V5a1.5 1.5 0 0 1 1.5-1.5h2.2A1.5 1.5 0 0 1 14.6 5v1.6"/><path d="m6.6 6.6 1 13a1.6 1.6 0 0 0 1.6 1.5h5.6a1.6 1.6 0 0 0 1.6-1.5l1-13"/><path d="M10.4 10.2v7M13.6 10.2v7"/>',
    "pin": '<path d="M9 3.6h6l-.9 5.4 3.2 3.2c.5.5.1 1.4-.6 1.4H7.3c-.7 0-1.1-.9-.6-1.4l3.2-3.2Z"/><path d="M12 13.6v6.8"/>',
    "eye": '<path d="M2.9 12S6.5 5.9 12 5.9 21.1 12 21.1 12 17.5 18.1 12 18.1 2.9 12 2.9 12Z"/><circle cx="12" cy="12" r="2.9"/>',
    "eye-off": '<path d="m4.2 4.2 15.6 15.6"/><path d="M9.9 6.2A9.6 9.6 0 0 1 12 6c5.5 0 9.1 6 9.1 6a16 16 0 0 1-3.3 4"/><path d="M6.5 8A15.6 15.6 0 0 0 2.9 12S6.5 18 12 18a9.5 9.5 0 0 0 3.4-.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    "search": '<circle cx="10.9" cy="10.9" r="6.4"/><path d="m15.7 15.7 4.9 4.9"/>',
    "link": '<path d="M10.3 13.7a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M13.7 10.3a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.3-1.3"/>',
    "scissors": '<circle cx="6.2" cy="6.2" r="2.5"/><circle cx="6.2" cy="17.8" r="2.5"/><path d="M8.4 7.7 20 17M20 7 8.4 16.3"/>',
    "copy": '<rect x="8.6" y="8.6" width="11.8" height="11.8" rx="2"/><path d="M15.4 5.6V5a1.4 1.4 0 0 0-1.4-1.4H5A1.4 1.4 0 0 0 3.6 5v9a1.4 1.4 0 0 0 1.4 1.4h.6"/>',
    "clipboard": '<path d="M9.2 4.6H7.1a1.5 1.5 0 0 0-1.5 1.5v13a1.5 1.5 0 0 0 1.5 1.5h9.8a1.5 1.5 0 0 0 1.5-1.5v-13a1.5 1.5 0 0 0-1.5-1.5h-2.1"/><rect x="9.2" y="2.9" width="5.6" height="3.4" rx="1"/><path d="M8.9 11.6h6.2M8.9 15.1h6.2M8.9 18.2h3.6"/>',
    "sparkles": '<path d="m10.4 3.2 1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L3.5 10.2l5.1-1.9Z"/><path d="m17.9 14.4.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9Z"/>',
    "refresh": '<path d="M19.8 8.6A8.4 8.4 0 0 0 5.3 7.2"/><path d="M5 3.4v4h4"/><path d="M4.2 15.4a8.4 8.4 0 0 0 14.5 1.4"/><path d="M19 20.6v-4h-4"/>',
    "repeat": '<path d="m17 2.8 3.4 3.4L17 9.6"/><path d="M3.6 12.4V9.6a3.4 3.4 0 0 1 3.4-3.4h13.4"/><path d="m7 21.2-3.4-3.4 3.4-3.4"/><path d="M20.4 11.6v2.8a3.4 3.4 0 0 1-3.4 3.4H3.6"/>',
    "shuffle": '<path d="m17 3.6 3.4 3.4L17 10.4"/><path d="m17 13.6 3.4 3.4L17 20.4"/><path d="M3.6 7h3.3c1.4 0 2.2.7 3 1.8l4.4 6.4c.8 1.1 1.6 1.8 3 1.8h3.1"/><path d="M3.6 17h3.3c1.4 0 2.2-.7 3-1.8M14.5 8.8c.8-1.1 1.6-1.8 3-1.8h2.9"/>',
    "swap": '<path d="M4.6 8.8h14.8"/><path d="m16.2 5.6 3.2 3.2-3.2 3.2"/><path d="M19.4 15.2H4.6"/><path d="m7.8 12-3.2 3.2L7.8 18.4"/>',
    "undo": '<path d="M4.2 9.6h9.6a5.6 5.6 0 0 1 0 11.2H7.8"/><path d="m8.2 5.4-4 4.2 4 4.1"/>',
    "redo": '<path d="M19.8 9.6h-9.6a5.6 5.6 0 0 0 0 11.2h6"/><path d="m15.8 5.4 4 4.2-4 4.1"/>',
    "rotate-ccw": '<path d="M4.4 9.8A8.2 8.2 0 1 1 4 14.4"/><path d="M3.4 13.4 4.7 9.3l3.9 1.7"/>',
    "rotate-cw": '<path d="M19.6 9.8A8.2 8.2 0 1 0 20 14.4"/><path d="m20.6 13.4-1.3-4.1-3.9 1.7"/>',
    "arrow-left": '<path d="M20 12H4.6"/><path d="m10.4 5.8-5.8 6.2 5.8 6.2"/>',
    "arrow-right": '<path d="M4 12h15.4"/><path d="m13.6 5.8 5.8 6.2-5.8 6.2"/>',
    "arrow-up": '<path d="M12 20V4.6"/><path d="M5.8 10.4 12 4.6l6.2 5.8"/>',
    "arrow-down": '<path d="M12 4v15.4"/><path d="M5.8 13.6 12 19.8l6.2-6.2"/>',
    "arrow-up-right": '<path d="M6.8 17.2 17.2 6.8"/><path d="M8.6 6.8h8.6v8.6"/>',
    "arrow-left-right": '<path d="M4.4 8.8h15.2"/><path d="m7.8 5.4-3.4 3.4 3.4 3.4"/><path d="M4.4 15.2h15.2"/><path d="m16.2 11.8 3.4 3.4-3.4 3.4"/>',
    "chevron-left": '<path d="m14.4 5.8-6.2 6.2 6.2 6.2"/>',
    "chevron-right": '<path d="m9.6 5.8 6.2 6.2-6.2 6.2"/>',
    "chevron-up": '<path d="m5.8 14.4 6.2-6.2 6.2 6.2"/>',
    "chevron-down": '<path d="m5.8 9.6 6.2 6.2 6.2-6.2"/>',
    "external-link": '<path d="M13.8 4.6H19a1.4 1.4 0 0 1 1.4 1.4v5"/><path d="M10.6 13.4 20.2 3.8"/><path d="M18.4 13.8v5a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6V7.2a1.6 1.6 0 0 1 1.6-1.6h5"/>',
    "maximize": '<path d="M4.4 9.2V4.8h4.4M15.2 4.8h4.4v4.4M19.6 14.8v4.4h-4.4M8.8 19.2H4.4v-4.4"/>',
    "minimize": '<path d="M9.2 4.4v4.8H4.4M14.8 9.2h4.8V4.4M14.8 19.6v-4.8h4.8M9.2 14.8H4.4v4.8"/>',
    "crosshair": '<circle cx="12" cy="12" r="8"/><path d="M12 2.8v4M12 17.2v4M2.8 12h4M17.2 12h4"/>',
    "fit": '<path d="M14.6 4.4h5v5M19.6 4.4l-6.2 6.2M9.4 19.6h-5v-5M4.4 19.6l6.2-6.2"/>',

    # ── files & folders ─────────────────────────────────────────────────────
    "folder": '<path d="M3.6 6.6a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.6.8l1.2 1.6h6.8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2Z"/>',
    "folder-open": '<path d="M3.6 18.6V6.6a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.6.8l1.2 1.6h5.4a2 2 0 0 1 2 2v1.6"/><path d="m3.6 18.6 2.5-7.4a1.6 1.6 0 0 1 1.5-1.1h12.7a1.2 1.2 0 0 1 1.1 1.7l-2.4 6.4a2 2 0 0 1-1.9 1.3H5.2a1.6 1.6 0 0 1-1.6-.9Z"/>',
    "folder-plus": '<path d="M3.6 6.6a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.6.8l1.2 1.6h6.8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2Z"/><path d="M12 10.2v5.2M9.4 12.8h5.2"/>',
    "dividers": '<path d="M3.6 8.6a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.6.8l1.2 1.6h6.8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2Z"/><path d="M9.6 11.6v7.2M14.4 11.6v7.2"/>',
    "file-text": '<path d="M13.6 3.6H7a1.6 1.6 0 0 0-1.6 1.6v13.6A1.6 1.6 0 0 0 7 20.4h10a1.6 1.6 0 0 0 1.6-1.6V8.6Z"/><path d="M13.6 3.6v3.8a1.2 1.2 0 0 0 1.2 1.2h3.8"/><path d="M8.6 12.6h6.8M8.6 16.1h6.8M8.6 9.1h2"/>',
    "file-plus": '<path d="M13.6 3.6H7a1.6 1.6 0 0 0-1.6 1.6v13.6A1.6 1.6 0 0 0 7 20.4h10a1.6 1.6 0 0 0 1.6-1.6V8.6Z"/><path d="M13.6 3.6v3.8a1.2 1.2 0 0 0 1.2 1.2h3.8"/><path d="M12 11.4v5.6M9.2 14.2h5.6"/>',
    "note": '<path d="M13.6 3.6H7a1.6 1.6 0 0 0-1.6 1.6v13.6A1.6 1.6 0 0 0 7 20.4h10a1.6 1.6 0 0 0 1.6-1.6V8.6Z"/><path d="M13.6 3.6v3.8a1.2 1.2 0 0 0 1.2 1.2h3.8"/><path d="M8.4 15.6c1.2-1.8 2.4-1.8 3.6 0s2.4 1.8 3.6 0"/>',
    "receipt": '<path d="M5.4 3.4v17.2l2.2-1.5 2.2 1.5 2.2-1.5 2.2 1.5 2.2-1.5 2.2 1.5V3.4l-2.2 1.5-2.2-1.5-2.2 1.5L12 3.4 9.8 4.9 7.6 3.4Z"/><path d="M9 9.6h6M9 13.4h6"/>',
    "archive": '<rect x="3.4" y="4" width="17.2" height="4.6" rx="1.2"/><path d="M5 8.6v10a1.6 1.6 0 0 0 1.6 1.6h10.8a1.6 1.6 0 0 0 1.6-1.6v-10"/><path d="M10 12.6h4"/>',
    "database": '<ellipse cx="12" cy="5.8" rx="7.6" ry="2.9"/><path d="M4.4 5.8v12.4c0 1.6 3.4 2.9 7.6 2.9s7.6-1.3 7.6-2.9V5.8"/><path d="M4.4 12c0 1.6 3.4 2.9 7.6 2.9s7.6-1.3 7.6-2.9"/>',
    "compress": '<path d="M4.4 9.4h5V4.4M14.6 4.4v5h5M19.6 14.6h-5v5M9.4 19.6v-5h-5"/>',
    "image": '<rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2"/><circle cx="8.7" cy="9.7" r="1.6"/><path d="m4.4 17.4 4.6-4.4 3.3 3 3-2.6 4.4 4.1"/>',
    "bookmark": '<path d="M6.6 3.6h10.8v16.8L12 16.4l-5.4 4Z"/>',
    "tabs": '<rect x="8.4" y="3.6" width="12" height="12" rx="2"/><path d="M16.4 19.4a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2V8.6a2 2 0 0 1 2-2"/><path d="M3.6 15.6h12.8"/>',
    "paperclip": '<path d="M20 11.6 12.4 19.2a5 5 0 0 1-7.1-7.1l7.8-7.7a3.4 3.4 0 0 1 4.8 4.8l-7.7 7.7a1.8 1.8 0 0 1-2.5-2.5l7-7"/>',
    "table": '<rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2"/><path d="M3.6 9.8h16.8M3.6 14.6h16.8M9.6 4.6v14.8M15.2 4.6v14.8"/>',
    "tag": '<path d="M11.4 3.6H20v8.6l-8.8 8.8a1.6 1.6 0 0 1-2.3 0l-6.3-6.3a1.6 1.6 0 0 1 0-2.3Z"/><circle cx="16.2" cy="7.8" r="1.4"/>',

    # ── study / cards ───────────────────────────────────────────────────────
    "card": '<rect x="3.6" y="5.4" width="16.8" height="13.2" rx="2"/><path d="M7.8 10.2h8.4M7.8 13.8h5.4"/>',
    "cards": '<path d="M8.9 4.92a2 2 0 0 1 1.62-.82h9a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2h-3.6"/><path d="M8.74 4.92a2 2 0 0 1 1.66-.14l8.46 3.08a2 2 0 0 1 1.19 2.57l-2.53 6.95a2 2 0 0 1-2.56 1.19l-1.24-.45"/><path d="M7.23 5.63a2 2 0 0 1 2.82-.24l6.9 5.78a2 2 0 0 1 .24 2.82l-4.75 5.67a2 2 0 0 1-2.82.24l-6.9-5.78a2 2 0 0 1-.24-2.82zM8.8 9.36l4.58 3.84m-6.5-1.55 2.55 2.13"/>',
    "puzzle": '<path d="M9.2 5H6.2A1.2 1.2 0 0 0 5 6.2v5a1.8 1.8 0 0 1 0 3.6v3a1.2 1.2 0 0 0 1.2 1.2h9.6a1.2 1.2 0 0 0 1.2-1.2v-3a1.8 1.8 0 0 0 0-3.6v-5A1.2 1.2 0 0 0 15.8 5h-3a1.8 1.8 0 0 0-3.6 0Z"/>',
    "wind": '<path d="M3.6 8.6h9.8a2.9 2.9 0 1 0-2.9-3.2"/><path d="M3.6 15.4h12.8a2.9 2.9 0 1 1-2.9 3.2"/><path d="M3.6 12h16.8"/>',
    "zap": '<path d="M13.6 2.8 5 13.4h5.6L10 21.2l9-11h-5.8Z"/>',
    "flag": '<path d="M5.4 21.2V3.6"/><path d="M5.4 4.6h13.2l-2.6 4 2.6 4H5.4"/>',
    "flag-checkered": '<path d="M5.4 21.2V3.4"/><path d="M5.4 3.8h13.2v11.4H5.4Z"/><path d="M9.8 3.8v11.4M14.2 3.8v11.4M5.4 7.6h13.2M5.4 11.4h13.2"/><path d="M5.4 3.8h4.4v3.8H5.4ZM14.2 3.8h4.4v3.8h-4.4ZM9.8 7.6h4.4v3.8H9.8ZM5.4 11.4h4.4v3.8H5.4ZM14.2 11.4h4.4v3.8h-4.4Z" fill="currentColor" stroke="none"/>',
    "clock": '<circle cx="12" cy="12" r="8.8"/><path d="M12 6.9V12l3.4 2"/>',
    "stopwatch": '<circle cx="12" cy="13.6" r="7.2"/><path d="M12 10v3.6l2.4 1.5"/><path d="M9.6 2.8h4.8M12 2.8v3.6"/><path d="m18.8 7.6 1.4-1.4"/>',
    "hourglass": '<path d="M7 3.4h10M7 20.6h10"/><path d="M7.6 3.4v3c0 1.6 1.9 2.9 4.4 4.2 2.5-1.3 4.4-2.6 4.4-4.2v-3"/><path d="M7.6 20.6v-3c0-1.6 1.9-2.9 4.4-4.2 2.5 1.3 4.4 2.6 4.4 4.2v3"/><path d="m10 18.4h4l-2-2.4Z" fill="currentColor" stroke="none"/>',
    "history": '<path d="M4.2 8.2A8.8 8.8 0 1 1 3.2 12.6"/><path d="M3.2 4.4v4h4"/><path d="M12 7.6V12l3.1 1.8"/>',
    "calendar": '<rect x="3.6" y="5.2" width="16.8" height="15.2" rx="2"/><path d="M3.6 10h16.8M8.4 3.2v4M15.6 3.2v4"/>',
    "calendar-days": '<rect x="3.6" y="5.2" width="16.8" height="15.2" rx="2"/><path d="M3.6 10h16.8M8.4 3.2v4M15.6 3.2v4"/><circle cx="8.2" cy="13.4" r=".95" fill="currentColor" stroke="none"/><circle cx="12" cy="13.4" r=".95" fill="currentColor" stroke="none"/><circle cx="15.8" cy="13.4" r=".95" fill="currentColor" stroke="none"/><circle cx="8.2" cy="16.9" r=".95" fill="currentColor" stroke="none"/><circle cx="12" cy="16.9" r=".95" fill="currentColor" stroke="none"/>',
    "keyboard": '<rect x="2.8" y="6.2" width="18.4" height="11.6" rx="2"/><path d="M6.4 9.6h.01M9.9 9.6h.01M13.4 9.6h.01M16.9 9.6h.01M6.4 12.6h.01M9.9 12.6h.01M13.4 12.6h.01M16.9 12.6h.01M8.6 15.4h6.8"/>',
    "type": '<path d="M5 6.8V4.6h14v2.2M12 4.8v14.4M9.2 19.4h5.6"/>',
    "backspace": '<path d="M8.6 4.6h10.2a1.6 1.6 0 0 1 1.6 1.6v11.6a1.6 1.6 0 0 1-1.6 1.6H8.6L2.9 12Z"/><path d="m11.8 9.6 4.8 4.8M16.6 9.6l-4.8 4.8"/>',
    "skip-forward": '<path d="M6.2 5.6 14 12l-7.8 6.4Z"/><path d="M17.8 5.6v12.8"/>',

    # ── results / feedback ──────────────────────────────────────────────────
    "flame": '<path d="M12 21.2c3.6 0 6.4-2.6 6.4-6.1 0-2.4-1.3-4.4-2.6-5.9-.4 1-1 1.8-1.8 2.2.3-2.6-.7-5.3-2.9-7.4-.2 2.2-1 3.6-2.4 5-1.5 1.5-3.1 3.4-3.1 6.1 0 3.5 2.8 6.1 6.4 6.1Z"/><path d="M12 18c1.4 0 2.4-1 2.4-2.4 0-1.4-1.1-2.2-2.4-3.6-1.3 1.4-2.4 2.2-2.4 3.6C9.6 17 10.6 18 12 18Z"/>',
    "star": '<path d="m12 3.6 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 10l6-.9Z"/>',
    "trophy": '<path d="M7.2 4.4h9.6v4.8a4.8 4.8 0 0 1-9.6 0Z"/><path d="M7.2 5.8H5a1 1 0 0 0-1 1.1c.2 2.2 1.5 3.7 3.5 4.1M16.8 5.8H19a1 1 0 0 1 1 1.1c-.2 2.2-1.5 3.7-3.5 4.1"/><path d="M12 14v3.4"/><path d="m9.4 17.4h5.2l.8 3H8.6Z"/>',
    "medal": '<path d="M8.6 9.9 6.2 3.4h4.4L12 6.6l1.4-3.2h4.4l-2.4 6.5"/><circle cx="12" cy="15" r="5"/><path d="m12 12.5.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3Z"/>',
    "crown": '<path d="M3.6 17.8 2.9 7.2l4.9 3.4L12 3.9l4.2 6.7 4.9-3.4-.7 10.6Z"/><path d="M3.9 20.6h16.2"/>',
    "hundred": '<path d="M4.4 8.8 6.9 7.4v9.2"/><path d="M12.6 16.2c-1.4 0-2.3-1.8-2.3-4s.9-4 2.3-4 2.3 1.8 2.3 4-.9 4-2.3 4Z"/><path d="M18.4 16.2c-1.4 0-2.3-1.8-2.3-4s.9-4 2.3-4 2.3 1.8 2.3 4-.9 4-2.3 4Z"/><path d="M3.6 19.9 20.4 17.7"/>',
    "party": '<path d="M3.6 20.4 10 14l3.4 3.4L6.2 20.4Z"/><path d="M10 14c2.8-2.8 1.6-6.4 4.4-8.4 2.2-1.6 5.2-.4 5.6 1.6"/><path d="M13.8 4.4c2.6-.8 4.8.8 5.2 3"/><circle cx="18.6" cy="12.8" r="1.05" fill="currentColor" stroke="none"/><circle cx="20.4" cy="17.2" r="1.05" fill="currentColor" stroke="none"/><circle cx="15.2" cy="17.6" r="1.05" fill="currentColor" stroke="none"/><circle cx="8.2" cy="5.2" r="1.05" fill="currentColor" stroke="none"/><circle cx="4.2" cy="9" r="1.05" fill="currentColor" stroke="none"/>',
    "thumbs-up": '<path d="M7.4 10.4 11.4 3a2.4 2.4 0 0 1 2.4 2.4V9.8h4.6a2 2 0 0 1 2 2.3l-1.2 6.4a2.4 2.4 0 0 1-2.4 2H7.4"/><rect x="3.4" y="10.4" width="4" height="10.1" rx="1.2"/>',
    "dumbbell": '<path d="M6.9 9.4v5.2M17.1 9.4v5.2M4.2 10.7v2.6M19.8 10.7v2.6M6.9 12h10.2"/>',
    "skull": '<path d="M12 3.2c-4.6 0-7.8 3.2-7.8 7.4 0 2.5 1.1 4.2 2.5 5.2.7.5 1 1 1 1.8v.9a1.6 1.6 0 0 0 1.6 1.6h5.4a1.6 1.6 0 0 0 1.6-1.6v-.9c0-.8.3-1.3 1-1.8 1.4-1 2.5-2.7 2.5-5.2 0-4.2-3.2-7.4-7.8-7.4Z"/><circle cx="9.2" cy="10.8" r="1.6"/><circle cx="14.8" cy="10.8" r="1.6"/><path d="m12 13.6-1.1 2.2h2.2Z"/>',
    "bandage": '<rect x="1.9" y="8.5" width="20.2" height="7" rx="3.5" transform="rotate(-45 12 12)"/><circle cx="10.6" cy="10.6" r=".8" fill="currentColor" stroke="none"/><circle cx="13.4" cy="13.4" r=".8" fill="currentColor" stroke="none"/><circle cx="13.4" cy="10.6" r=".8" fill="currentColor" stroke="none"/><circle cx="10.6" cy="13.4" r=".8" fill="currentColor" stroke="none"/>',
    "burst": '<path d="m12 3.3-2.8 5.3-5.9 1.1 4.1 4.3-.8 5.9 5.4-2.6 5.4 2.6-.8-5.9 4.1-4.3-5.9-1.1Z"/>',
    "heart": '<path d="M12 20.4S3.8 15.6 3.8 9.7A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 8.2 2.4c0 5.9-8.2 10.7-8.2 10.7Z"/>',
    "sharia": '<path d="M12 20.4S3.8 15.6 3.8 9.7A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 8.2 2.4c0 5.9-8.2 10.7-8.2 10.7Z"/>',

    # ── growth / knowledge (achievement & quest art) ────────────────────────
    "seedling": '<path d="M12 20.6v-6.4"/><path d="M12 14.2c0-4.2-3-6.8-7.4-6.8 0 4.4 3 6.8 7.4 6.8Z"/><path d="M12.6 12.4c.2-3 2.3-4.8 5.4-4.8-.1 3.1-2.2 4.9-5.4 4.8Z"/>',
    "tree": '<circle cx="12" cy="7.4" r="4.2"/><circle cx="8.4" cy="11" r="3.3"/><circle cx="15.6" cy="11" r="3.3"/><path d="M12 13.6v7M9.4 20.6h5.2"/>',
    "pine": '<path d="M12 3.2 6.6 10.8h2.9L5.8 16.2h12.4L14.5 10.8h2.9Z"/><path d="M12 16.2v4.4"/>',
    "mountain": '<path d="m3 19.4 6.6-13 4 7.7 2-2.9 5.6 8.2Z"/><path d="m7.3 10.9 1.5-1.2 1.3 1 1.4-1.2"/>',
    "landmark": '<path d="m3.6 9.6 8.4-5.4 8.4 5.4Z"/><path d="M6.2 9.6v7.8M10.1 9.6v7.8M13.9 9.6v7.8M17.8 9.6v7.8"/><path d="M3.6 17.4h16.8M2.8 20.4h18.4"/>',
    "construction": '<path d="M7.4 20.6 12 3.4l4.6 17.2"/><path d="M8.7 15.4h6.6M9.8 11.2h4.4M12 3.6v17"/><path d="M4.6 20.6h14.8"/>',
    "compass": '<circle cx="12" cy="12" r="8.8"/><path d="m15.9 8.1-2.1 5.8-5.7 2 2.1-5.8Z"/>',
    "graduation": '<path d="M12 4.2 2.9 8.5 12 12.8l9.1-4.3Z"/><path d="M6.6 10.7v4.8c0 1.9 2.4 3.4 5.4 3.4s5.4-1.5 5.4-3.4v-4.8"/><path d="M21.1 8.5v5.6"/>',
    "fireworks": '<circle cx="12" cy="12" r="2.3"/><path d="M12 7.4V3.6M12 16.6v3.8M7.4 12H3.6M16.6 12h3.8M8.7 8.7 6 6M15.3 15.3 18 18M15.3 8.7 18 6M8.7 15.3 6 18"/>',
    "cloud-zap": '<path d="M7.4 18.4h9.8a3.9 3.9 0 0 0 .5-7.8 5.6 5.6 0 0 0-10.8-1 3.9 3.9 0 0 0 .5 8.8Z"/><path d="m12.8 13-2.6 3.6h3l-2.6 3.6"/>',
    "runner": '<circle cx="14.8" cy="4.8" r="1.9"/><path d="m7.4 21.2 2.8-5 2.4-2-1.4-4.4-3.4 2-1.4 3"/><path d="m11.2 9.8 3.4-1.6 2.8 2.4 3 .8"/><path d="m12.6 14.2 3 2 .8 5"/>',
    "moai": '<path d="M7.6 20.8c-.5-3.4-.8-6.2-.8-8.6C6.8 7 8.9 3.4 12 3.4s5.2 3.6 5.2 8.8c0 2.4-.3 5.2-.8 8.6Z"/><path d="M9 9.6h2.4M12.6 9.6h2.4"/><circle cx="10.1" cy="11.6" r=".95" fill="currentColor" stroke="none"/><circle cx="13.9" cy="11.6" r=".95" fill="currentColor" stroke="none"/><path d="M12 10.8v3.6h-1.2M10.2 17.2h3.6"/>',
    "sun": '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5 7.2 7.2M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"/>',
    "moon": '<path d="M20.4 14.2A8.6 8.6 0 0 1 9.8 3.6a8.6 8.6 0 1 0 10.6 10.6Z"/>',
    "sunrise": '<path d="M12 3.2v4.4M5.6 9.6 4 8M18.4 9.6 20 8M2.8 16.4h2.4M18.8 16.4h2.4"/><path d="M8 16.4a4 4 0 0 1 8 0"/><path d="M2.8 20.4h18.4"/>',
    "contrast": '<circle cx="12" cy="12" r="8.8"/><path d="M12 3.2a8.8 8.8 0 0 1 0 17.6Z" fill="currentColor" stroke="none"/>',
    "accessibility": '<circle cx="12" cy="4.6" r="1.8"/><path d="M4.8 8.4a15 15 0 0 1 14.4 0"/><path d="M12 8.8v5.4"/><path d="m12 14.2-2.8 6.2M12 14.2l2.8 6.2"/>',
    "robot": '<rect x="4.6" y="8.4" width="14.8" height="10.4" rx="2.6"/><path d="M12 8.4V5.2"/><circle cx="12" cy="4" r="1.3"/><circle cx="9.2" cy="12.8" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.8" cy="12.8" r="1.2" fill="currentColor" stroke="none"/><path d="M9.8 16.2h4.4"/><path d="M2.6 12v3.4M21.4 12v3.4"/>',
    "translate": '<path d="M3.6 5.6h8M7.6 3.8v1.8"/><path d="M9.4 5.6c0 3.6-2.4 6.6-5.8 7.8M5.6 8.6c.9 2.2 2.6 3.9 4.8 4.8"/><path d="m12.8 20.4 4-9.6 4 9.6M14.3 17h5"/>',
    "plug": '<path d="M9.2 3.4v5.2M14.8 3.4v5.2"/><path d="M6.4 8.6h11.2v2.6a5.6 5.6 0 0 1-5.6 5.6 5.6 5.6 0 0 1-5.6-5.6Z"/><path d="M12 16.8v3.8"/>',
    "mailbox": '<path d="M4.2 20.4v-8.6a4.4 4.4 0 0 1 4.4-4.4h6.8a4.4 4.4 0 0 1 4.4 4.4v8.6"/><path d="M2.8 20.4h18.4"/><path d="M16.4 7.4V3.6L20 5.3l-3.6 1.7"/><path d="M8.8 12.8h6.4"/>',
    "lock": '<rect x="5" y="10.6" width="14" height="9.8" rx="2"/><path d="M8.2 10.6V7.4a3.8 3.8 0 0 1 7.6 0v3.2"/><path d="M12 14.6v2.2"/>',
    "unlock": '<rect x="5" y="10.6" width="14" height="9.8" rx="2"/><path d="M8.2 10.6V7.4a3.8 3.8 0 0 1 7.3-1.3"/><path d="M12 14.6v2.2"/>',
    "broom": '<path d="m13.4 9.8 6.9-6.9"/><path d="m10.2 8.2 4.8 4.8"/><path d="M11.8 6.6 8.6 9.8c-2.2 2.2-2.4 5.4-3.6 7.2-.7 1-.3 2.2.7 2.9 1.9 1.4 5 2.2 7.9-.7l3.2-3.2"/><path d="m7.4 15.6 3.2 3.2"/>',
    "palette": '<path d="M12 3.4a8.6 8.6 0 0 0 0 17.2c1.2 0 1.9-.8 1.9-1.7 0-.5-.2-.9-.5-1.2-.3-.4-.5-.8-.5-1.3 0-1 .8-1.7 1.8-1.7h1.8a4 4 0 0 0 4-4c0-4.1-3.8-7.3-8.5-7.3Z"/><circle cx="7.8" cy="11.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="10.6" cy="7.8" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="7.8" r="1.1" fill="currentColor" stroke="none"/><circle cx="17.4" cy="11.2" r="1.1" fill="currentColor" stroke="none"/>',
    "highlighter": '<path d="m14.4 4.6 5 5-7.6 7.6H6.8v-5Z"/><path d="m11.6 7.4 5 5"/><path d="M4.4 21.2h15.2"/>',
    "wave": '<path d="M2.8 12c1.6-3.4 3.1-3.4 4.6 0s3 3.4 4.6 0 3.1-3.4 4.6 0 3 3.4 4.6 0"/>',
    "dice": '<rect x="4" y="4" width="16" height="16" rx="2.6"/><circle cx="8.9" cy="8.9" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.1" cy="8.9" r="1.15" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="8.9" cy="15.1" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.1" cy="15.1" r="1.15" fill="currentColor" stroke="none"/>',
    "dna": '<path d="M8 3c0 6 8 6 8 12M16 3c0 6-8 6-8 12"/><path d="M8 15c0 2 .5 3.8 1.5 5.4M16 15c0 2-.5 3.8-1.5 5.4"/><path d="M9.9 6.6h4.2M8.6 13.9h6.8"/>',
    "abacus": '<rect x="3.6" y="4" width="16.8" height="16" rx="2"/><path d="M3.6 9.3h16.8M3.6 14.7h16.8"/><circle cx="8" cy="9.3" r="1.3"/><circle cx="13" cy="9.3" r="1.3"/><circle cx="10" cy="14.7" r="1.3"/><circle cx="15.2" cy="14.7" r="1.3"/>',
    "map-pin": '<path d="M12 21.2s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',

    # ── scratchpad tools ────────────────────────────────────────────────────
    "cursor": '<path d="m5.6 3.2 12.9 8.9-6.2 1.2-2.7 6Z"/>',
    "hand": '<path d="M8.5 11.5V5.6a1.5 1.5 0 0 1 3 0v3.5m0-5.2a1.5 1.5 0 0 1 3 0V9.3m0-4a1.5 1.5 0 0 1 3 0v7.5c0 4-2.7 6.9-6.5 6.9-3.2 0-4.8-1.5-6.4-4.3l-1.9-2.2c-.7-1.2-.3-2.3.6-2.7.8-.4 1.9-.1 2.6.9l1.8 2.7"/>',
    "eraser": '<path d="m9.6 19.4-5-5a1.8 1.8 0 0 1 0-2.5l7.9-7.9a1.8 1.8 0 0 1 2.5 0l5 5a1.8 1.8 0 0 1 0 2.5l-6.3 6.3"/><path d="M6.2 19.4h13.2"/><path d="m8.2 10.6 5.2 5.2"/>',
    "slash": '<path d="M5 19 19 5"/>',
    "circle": '<circle cx="12" cy="12" r="8.4"/>',
    "triangle": '<path d="M12 4.2 21 19.4H3Z"/>',
    "hexagon": '<path d="M9 3.6h6l4.2 8.4L15 20.4H9L4.8 12Z"/>',
    "grip": '<circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none"/>',
}

SPRITE_HEADER = """<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
<!-- SCIMA icon sprite — GENERATED by build.py, do not hand-edit.
     One <symbol> per icon on the shared 24x24 stroke grid; stroke, colour
     and size are inherited from the referencing <svg class="sc-icon">
     (shared/icons.js). -->
"""


def build():
    names = sorted(ICONS)
    for name in names:
        doc = f'<svg {ROOT_ATTRS}>\n  {ICONS[name]}\n</svg>\n'
        (HERE / f"{name}.svg").write_text(doc, encoding="utf-8")
    parts = [SPRITE_HEADER]
    for name in names:
        parts.append(
            f'<symbol id="i-{name}" viewBox="{VIEWBOX}">\n{ICONS[name]}\n</symbol>\n'
        )
    parts.append("</svg>\n")
    (HERE / "icons.svg").write_text("".join(parts), encoding="utf-8")
    print(f"built {len(names)} icons + icons.svg sprite in {HERE}")
    return 0


if __name__ == "__main__":
    sys.exit(build())
