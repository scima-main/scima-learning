/* SCIMA icon system — shared/icons.js
 *
 * The whole app draws its icons from ONE asset set: the SVG symbols in
 * home/assets/svg/ (see assets/svg/build.py + assets/svg/README.md). Each
 * icon is a 24x24 stroke-based <symbol> using currentColor, so every glyph
 * in the UI shares the same grid, weight and colour behaviour.
 *
 * How it works:
 *   1. On first use (and immediately on load) this file fetches the sprite
 *      `assets/svg/icons.svg` ONCE per document and inlines it as a hidden
 *      <svg id="sc-icon-sprite"> at the top of <body>. Zero requests after
 *      that — every icon instance is a lightweight <use> reference.
 *   2. Icons are then rendered as
 *        <svg class="sc-icon"><use href="#i-NAME"/></svg>
 *      which inherits font-size (1em box), colour (currentColor) and the
 *      shared stroke styling from .sc-icon in app/dashboard.css.
 *   3. `<use>` references resolve live: markup rendered before the sprite
 *      fetch lands lights up the moment it arrives — no re-render needed.
 *
 * Public API (global):
 *   scIcon(name, opts)      -> SVGElement  (opts: {cls, title})
 *   scIconSvg(name, cls)    -> markup string, for template-literal renderers
 *   scLbl(name, text, cls)  -> <span class="sc-lbl"> icon + text </span>
 *                              element: the standard "labelled control"
 *                              unit used by buttons, tabs and headers
 *   scLblSvg(name, text)    -> same, as a markup string
 *   scIconNames()           -> array of available icon names (from sprite)
 *
 * Load order: anywhere before app/dashboard-core.js (it has no dependency
 * on the rest of shared/ — only on window.SCIMA_PAGE.root for URL
 * resolution, which every page sets inline in <head>-of-body). In the
 * browser-extension build chrome.runtime.getURL() resolves the sprite.
 */
(function (global) {
  'use strict';

  var SPRITE_PATH = 'assets/svg/icons.svg';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var XLINK_NS = 'http://www.w3.org/1999/xlink';
  var _state = 0;            // 0 = not started, 1 = pending, 2 = inlined, 3 = failed
  var _names = null;

  function spriteUrl() {
    try {
      if (typeof isExtension !== 'undefined' && isExtension &&
          typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        return chrome.runtime.getURL(SPRITE_PATH);
      }
    } catch (e) { /* not in an extension context */ }
    var root = (typeof window !== 'undefined' && window.SCIMA_PAGE &&
                typeof window.SCIMA_PAGE.root === 'string') ? window.SCIMA_PAGE.root : '';
    return new URL(root + SPRITE_PATH, document.baseURI).href;
  }

  function inlineSprite(svgText) {
    var holder = document.createElement('div');
    holder.innerHTML = svgText;
    var svg = holder.firstElementChild;
    if (!svg || svg.tagName.toLowerCase() !== 'svg') throw new Error('bad sprite payload');
    svg.setAttribute('id', 'sc-icon-sprite');
    svg.setAttribute('aria-hidden', 'true');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.display = 'none';
    (document.body || document.documentElement).insertBefore(
      svg, (document.body || document.documentElement).firstChild);
    _state = 2;
  }

  function ensureSprite() {
    if (_state) return;
    _state = 1;
    fetch(spriteUrl())
      .then(function (r) {
        if (!r.ok) throw new Error('sprite HTTP ' + r.status);
        return r.text();
      })
      .then(inlineSprite)
      .catch(function () {
        _state = 3;   // icons degrade to empty 1em boxes; nothing throws
      });
  }

  /** SVGElement for one icon. `opts.cls` adds classes, `opts.title` sets an
   *  accessible title (icons are aria-hidden by default — decorative). */
  function scIcon(name, opts) {
    opts = opts || {};
    ensureSprite();
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'sc-icon' + (opts.cls ? ' ' + opts.cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    use.setAttributeNS(XLINK_NS, 'xlink:href', '#i-' + name);
    svg.appendChild(use);
    if (opts.title) {
      svg.removeAttribute('aria-hidden');
      var t = document.createElementNS(SVG_NS, 'title');
      t.textContent = opts.title;
      svg.insertBefore(t, use);
    }
    return svg;
  }

  /** Markup string form — for renderers that build innerHTML templates. */
  function scIconSvg(name, cls) {
    ensureSprite();
    return '<svg class="sc-icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false">' +
           '<use href="#i-' + name + '"></use></svg>';
  }

  /** The standard labelled-control unit: icon + text sharing a baseline and
   *  a small gap. Accessible name = the text (icon is aria-hidden). */
  function scLbl(name, text, cls) {
    var span = document.createElement('span');
    span.className = 'sc-lbl' + (cls ? ' ' + cls : '');
    span.appendChild(scIcon(name));
    span.appendChild(document.createTextNode(text == null ? '' : String(text)));
    return span;
  }

  function scLblSvg(name, text) {
    return '<span class="sc-lbl">' + scIconSvg(name) +
           (text == null ? '' : String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')) +
           '</span>';
  }

  function scIconNames() {
    if (_names) return _names.slice();
    _names = [];
    var sprite = document.getElementById('sc-icon-sprite');
    if (sprite) {
      var syms = sprite.querySelectorAll('symbol');
      for (var i = 0; i < syms.length; i++) {
        _names.push(syms[i].id.replace(/^i-/, ''));
      }
    }
    return _names.slice();
  }

  /** True when `glyph` names an icon in the set (kebab-case id) rather than
   *  a user-chosen emoji. User content (deck/folder emoji) flows through the
   *  same renderers as app icons, so this is the single discrimination. */
  function scIsIconName(glyph) {
    return typeof glyph === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(glyph);
  }

  /** Render `glyph` whichever kind it is: an icon from the set, or the
   *  user's emoji verbatim. Returns an Element either way. */
  function scAuto(glyph, opts) {
    if (scIsIconName(glyph)) return scIcon(glyph, opts);
    var span = document.createElement('span');
    span.className = 'sc-emoji';
    span.textContent = glyph == null ? '' : String(glyph);
    return span;
  }

  /** Text prefix for contexts that cannot render SVG (e.g. <option>):
   *  keeps a user emoji, drops icon-set names (nothing to show). */
  function scPrefix(glyph) {
    return scIsIconName(glyph) ? '' : (glyph == null ? '' : String(glyph)) + ' ';
  }

  global.scIcon = scIcon;
  global.scIconSvg = scIconSvg;
  global.scLbl = scLbl;
  global.scLblSvg = scLblSvg;
  global.scIconNames = scIconNames;
  global.scIsIconName = scIsIconName;
  global.scAuto = scAuto;
  global.scPrefix = scPrefix;

  if (typeof document !== 'undefined' && document.readyState !== 'loading') ensureSprite();
  else if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', ensureSprite, { once: true });
  }
})(typeof window !== 'undefined' ? window : this);
