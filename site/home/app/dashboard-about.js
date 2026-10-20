'use strict';
/* dashboard-about.js — the ❓ About view: fetches ABOUT.md from the landing
   folder root and renders it under the standard view header. The file is
   resolved relative to the page (SCIMA_PAGE.root + document.baseURI, the
   same trick assetUrl() uses), so it works under the / and /dashboard/
   mount families alike, and re-reads on every load — the page always
   matches the deployed markdown, no rebuild step.

   Loads on the /about/ route only; the nav entry lives in NAV_ITEMS
   (dashboard-core.js), so single-document builds (the extension) need to
   add this file plus a #view-about container to pick the tab up.

   ═══ The renderer ═══════════════════════════════════════════════════════
   markdownToHtml() is a full .md renderer — block grammar + inline grammar,
   no third-party library, still escape-first. Text is escaped at the moment
   it is emitted (rather than pre-escaping the whole document, which is what
   made the old subset match on `&gt;` for quotes) and every URL passes
   through mdSafeUrl(), so markdown can never inject markup or a
   javascript: URL: the only tags in the output are the ones written here.

   Blocks: ATX headings (# … ######) AND setext headings (=== / ---),
     paragraphs (with `  ` and `\` hard breaks), bullet lists (-, *, +) and
     ordered lists (1. / 1), honouring the `start` number) with arbitrary
     nesting and tight/loose wrapping, GFM task lists (- [ ] / - [x]),
     blockquotes (nested, with lazy continuation), fenced code (``` and ~~~,
     with a language-xyz class) and 4-space indented code, GFM tables
     (| a | b | + a :---/:---:/---: alignment row), thematic rules
     (---, ***, ___), link reference definitions ([id]: url "title"),
     footnotes ([^id]: … collected anywhere, rendered as a list at the end)
     and the `*=*` box-break token renderAbout() splits cards on.

   Inline: `code spans` (any backtick run), **strong**, *em*, ***both***,
     __strong__/_em_ with the intra-word `_` rule, ~~strikethrough~~,
     ==highlight==, [links](url "title"), [reference][id] / [shortcut]
     links, <https://autolinks>, <a@b.c>, bare-URL autolinking,
     ![images](src "title"), [^footnote] references, and backslash escapes.

   Emphasis uses the CommonMark delimiter-run algorithm (open/close
   flanking + the "rule of 3"), so **a *b* c** and *a **b** c* both nest the
   way they do in every other renderer instead of mis-pairing.

   ═══ Headings ═══════════════════════════════════════════════════════════
   # → <h1>, ## → <h2>, … ###### → <h6>, one-for-one. The old subset offset
   every level by two (# rendered as <h3>), which left the changelog's own
   title *smaller* than the version headings under it; the full h[n] mapping
   plus the .md-body h1/h2 rules in dashboard.css (30px / 22px against h3's
   17px, 24px / 19px on narrow screens) make # and ## read as the page- and
   section-level headings they are. Each heading also gets a slug id, so
   [jump](#version-202610013-alpha) anchors inside ABOUT.md work.

   ═══ Hosted images ══════════════════════════════════════════════════════
   Every relative image src is assumed to be hosted in the landing folder's
   media directory — ./home/assets/media/* — so ABOUT.md only has to name the file:
   ![logo](logo.png). media/logo.png, ./media/logo.png, home/media/logo.png,
   ./home/assets/media/logo.png and ../media/logo.png all resolve to that same
   file, and subfolders are kept (banners/x.png → media/banners/x.png).
   Absolute http(s)/data:image URLs are passed through untouched, and a
   relative *link* to a media-ish file (.png/.pdf/.mp4/…) resolves the same
   way. The directory is resolved with SCIMA_PAGE.root + document.baseURI, so
   /about/ and /dashboard/about/ both find it; missing files degrade to a
   dashed "not found in ./home/assets/media/" chip (see wireAboutMedia). */

/* ────────────────────────── URL + escaping helpers ────────────────────── */

// Landing-folder-relative asset resolver — the assetUrl() (dashboard-
// blobstore.js) trick repeated locally because the About page's script slice
// doesn't load the blob store. Falls back to the global when one exists
// (extension build), and to the bare relative path when there's no DOM
// (node test harness).
const ABOUT_MEDIA_DIR = 'assets/media/';

function aboutAssetUrl(path) {
  if (typeof assetUrl === 'function') { try { return assetUrl(path); } catch (e) {} }
  if (typeof document === 'undefined' || typeof URL === 'undefined') return path;
  const root = (typeof window !== 'undefined' && typeof window.SCIMA_PAGE?.root === 'string')
    ? window.SCIMA_PAGE.root : '';
  try { return new URL(root + path, document.baseURI).href; }
  catch (e) { return root + path; }
}

// Hosted-image resolver: everything relative lives in ./home/assets/media/*.
function mdMediaUrl(src) {
  let s = String(src == null ? '' : src).trim();
  if (!s) return s;
  if (/^(?:[a-z][a-z0-9+.\-]*:|\/\/)/i.test(s)) return s;   // absolute URL / data: / protocol-relative
  s = s.replace(/\\/g, '/');
  s = s.replace(/^\/+/, '');                                     // root-relative → landing folder
  s = s.replace(/^(?:\.\.?\/)+/, '');                            // ./ and ../ prefixes
  s = s.replace(/^(?:home\/)?(?:assets\/)?media\//i, '').replace(/^assets\//i, '');  // home/assets/media/x, assets/media/x, media/x, home/x
  s = s.replace(/^\/+/, '');
  s = s.replace(/ /g, '%20');                                     // URL() encodes these anyway
  return aboutAssetUrl(ABOUT_MEDIA_DIR + s);
}

// Extensions that count as "a hosted file" when they turn up in a relative
// *link* target — those get the same ./home/assets/media/* treatment as images.
const MD_ASSET_EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|svg|mp4|webm|mov|m4v|mp3|ogg|wav|flac|pdf|zip|json|csv)$/i;

function mdLinkUrl(href) {
  const s = String(href == null ? '' : href).trim();
  if (!s) return s;
  if (/^(?:#|https?:|mailto:|tel:|ftp:|ftps:|sms:|geo:|\/\/)/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.\-]*:/i.test(s)) return s;            // some other scheme — leave alone
  if (MD_ASSET_EXT.test(s)) return mdMediaUrl(s);            // relative file → media folder
  return s;                                                  // relative page/route → browser resolves
}

// Protocol allowlist. Anything with a scheme we don't know is dropped (the
// link degrades to plain text), which is what keeps `javascript:`/`data:text/
// html` out of the output. data: is image-only, and svg+xml is excluded
// because an SVG data URL can carry script.
const MD_URL_SCHEMES_LINK = ['http', 'https', 'mailto', 'tel', 'ftp', 'ftps', 'sms', 'geo'];
const MD_URL_SCHEMES_IMG = ['http', 'https', 'blob', 'data'];

function mdSafeUrl(url, isImage) {
  // Control characters are what make a URL dangerous to put in an attribute
  // (`java\tscript:`), so they go; spaces are legal inside a <…> destination
  // and are percent-encoded rather than dropped, so the URL still resolves.
  let u = String(url == null ? '' : url).replace(/[\u0000-\u001F\u007F]/g, '').replace(/ /g, '%20');
  if (!u) return '';
  const m = /^([a-z][a-z0-9+.\-]*):/i.exec(u);
  if (m) {
    const scheme = m[1].toLowerCase();
    const allow = isImage ? MD_URL_SCHEMES_IMG : MD_URL_SCHEMES_LINK;
    if (!allow.includes(scheme)) return '';
    if (scheme === 'data' && !/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|ico);/i.test(u)) return '';
  }
  return u;
}

function mdEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function mdAttr(s) { return mdEsc(s).replace(/'/g, '&#39;'); }

// Backslash escapes inside link destinations and titles (the inline scanner
// handles its own escapes; these two are read as raw slices).
function mdUnescape(s) {
  return String(s == null ? '' : s).replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
}

// Markdown syntax → plain text, for alt/title attributes and heading slugs.
function mdPlainText(s) {
  return String(s == null ? '' : s)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])?/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*?|__?|~~?|==)/g, '')
    .replace(/\\/g, '')
    .trim();
}

function mdSlug(text, ctx) {
  let base = mdPlainText(text).toLowerCase()
    .replace(/[^\w\u00C0-\uFFFF\s-]/g, '')
    .trim().replace(/\s+/g, '-');
  if (!base) base = 'section';
  let id = base, n = 1;
  while (ctx && ctx.ids.has(id)) id = `${base}-${n++}`;
  if (ctx) ctx.ids.add(id);
  return id;
}

/* ───────────────────────── inline grammar ─────────────────────────────── */

// Inline parsing is two passes: tokenize() turns the source into text nodes,
// opaque already-rendered nodes (code spans, links, images, hard breaks,
// ~~strike~~/==mark==) and *potential* `*`/`_` delimiter nodes; then
// mdProcessEmphasis() pairs those delimiters with the CommonMark algorithm.
// Doing it in one regex sweep is what made nested emphasis mis-pair.

const MD_PUNCT_RE = /[^\w\s]/;
const MD_ESCAPABLE = /[\\`*_{}[\]()#+\-.!>~|=<"$'&]/;

function mdTokenize(s, ctx) {
  const toks = [];
  const n = s.length;
  let i = 0;
  let buf = '';
  const flush = () => { if (buf) { toks.push({ t: 'text', v: buf }); buf = ''; } };
  const pushDelim = (ch, run) => {
    // Start/end of line count as whitespace for the flanking rules, exactly
    // like the CommonMark spec — otherwise the opening `*` of `*a **b** c*`
    // also reads as a potential closer and the outer pair never matches.
    const prev = i > 0 ? s[i - 1] : ' ';
    const next = i + run < n ? s[i + run] : ' ';
    const leftFlank = !/\s/.test(next) && (!MD_PUNCT_RE.test(next) || !prev || /\s/.test(prev) || MD_PUNCT_RE.test(prev));
    const rightFlank = !/\s/.test(prev) && (!MD_PUNCT_RE.test(prev) || !next || /\s/.test(next) || MD_PUNCT_RE.test(next));
    const canOpen = leftFlank && (ch !== '_' || !rightFlank || MD_PUNCT_RE.test(prev));
    const canClose = rightFlank && (ch !== '_' || !leftFlank || MD_PUNCT_RE.test(next));
    toks.push({ t: 'delim', ch, n: run, orig: run, canOpen, canClose });
  };

  while (i < n) {
    const c = s[i];

    // hard break sentinel (written by the paragraph collector)
    if (c === '\u0000') { flush(); toks.push({ t: 'html', v: '<br>' }); i++; continue; }

    // backslash escape
    if (c === '\\' && i + 1 < n) {
      if (MD_ESCAPABLE.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
    }

    // code span: a run of N backticks closes on the next run of exactly N
    if (c === '`') {
      let run = 0; while (i + run < n && s[i + run] === '`') run++;
      let j = i + run, close = -1;
      while (j < n) {
        if (s[j] === '`') {
          let k = j; while (k < n && s[k] === '`') k++;
          if (k - j === run) { close = j; break; }
          j = k;
        } else j++;
      }
      if (close > -1) {
        flush();
        let code = s.slice(i + run, close).replace(/\n/g, ' ');
        if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
        toks.push({ t: 'html', v: `<code>${mdEsc(code)}</code>` });
        i = close + run;
        continue;
      }
      buf += '`'.repeat(run); i += run; continue;
    }

    // <https://autolink> and <a@b.c>
    if (c === '<') {
      const rest = s.slice(i);
      const al = /^<([a-z][a-z0-9+.\-]{1,31}:[^\s<>]*)>/i.exec(rest);
      if (al) {
        const href = mdSafeUrl(al[1]);
        flush();
        if (href) toks.push({ t: 'html', v: `<a href="${mdAttr(href)}"${mdExtAttrs(href)}>${mdEsc(al[1])}</a>` });
        else toks.push({ t: 'text', v: al[1] });
        i += al[0].length; continue;
      }
      const ml = /^<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/.exec(rest);
      if (ml) {
        flush();
        toks.push({ t: 'html', v: `<a href="mailto:${mdAttr(ml[1])}">${mdEsc(ml[1])}</a>` });
        i += ml[0].length; continue;
      }
      buf += '<'; i++; continue;
    }

    // ![alt](src "title") — checked before links so images nest inside them
    if (c === '!' && s[i + 1] === '[') {
      const lab = mdReadBracketed(s, i + 1);
      if (lab) {
        const built = mdBuildLink(s, lab, ctx, true);
        if (built) { flush(); toks.push({ t: 'html', v: built.html }); i = built.end; continue; }
        buf += '![' + lab.text + ']'; i = lab.end; continue;
      }
      buf += '!'; i++; continue;
    }

    // [^footnote]
    if (c === '[' && s[i + 1] === '^') {
      const lab = mdReadBracketed(s, i);
      const id = lab ? lab.text.slice(1).trim() : '';
      if (lab && id && !id.includes(']') && ctx.fnDefs.has(id)) {
        flush();
        let num = ctx.fnOrder.indexOf(id);
        if (num < 0) { ctx.fnOrder.push(id); num = ctx.fnOrder.length - 1; }
        const refs = ctx.fnRefs.get(id) || [];
        const slug = ctx.fnSlug.get(id);
        const refId = `fnref-${slug}${refs.length ? '-' + refs.length : ''}`;
        refs.push(refId); ctx.fnRefs.set(id, refs);
        toks.push({ t: 'html', v: `<sup class="md-fn-ref"><a href="#fn-${mdAttr(slug)}" id="${mdAttr(refId)}" title="${mdAttr(mdPlainText(ctx.fnDefs.get(id)).replace(/\s+/g, ' '))}">${num + 1}</a></sup>` });
        i = lab.end; continue;
      }
      // not a known footnote → fall through to the link/literal branch below
    }

    // [text](href "title") / [text][ref] / [shortcut]
    if (c === '[') {
      const lab = mdReadBracketed(s, i);
      if (lab) {
        const built = mdBuildLink(s, lab, ctx, false);
        if (built) { flush(); toks.push({ t: 'html', v: built.html }); i = built.end; continue; }
        buf += '[' + lab.text + ']'; i = lab.end; continue;
      }
      buf += '['; i++; continue;
    }

    // ~~strikethrough~~ / ==highlight== — resolved eagerly (their content is
    // parsed recursively), so the delimiter stack below only ever sees */_
    if ((c === '~' && s[i + 1] === '~') || (c === '=' && s[i + 1] === '=')) {
      const pair = c + c;
      const close = s.indexOf(pair, i + 2);
      const inner = close > -1 ? s.slice(i + 2, close) : '';
      if (close > -1 && inner && !/^\s*$/.test(inner) && !inner.includes('\n\n')) {
        flush();
        const tag = c === '~' ? 'del' : 'mark';
        toks.push({ t: 'html', v: `<${tag}>${mdInline(inner, ctx)}</${tag}>` });
        i = close + 2; continue;
      }
      buf += pair; i += 2; continue;
    }

    // bare-URL autolink (GFM) — only at a word boundary
    if ((c === 'h' || c === 'H') && (i === 0 || !/[\w/]/.test(s[i - 1]))) {
      const u = /^https?:\/\/[^\s<>"'`)\]}]+/i.exec(s.slice(i));
      if (u) {
        let href = u[0];
        // Peel trailing sentence punctuation and trailing emphasis/quote
        // characters (`*https://x.test*` must link the URL, not its closing
        // `*`), and balance parentheses so `(see https://x.test/a_(b))` links
        // the URL, not its closing bracket. Peeled characters stay in the
        // source stream and are emitted as text by the normal path — nothing
        // here consumes them twice.
        while (href && /[.,;:!?_*'"`]/.test(href[href.length - 1])) href = href.slice(0, -1);
        while (href && /[)\]}]/.test(href[href.length - 1])) {
          const last = href[href.length - 1];
          const open = last === ')' ? '(' : last === ']' ? '[' : '{';
          const closes = href.split(last).length - 1;
          const opens = href.split(open).length - 1;
          if (closes > opens) href = href.slice(0, -1);
          else break;
        }
        const safe = mdSafeUrl(href);
        if (safe && href.includes('.')) {
          flush();
          toks.push({ t: 'html', v: `<a href="${mdAttr(safe)}"${mdExtAttrs(safe)}>${mdEsc(href)}</a>` });
          i += href.length;
          continue;
        }
      }
    }

    // emphasis delimiter runs
    if (c === '*' || c === '_') {
      let run = 0; while (i + run < n && s[i + run] === c) run++;
      flush();
      pushDelim(c, run);
      i += run; continue;
    }

    buf += c; i++;
  }
  flush();
  return mdProcessEmphasis(toks);
}

// Reads a [...] group at `at` (s[at] === '['), honouring escapes and nesting.
function mdReadBracketed(s, at) {
  let depth = 0, i = at;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return { text: s.slice(at + 1, i), end: i + 1 }; }
    i++;
  }
  return null;
}

// Parses what follows a link/image label: (dest "title"), [ref], or nothing
// (shortcut reference). Returns { href, title, end } or null when the label
// isn't a link at all.
function mdReadLinkTarget(s, at) {
  if (s[at] === '(') {
    let i = at + 1;
    while (i < s.length && /\s/.test(s[i])) i++;
    let href = '';
    if (s[i] === '<') {
      const close = s.indexOf('>', i + 1);
      if (close < 0) return null;
      href = mdUnescape(s.slice(i + 1, close)); i = close + 1;
    } else {
      let depth = 0;
      while (i < s.length) {
        const c = s[i];
        if (c === '\\' && i + 1 < s.length) { href += s[i + 1]; i += 2; continue; }
        if (c === '(') { depth++; href += c; i++; continue; }
        if (c === ')') { if (depth === 0) break; depth--; href += c; i++; continue; }
        if (/\s/.test(c)) break;
        href += c; i++;
      }
    }
    while (i < s.length && /\s/.test(s[i])) i++;
    let title = '';
    // Titles may contain backslash-escaped quotes: [a](u "say \"hi\"")
    const t = /^"((?:[^"\\]|\\.)*)"|^'((?:[^'\\]|\\.)*)'|^\(((?:[^)\\]|\\.)*)\)/.exec(s.slice(i));
    if (t) {
      title = mdUnescape(t[1] != null ? t[1] : t[2] != null ? t[2] : t[3]);
      i += t[0].length;
    }
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] !== ')') return null;
    return { href, title, end: i + 1 };
  }
  if (s[at] === '[') {
    const r = mdReadBracketed(s, at);
    if (!r) return null;
    return { ref: r.text, end: r.end };
  }
  return null;
}

function mdExtAttrs(href) {
  // Same policy the old renderer had: external URLs and in-page anchors open
  // in a new tab, relative/media paths stay in this one.
  return /^(?:https?:|#|\/)/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
}

function mdBuildLink(s, lab, ctx, isImage) {
  const target = mdReadLinkTarget(s, lab.end);
  let href = null, title = '', end = lab.end;
  if (target) {
    end = target.end;
    if (target.href != null) { href = target.href; title = target.title || ''; }
    else {
      const def = ctx.refs.get(((target.ref != null && target.ref !== '' ? target.ref : lab.text) || '').trim().toLowerCase());
      if (def) { href = def.href; title = title || def.title; }
    }
  } else {
    const def = ctx.refs.get(lab.text.trim().toLowerCase());
    if (def) { href = def.href; title = def.title; }
  }
  if (href == null) return null;

  const safe = mdSafeUrl(href, isImage);
  if (!safe) return { html: mdEsc(isImage ? mdPlainText(lab.text) : lab.text), end };

  if (isImage) {
    const src = mdMediaUrl(safe);
    const alt = mdPlainText(lab.text);
    return {
      html: `<img class="md-img" src="${mdAttr(src)}" alt="${mdAttr(alt)}"` +
        (title ? ` title="${mdAttr(title)}"` : '') + ' loading="lazy" decoding="async">',
      end,
    };
  }
  const url = mdLinkUrl(safe);
  return {
    html: `<a href="${mdAttr(url)}"${title ? ` title="${mdAttr(title)}"` : ''}${mdExtAttrs(url)}>${mdInline(lab.text, ctx)}</a>`,
    end,
  };
}

// CommonMark emphasis pairing over the delimiter nodes mdTokenize() emitted.
function mdProcessEmphasis(toks) {
  let ci = 0;
  while (ci < toks.length) {
    const closer = toks[ci];
    if (closer.t !== 'delim' || !closer.canClose || closer.n <= 0) { ci++; continue; }
    let oi = -1;
    for (let k = ci - 1; k >= 0; k--) {
      const op = toks[k];
      if (op.t !== 'delim' || op.ch !== closer.ch || !op.canOpen || op.n <= 0) continue;
      // "rule of 3": skip a candidate that would pair a run of 3 with a run
      // of 1/2 across punctuation-ish boundaries (**a*b** style traps)
      const odd = (op.canClose || closer.canOpen)
        && ((op.orig + closer.orig) % 3 === 0)
        && !(op.orig % 3 === 0 && closer.orig % 3 === 0);
      if (odd) continue;
      oi = k; break;
    }
    // No opener before this closer. It stays on the stack as a potential
    // *opener* for a later closer — that's what makes `a*b*c` emphasise:
    // the first `*` finds nothing to its left, then pairs with the second.
    if (oi < 0) { ci++; continue; }

    const opener = toks[oi];
    const use = (opener.n >= 2 && closer.n >= 2) ? 2 : 1;
    const tag = use === 2 ? 'strong' : 'em';
    const inner = toks.slice(oi + 1, ci);
    const wrapped = { t: 'html', v: `<${tag}>${mdSerialize(inner)}</${tag}>` };
    opener.n -= use; closer.n -= use;

    toks.splice(oi + 1, ci - oi - 1, wrapped);
    let next = oi + 2;                       // wrapped at oi+1, closer now at oi+2
    if (opener.n <= 0) { toks.splice(oi, 1); next = oi + 1; }
    if (closer.n <= 0) { toks.splice(next, 1); }
    ci = next;
  }
  return toks;
}

function mdSerialize(toks) {
  let out = '';
  for (const t of toks) {
    if (t.t === 'html') out += t.v;
    else if (t.t === 'text') out += mdEsc(t.v);
    else if (t.t === 'delim') out += mdEsc(t.ch.repeat(Math.max(0, t.n)));
  }
  return out;
}

// Public inline entry point (tokenize → emphasis pairing → serialize).
function mdInline(src, ctx) { return mdSerialize(mdTokenize(String(src == null ? '' : src), ctx)); }

/* ───────────────────────── block grammar ──────────────────────────────── */

const MD_INDENT_CODE = /^ {4}/;

function mdLineIndent(line) {
  const m = /^[ ]*/.exec(line);
  return m ? m[0].length : 0;
}
function mdDedent(line, n) { return n > 0 ? line.replace(new RegExp(`^ {0,${n}}`), '') : line; }

function mdMatchListItem(line) {
  const m = /^([ ]*)([-*+]|\d{1,9}[.)])([ ]*)(.*)$/.exec(line);
  if (!m) return null;
  const indent = m[1].length;
  if (indent > 3) return null;                 // deeper than a list marker can start → code/nested content
  const marker = m[2];
  const ordered = /\d/.test(marker[0]);
  const start = ordered ? parseInt(marker, 10) : 1;
  const rest = m[4];
  let spaces = m[3].length;
  if (rest === '') spaces = Math.min(spaces, 1);
  else if (spaces === 0) return null;          // `-foo` / `1.foo` are not list items
  else if (spaces > 4) spaces = 1;             // 5+ spaces → the content itself starts an indented code block
  return {
    indent, marker, ordered, start, rest,
    contentIndent: indent + marker.length + (rest === '' ? 1 : spaces),
  };
}

function mdIsBlockStart(line) {
  const t = line.trim();
  if (!t) return false;
  return /^\s{0,3}#{1,6}(?:\s|$)/.test(line)
    || /^\s{0,3}>/.test(line)
    || /^\s{0,3}(?:`{3,}|~{3,})/.test(line)
    || /^\s{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)
    || /^(?:\*=)+\*$/.test(t)
    || !!mdMatchListItem(line);
}

function mdSplitTableRow(line) {
  const SENT = '\u0001';
  let s = line.replace(/\\\|/g, SENT).trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.replace(new RegExp(SENT, 'g'), '|').trim());
}

function mdTableAligns(cells) {
  return cells.map(c => {
    const l = c.startsWith(':'), r = c.endsWith(':');
    return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
  });
}

// One list item's worth of lines: the marker line's content plus every
// following line that is indented to the item's content column (nested
// blocks) or lazily continues its paragraph. Blank runs only belong to the
// item when indented content or a sibling item follows them — and when they
// do, the list is loose (items get wrapped in <p>).
function mdCollectItem(lines, i, listIndent, ordered, state) {
  const it = mdMatchListItem(lines[i]);
  const raw = [it.rest];
  i++;
  let blanks = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { blanks++; i++; continue; }
    const ind = mdLineIndent(l);
    const ni = mdMatchListItem(l);
    if (blanks > 0) {
      const continues = ind >= it.contentIndent
        || (ni && ni.ordered === ordered && ni.indent >= listIndent && ni.indent <= listIndent + 3);
      // The blank run belongs to the caller, not to this item — rewind onto
      // it exactly once (blanks = 0 stops the post-loop rewind repeating it,
      // which would hand back an index we already consumed and spin forever).
      if (!continues) { i -= blanks; blanks = 0; break; }
      state.loose = true;
      for (let k = 0; k < blanks; k++) raw.push('');
      blanks = 0;
    }
    if (ind >= it.contentIndent) { raw.push(mdDedent(l, it.contentIndent)); i++; continue; }
    if (ni) break;                              // sibling item (or a new, less-indented list)
    if (mdIsBlockStart(l)) break;               // a new block ends the item
    raw.push(l.trim()); i++;                    // lazy paragraph continuation
  }
  if (blanks > 0) i -= blanks;                  // trailing blanks belong to the caller
  return { it, raw, next: i };
}

function mdParseList(lines, start, ctx) {
  const first = mdMatchListItem(lines[start]);
  const ordered = first.ordered;
  const listIndent = first.indent;
  const state = { loose: false };
  const items = [];
  let i = start;
  let anyTask = false;

  while (i < lines.length) {
    const it = mdMatchListItem(lines[i]);
    if (!it || it.ordered !== ordered || it.indent < listIndent || it.indent > listIndent + 3) break;
    const res = mdCollectItem(lines, i, listIndent, ordered, state);
    items.push(res.raw);
    i = res.next;
    // blank run between items? peek: another sibling item after it → loose list
    let j = i, blanks = 0;
    while (j < lines.length && !lines[j].trim()) { blanks++; j++; }
    if (blanks > 0) {
      const nx = j < lines.length ? mdMatchListItem(lines[j]) : null;
      if (nx && nx.ordered === ordered && nx.indent >= listIndent && nx.indent <= listIndent + 3) {
        state.loose = true; i = j;
      } else break;
    }
  }

  const body = items.map(raw => {
    let cls = '', prefix = '';
    const task = /^\[([ xX])\](?:[ ]+|$)/.exec(raw[0] || '');
    if (task) {
      anyTask = true;
      cls = ' class="task-list-item"';
      prefix = `<input type="checkbox" class="task-check" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''}> `;
      raw[0] = (raw[0] || '').slice(task[0].length);
      if (!raw[0] && raw.length === 1) raw[0] = '';
    }
    const inner = mdBlocks(raw, ctx, { tight: !state.loose });
    return `<li${cls}>${prefix}${inner}</li>`;
  }).join('');

  const tag = ordered ? 'ol' : 'ul';
  const attrs = [
    anyTask ? ' class="contains-task-list"' : '',
    ordered && first.start !== 1 ? ` start="${first.start}"` : '',
  ].join('');
  return { html: `<${tag}${attrs}>${body}</${tag}>`, next: i };
}

// The block parser. `opts.tight` is set while parsing a tight list item's
// content, where a lone paragraph renders without its <p> wrapper.
function mdBlocks(lines, ctx, opts) {
  const tight = !!(opts && opts.tight);
  const out = [];
  const N = lines.length;
  let i = 0;
  let prev = -1;

  while (i < N) {
    // Stall guard: every branch below consumes at least one line. If one ever
    // fails to, skip a line rather than spin — a hung render would freeze the
    // whole About page, which is a worse failure than a dropped line.
    if (i === prev) { i++; continue; }
    prev = i;
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // ── fenced code ─────────────────────────────────────────────────────
    const fence = /^(\s{0,3})(`{3,}|~{3,})[ \t]*(.*)$/.exec(line);
    if (fence && (fence[2][0] === '~' || !fence[3].includes('`'))) {
      const ch = fence[2][0], len = fence[2].length, indent = fence[1].length;
      const info = fence[3].trim();
      const lang = info ? info.split(/\s+/)[0] : '';
      const closeRe = new RegExp(`^\\s{0,3}${ch === '`' ? '`' : '~'}{${len},}[ \\t]*$`);
      const buf = [];
      i++;
      while (i < N) {
        if (closeRe.test(lines[i])) { i++; break; }
        buf.push(mdDedent(lines[i], indent));
        i++;
      }
      const cls = lang ? ` class="language-${mdAttr(lang.toLowerCase())}"` : '';
      // A trailing newline inside <code> is what CommonMark/marked emit — the
      // block's last line ends with one, it isn't part of the closing fence.
      const body = buf.join('\n');
      out.push(`<pre><code${cls}>${mdEsc(body ? body + '\n' : '')}</code></pre>`);
      continue;
    }

    const t = line.trim();

    // ── box break (`*=*`, `*=*=*`, …) — renderAbout() splits cards on it ──
    if (/^(?:\*=)+\*$/.test(t)) { out.push('<!--box-break-->'); i++; continue; }

    // ── ATX heading: # … ######, optional closing # run ─────────────────
    const atx = /^(\s{0,3})(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (atx) {
      const lvl = atx[2].length;                       // one-for-one: # → h1
      const text = (atx[3] || '').replace(/[ \t]+#+[ \t]*$/, '').trim();
      const id = mdSlug(text, ctx);
      out.push(`<h${lvl} id="${mdAttr(id)}">${mdInline(text, ctx)}</h${lvl}>`);
      i++; continue;
    }

    // ── thematic rule ───────────────────────────────────────────────────
    if (/^\s{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)) {
      out.push('<hr>'); i++; continue;
    }

    // ── blockquote (nested, lazy continuation) ──────────────────────────
    if (/^\s{0,3}>/.test(line)) {
      const buf = [];
      while (i < N) {
        const l = lines[i];
        if (/^\s{0,3}>/.test(l)) { buf.push(l.replace(/^\s{0,3}>[ \t]?/, '')); i++; continue; }
        if (l.trim() && buf.length && !mdIsBlockStart(l)) { buf.push(l.trim()); i++; continue; }
        break;
      }
      out.push(`<blockquote>${mdBlocks(buf, ctx, {})}</blockquote>`);
      continue;
    }

    // ── table (GFM): header row + :--- alignment row ────────────────────
    if (line.includes('|') && i + 1 < N && lines[i + 1].includes('|')) {
      const headCells = mdSplitTableRow(line);
      const delimCells = mdSplitTableRow(lines[i + 1]);
      const isDelim = delimCells.length > 0
        && delimCells.every(c => /^:?-+:?$/.test(c.replace(/\s/g, '')));
      if (isDelim && delimCells.length === headCells.length) {
        const aligns = mdTableAligns(delimCells.map(c => c.replace(/\s/g, '')));
        const style = a => (a ? ` style="text-align:${a}"` : '');
        let html = '<div class="md-table-wrap"><table><thead><tr>'
          + headCells.map((c, k) => `<th${style(aligns[k])}>${mdInline(c, ctx)}</th>`).join('')
          + '</tr></thead><tbody>';
        i += 2;
        while (i < N && lines[i].trim() && lines[i].includes('|') && !mdIsBlockStart(lines[i])) {
          const cells = mdSplitTableRow(lines[i]);
          html += '<tr>' + headCells.map((_, k) =>
            `<td${style(aligns[k])}>${mdInline(cells[k] != null ? cells[k] : '', ctx)}</td>`).join('') + '</tr>';
          i++;
        }
        out.push(html + '</tbody></table></div>');
        continue;
      }
    }

    // ── list (bullet / ordered, nested, task items) ─────────────────────
    if (mdMatchListItem(line)) {
      const list = mdParseList(lines, i, ctx);
      out.push(list.html);
      i = list.next;
      continue;
    }

    // ── indented code (4 spaces) ────────────────────────────────────────
    if (MD_INDENT_CODE.test(line)) {
      const buf = [];
      while (i < N && (MD_INDENT_CODE.test(lines[i]) || !lines[i].trim())) {
        buf.push(lines[i].trim() ? lines[i].slice(4) : '');
        i++;
      }
      while (buf.length && !buf[buf.length - 1].trim()) buf.pop();
      const body = buf.join('\n');
      out.push(`<pre><code>${mdEsc(body ? body + '\n' : '')}</code></pre>`);
      continue;
    }

    // ── paragraph (with setext heading + hard-break lookahead) ──────────
    const para = [];
    let setext = 0;
    while (i < N) {
      const l = lines[i];
      if (!l.trim()) break;
      if (para.length) {
        const sx = /^\s{0,3}(=+|-+)[ \t]*$/.exec(l);
        if (sx) { setext = sx[1][0] === '=' ? 1 : 2; i++; break; }
        if (mdIsBlockStart(l)) break;
      }
      para.push(l.replace(/^[ ]+/, ''));
      i++;
    }
    if (para.length) {
      let text = '', prevHard = false;
      for (const p of para) {
        const hard = /(?:[ ]{2,}|\\)$/.test(p);
        let clean = p.replace(/\s+$/, '');
        if (hard) clean = clean.replace(/\\$/, '');
        if (text) text += prevHard ? '\u0000' : '\n';
        text += clean;
        prevHard = hard;
      }
      if (setext) {
        const id = mdSlug(text, ctx);
        out.push(`<h${setext} id="${mdAttr(id)}">${mdInline(text, ctx)}</h${setext}>`);
      } else if (tight) {
        out.push(mdInline(text, ctx));
      } else {
        out.push(`<p>${mdInline(text, ctx)}</p>`);
      }
    }
    if (!para.length && !setext) i++;   // never stall on a line nothing claimed
  }

  return out.join('\n');
}

/* ───────────────── reference + footnote definitions ───────────────────── */

// Both definition kinds may appear anywhere in the document (including after
// the line that uses them), so they're lifted out in a pre-pass and their
// lines blanked. Fenced code is skipped so a definition *inside* a code
// sample still renders as text.
function mdCollectDefinitions(lines, ctx) {
  let inFence = false, fenceCh = '', fenceLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (inFence) {
      if (f && f[1][0] === fenceCh && f[1].length >= fenceLen && /^\s{0,3}(?:`+|~+)[ \t]*$/.test(l)) inFence = false;
      continue;
    }
    if (f) { inFence = true; fenceCh = f[1][0]; fenceLen = f[1].length; continue; }

    const fn = /^\s{0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/.exec(l);
    if (fn) {
      let text = fn[2], j = i + 1;
      while (j < lines.length && /^ {2,}\S/.test(lines[j]) && !/^\s{0,3}\[/.test(lines[j])) {
        text += '\n' + lines[j].trim(); j++;
      }
      const id = fn[1];
      if (!ctx.fnDefs.has(id)) {
        ctx.fnDefs.set(id, text);
        ctx.fnSlug.set(id, mdSlug(id, ctx));   // the fn-/fnref- prefixes are added at emit time
      }
      for (let k = i; k < j; k++) lines[k] = '';
      i = j - 1;
      continue;
    }

    const ref = /^\s{0,3}\[([^\]]+)\]:[ \t]*(\S+)(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/.exec(l);
    if (ref && !ref[1].startsWith('^')) {
      const key = ref[1].trim().toLowerCase().replace(/\s+/g, ' ');
      const title = ref[3] != null ? ref[3] : ref[4] != null ? ref[4] : ref[5] != null ? ref[5] : '';
      if (!ctx.refs.has(key)) ctx.refs.set(key, { href: ref[2].replace(/^<(.*)>$/, '$1'), title });
      lines[i] = '';
      continue;
    }
  }
}

function mdRenderFootnotes(ctx) {
  if (!ctx.fnDefs.size) return '';
  const items = [];
  for (const [id, text] of ctx.fnDefs) {
    const slug = ctx.fnSlug.get(id);
    const refs = ctx.fnRefs.get(id) || [];
    const back = refs.map((refId, k) =>
      ` <a href="#${mdAttr(refId)}" class="md-fn-back" title="Back to reference ${k + 1}">\u21A9</a>`).join('');
    items.push(`<li id="fn-${mdAttr(slug)}">${mdInline(text, ctx)}${back}</li>`);
  }
  return `<section class="md-footnotes"><h2 id="footnotes">Footnotes</h2><ol>${items.join('')}</ol></section>`;
}

/* ─────────────────────────── public entry point ───────────────────────── */

// Full .md → HTML. Returns the document with `<!--box-break-->` markers left
// in place: renderAbout() splits on those so each section of ABOUT.md becomes
// its own card box (the token can't be `***` — markdown reads that as a rule).
function markdownToHtml(md) {
  const ctx = {
    refs: new Map(),        // [id]: url "title"
    fnDefs: new Map(),      // [^id]: text
    fnSlug: new Map(),
    fnRefs: new Map(),      // id → [backlink ids]
    fnOrder: [],            // id → reference numbering order
    ids: new Set(),         // every emitted id, for slug de-duplication
  };
  // Tabs are 4-column everywhere in markdown; stripping NUL/\u0001 frees them
  // up as the hard-break and escaped-pipe sentinels used above.
  const src = String(md == null ? '' : md).replace(/[\u0000\u0001]/g, '').replace(/\t/g, '    ');
  const lines = src.split(/\r\n?|\n/);
  mdCollectDefinitions(lines, ctx);
  let html = mdBlocks(lines, ctx, {});
  const notes = mdRenderFootnotes(ctx);
  if (notes) html += (html ? '\n' : '') + notes;
  return html;
}

/* ──────────────────────────── the About view ──────────────────────────── */

let _aboutCache = null;
function aboutMarkdown() {
  if (!_aboutCache) {
    _aboutCache = (async () => {
      const url = new URL((window.SCIMA_PAGE?.root || '') + 'ABOUT.md', document.baseURI).href;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    })().catch(e => { _aboutCache = null; throw e; });
  }
  return _aboutCache;
}

// Images resolve into ./home/assets/media/*, which may not hold the file yet (or
// ever). A failed load swaps in a dashed chip naming the folder, so a typo in
// ABOUT.md reads as "asset missing" instead of a broken-image glyph.
function wireAboutMedia(box) {
  if (typeof box.querySelectorAll !== 'function') return;
  box.querySelectorAll('img.md-img').forEach(img => {
    img.addEventListener('error', () => {
      if (img.dataset.mdFailed) return;
      img.dataset.mdFailed = '1';
      const chip = el('span', {
        class: 'md-img-missing',
        title: `not found: ${img.getAttribute('src') || ''}`,
      }, `🖼 ${img.getAttribute('alt') || 'image'} — not in ./home/assets/media/`);
      img.replaceWith(chip);
    }, { once: true });
  });
}

function renderAbout(c) {
  c.append(
    el('div', { class: 'section-title' }, 'About'),
    el('div', { class: 'section-sub', style: 'margin-bottom:0' }, 'haii, it\'s me, SCIMA! :3')
  );
  // Every box-break (`*=*`) section of ABOUT.md renders as its OWN card
  // box, stacked with a gap — the markdown token is the only thing that
  // decides where one box ends and the next begins.
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:14px;margin-top:20px' });
  c.appendChild(wrap);
  const mkBox = html => {
    const box = el('div', { class: 'md-body card', style: 'padding:24px 28px' });
    box.innerHTML = html;
    wireAboutMedia(box);
    return box;
  };
  wrap.appendChild(mkBox('<p>Loading…</p>'))
  aboutMarkdown()
    .then(md => {
      wrap.innerHTML = '';
      for (const part of markdownToHtml(md).split('<!--box-break-->')) {
        if (part.trim()) wrap.appendChild(mkBox(part));
      }
      if (!wrap.children.length) wrap.appendChild(mkBox('<p>ABOUT.md is empty right now — check back later.</p>'));
    })
    .catch(() => {
      wrap.innerHTML = '';
      wrap.appendChild(mkBox('<p>Couldn’t load ABOUT.md right now — check back later.</p>'));
    });
}

// Node/test seam — the browser never sees `module`, and nothing above runs
// at load time, so the renderer can be exercised headlessly:
//   node tests/markdown-about.test.mjs
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    markdownToHtml, mdInline, mdMediaUrl, mdLinkUrl, mdSafeUrl, mdPlainText, mdEsc,
  };
}
