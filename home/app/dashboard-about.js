'use strict';
/* dashboard-about.js — the ❓ About view: fetches ABOUT.md from the landing
   folder root and renders it under the standard view header. The file is
   resolved relative to the page (SCIMA_PAGE.root + document.baseURI, the
   same trick assetUrl() uses), so it works under the / and /dashboard/
   mount families alike, and re-reads on every load — the page always
   matches the deployed markdown, no rebuild step.

   Loads on the /about/ route only; the nav entry lives in NAV_ITEMS
   (dashboard-core.js), so single-document builds (the extension) need to
   add this file plus a #view-about container to pick the tab up. */

// Minimal, escape-first markdown subset: # – #### headings, paragraphs,
// unordered/ordered lists, > blockquotes, ``` fences, inline `code`,
// **bold**, *italic*, [links](url), --- rules. Everything is HTML-escaped
// BEFORE any tag is generated, so markdown can never inject markup.
function markdownToHtml(md) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = s => s
    .replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) =>
      /^(https?:|#|\/)/i.test(u) ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : `<a href="${u}">${t}</a>`);
  const lines = esc(md).split(/\r?\n/);
  const out = [];
  let list = null, para = [], quote = [], code = false, codeBuf = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.type}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.type}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${quote.map(q => `<p>${inline(q)}</p>`).join('')}</blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };
  for (const line of lines) {
    if (code) {
      if (/^```/.test(line.trim())) { out.push(`<pre><code>${codeBuf.join('\n')}</code></pre>`); code = false; codeBuf = []; }
      else codeBuf.push(line);
      continue;
    }
    const t = line.trim();
    if (/^```/.test(t)) { flushAll(); code = true; continue; }
    if (!t) { flushAll(); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) { flushAll(); const lvl = Math.min(h[1].length + 2, 6); out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); continue; }
    if (/^(-{3,}|\*{3,})$/.test(t)) { flushAll(); out.push('<hr>'); continue; }
    const b = /^[-*]\s+(.*)$/.exec(t);
    if (b) { flushPara(); flushQuote(); if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; } list.items.push(b[1]); continue; }
    const n = /^\d+\.\s+(.*)$/.exec(t);
    if (n) { flushPara(); flushQuote(); if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; } list.items.push(n[1]); continue; }
    const q = /^&gt;\s?(.*)$/.exec(t);
    if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }
    flushList(); flushQuote(); para.push(t);
  }
  if (code) out.push(`<pre><code>${codeBuf.join('\n')}</code></pre>`);
  flushAll();
  return out.join('\n');
}

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

function renderAbout(c) {
  c.append(
    el('div', { class: 'section-title' }, 'About'),
    el('div', { class: 'section-sub', style: 'margin-bottom:0' }, 'haii, it\'s me, SCIMA! :3')
  );
  const body = el('div', { class: 'md-body card', style: 'padding:24px 28px;margin-top:20px' });
  body.innerHTML = '<p>Loading…</p>';
  c.appendChild(body);
  aboutMarkdown()
    .then(md => { body.innerHTML = markdownToHtml(md); })
    .catch(() => { body.innerHTML = '<p>Couldn’t load ABOUT.md right now — check back later.</p>'; });
}
