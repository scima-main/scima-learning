'use strict';
/* boot-watchdog.js — MUST be the first shared script on every page.
 *
 * Self-heals the stale-cache mix: a stale cached HTML document (browser
 * heuristic cache, or a CDN edge object predating the no-cache policy) can
 * reference script URLs that stale cached scripts answer, and the app then
 * dies mid-boot — empty nav, empty views — until someone hard-reloads.
 * This file has ZERO dependencies (so it survives whatever mix killed the
 * others): it watches for "boot never completed AND the nav never rendered"
 * a few seconds in, then recovers ONCE with a cache-busting redirect (a new
 * query string misses every cache layer). If even that fails, it renders a
 * loud force-reload card instead of leaving an empty shell.
 * dashboard-bootstrap.js flips window.__scimaBoot.ok when init() resolves.
 */
(function () {
  if (typeof window === 'undefined') return;
  var boot = window.__scimaBoot = { ok: false, err: null, v: null };
  window.addEventListener('error', function (e) {
    if (!boot.ok && !boot.err) boot.err = (e && e.message) || 'script error';
  });
  setTimeout(function () {
    if (boot.ok) return;
    // Static pages (privacy/terms/cookies) have no app shell and no
    // bootstrap — nothing to watch, never retry them.
    if (!document.getElementById('nav')) return;
    if (document.querySelector && document.querySelector('#nav .nav-btn')) return;
    var KEY = 'scima_boot_retry';
    var url;
    try { url = new URL(location.href); } catch (e) { return; }
    var safe = null;
    try { safe = window.sessionStorage; } catch (e) { /* private mode */ }
    if (safe && !safe.getItem(KEY)) {
      try { safe.setItem(KEY, String(Date.now())); } catch (e) {}
      url.searchParams.set('sc', String(Date.now()));
      try { console.warn('[SCIMA] boot incomplete — retrying with cache-busted reload'); } catch (e) {}
      location.replace(url.toString());
      return;
    }
    if (safe) { try { safe.removeItem(KEY); } catch (e) {} }
    var host = document.getElementById('main') || document.body;
    if (!host) return;
    var box = document.createElement('div');
    box.style.cssText = 'max-width:600px;margin:48px auto;padding:20px 24px;border:1px solid rgba(239,68,68,.6);background:rgba(239,68,68,.08);border-radius:12px;font-family:system-ui,sans-serif;line-height:1.6;color:#fff';
    box.innerHTML = '<strong>SCIMA couldn\u2019t start — stale cached files.</strong>' +
      '<p style="margin:8px 0 12px;font-size:13px">Your browser or network cache served a mismatched mix of old and new files. Force a clean reload:</p>' +
      '<button id="scima-force-reload" style="padding:10px 18px;border-radius:8px;border:none;background:#ef4444;color:#fff;font-weight:700;cursor:pointer">Force reload</button>' +
      (boot.err ? '<pre style="margin-top:12px;font-size:11px;opacity:.7;white-space:pre-wrap">' + String(boot.err).replace(/</g, '&lt;') + '</pre>' : '');
    host.appendChild(box);
    var b = document.getElementById('scima-force-reload');
    if (b) b.onclick = function () {
      var u = new URL(location.href);
      u.searchParams.set('sc', String(Date.now()));
      if (safe) { try { safe.removeItem(KEY); } catch (e) {} }
      location.replace(u.toString());
    };
  }, 4000);
})();
