// Commented by anthropic's Opus 4.8
'use strict';

// Version push. APP_VERSION is baked in, so a stale cached copy keeps its old
// number; the page re-fetches this file (cache-busted) to read the latest. On a
// mismatch it hard-reloads once, then nudges, and shows current/latest in the footer.
// DEPLOY: bump APP_VERSION on each upload.
const APP_VERSION = '1.0.0';

(function () {
  const SELF = '/scripts/version.js';
  function esc(s) {
    return (window.Utils && Utils.escHtml) ? Utils.escHtml(s) : String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // {cache:'reload'} refetches and overwrites the cache; the reload then loads fresh.
  async function forceReload() {
    try {
      const urls = new Set([location.href.split('#')[0]]);
      document.querySelectorAll('script[src], link[rel="stylesheet"]').forEach((n) => {
        const u = n.src || n.href;
        if (u && u.indexOf(location.origin) === 0) urls.add(u.split('#')[0]);
      });
      await Promise.all([...urls].map((u) => fetch(u, { cache: 'reload' }).catch(() => {})));
    } catch (e) { /* fall through to a plain reload */ }
    location.reload();
  }

  function warnBanner() {
    if (document.getElementById('version-warn')) return;
    const b = document.createElement('div');
    b.id = 'version-warn';
    b.innerHTML = 'Hard reload needed — <a href="#" id="hardreload">[Reload]</a> (or press <b>Ctrl+Shift+R</b>).';
    document.body.insertBefore(b, document.body.firstChild);
    const r = b.querySelector('#hardreload');
    if (r) r.addEventListener('click', (e) => { e.preventDefault(); forceReload(); });
  }

  function footerInfo(latest) {
    const footer = document.querySelector('footer');
    if (!footer) return false;
    let el = document.getElementById('version');
    if (!el) {
      el = document.createElement('div');
      el.id = 'version';
      el.className = 'version';
      footer.appendChild(el);
    }
    el.innerHTML = `Page version: ${esc(APP_VERSION)} — latest: ${esc(latest)}`;
    return true;
  }

  async function check() {
    let latest = APP_VERSION;
    try {
      const res = await fetch(SELF + '?cb=' + Date.now(), { cache: 'no-store' });
      const m = (await res.text()).match(/APP_VERSION\s*=\s*["']([^"']+)["']/);
      if (m) latest = m[1];
    } catch (e) { /* offline — assume current */ }

    if (latest !== APP_VERSION) {
      // Auto-update once per stale version per tab so a stubborn cache can't loop us.
      const tried = 'staticboard_autoupdate_' + latest;
      let already = false;
      try { already = sessionStorage.getItem(tried) === '1'; } catch (e) {}
      if (!already) {
        try { sessionStorage.setItem(tried, '1'); } catch (e) {}
        forceReload();
        return;
      }
      warnBanner();
    }

    if (footerInfo(latest)) return;
    const obs = new MutationObserver(() => { if (footerInfo(latest)) obs.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  check();
})();
