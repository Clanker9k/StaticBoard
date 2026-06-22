// Commented by anthropic's Opus 4.8
'use strict';

// Thread watcher + reports. Provides the [star]/[!] header buttons and a
// floating, draggable, clamped watcher panel. Clicks are delegated on document
// since the panel and buttons live in different parts of the page.

const Social = (() => {
  const WATCH_KEY = 'staticboard_watch';
  const POS_KEY = 'staticboard_watcher_pos';
  const COLLAPSE_KEY = 'staticboard_watcher_collapsed';
  let initialized = false;

  // Each entry: { seen, board, title, lastCount }. unread = lastCount - seen.
  function getWatch() {
    try { return JSON.parse(localStorage.getItem(WATCH_KEY)) || {}; } catch (e) { return {}; }
  }
  function setWatch(w) {
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(w)); } catch (e) { /* quota */ }
  }
  function isWatched(id) { return getWatch()[String(id)] != null; }

  function watchThread(id, count, board, title) {
    const w = getWatch();
    w[String(id)] = {
      seen: Number(count) || 0,
      lastCount: Number(count) || 0,
      board: board || getDefaultBoardKey(),
      title: title || '',
    };
    setWatch(w);
  }
  function unwatchThread(id) {
    const w = getWatch();
    delete w[String(id)];
    setWatch(w);
  }
  function markRead(id, count) {
    const w = getWatch();
    const e = w[String(id)];
    if (!e) return;
    e.seen = Number(count) || 0;
    e.lastCount = Math.max(e.lastCount || 0, Number(count) || 0);
    setWatch(w);
  }

  function star(id, count, board, title) {
    const on = isWatched(id);
    return `<a href="#" class="watch-star${on ? ' on' : ''}" title="${on ? 'Unwatch' : 'Watch'} thread"`
      + ` data-watch="${id}" data-count="${count || 0}"`
      + ` data-board="${Utils.escHtml(board || '')}" data-title="${Utils.escHtml(title || '')}">`
      + `${on ? '[★]' : '[☆]'}</a>`;
  }
  function reportButton(id) {
    return `<a href="#" class="report-btn" title="Report post" data-report="${id}">[!]</a>`;
  }

  function refreshStars(id) {
    const on = isWatched(id);
    document.querySelectorAll(`a.watch-star[data-watch="${CSS.escape(String(id))}"]`).forEach((s) => {
      s.classList.toggle('on', on);
      s.textContent = on ? '[★]' : '[☆]';
      s.title = `${on ? 'Unwatch' : 'Watch'} thread`;
    });
  }

  async function report(id) {
    const reason = prompt(`Report post No.${id}\nReason (optional):`);
    if (reason === null) return;            // cancelled
    try {
      await API.createReport(id, reason && reason.trim() ? reason.trim() : null);
      alert('Thanks — reported.');
    } catch (e) {
      const m = (e && e.message) || '';
      if (e && (e.code === '23505' || /duplicate/i.test(m))) alert('You already reported that post.');
      else if (/report_rate/.test(m)) alert('Too many reports — slow down.');
      else alert('Could not report: ' + m);
    }
  }

  function watcherCollapsed() { return !!localStorage.getItem(COLLAPSE_KEY); }

  // liveIds (when given) marks which watched threads still exist; the rest show "(gone)".
  function watcherHTML(ids, w, liveIds) {
    const rows = ids.map((id) => {
      const e = w[id] || {};
      const gone = liveIds && !liveIds.has(String(id));
      if (gone) {
        return `<div class="watch-item dead">`
          + `<a class="watch-link" title="deleted">No.${Utils.escHtml(id)} (gone)</a>`
          + `<a href="#" class="watch-x" title="Unwatch" data-unwatch="${Utils.escHtml(id)}">✕</a></div>`;
      }
      const title = e.title ? Utils.escHtml(e.title) : 'No subject';
      const unread = Math.max(0, (e.lastCount || 0) - (e.seen || 0));
      const href = `/board.html?board=${encodeURIComponent(e.board || getDefaultBoardKey() || '')}&thread=${encodeURIComponent(id)}`;
      return `<div class="watch-item">`
        + `<a href="${href}" class="watch-link" title="${title}">No.${Utils.escHtml(id)} — ${title}`
        + `${unread ? ` <span class="watch-unread">(${unread})</span>` : ''}</a>`
        + `<a href="#" class="watch-x" title="Unwatch" data-unwatch="${Utils.escHtml(id)}">✕</a></div>`;
    }).join('');

    return `<div class="watcher-head"><span class="watcher-title">Watched (${ids.length})</span>`
      + `<span class="watcher-collapse" data-collapse>${watcherCollapsed() ? '[+]' : '[–]'}</span></div>`
      + `<div class="watcher-body">${rows || '<div class="watcher-empty">No watched threads.</div>'}</div>`;
  }

  function paint(panel, html) {
    if (panel.__html === html) return;      // skip needless reflow
    panel.__html = html;
    panel.innerHTML = html;
  }

  async function renderWatcher() {
    const w = getWatch();
    const ids = Object.keys(w);
    let panel = document.getElementById('thread-watcher');

    if (!ids.length) { if (panel) panel.remove(); return; }
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'thread-watcher';
      document.body.appendChild(panel);
      makeDraggable(panel);
    }
    panel.classList.toggle('collapsed', watcherCollapsed());

    paint(panel, watcherHTML(ids, w));      // instant from storage, then revalidate
    try {
      const live = await API.getThreadsByIds(ids);
      const liveIds = new Set(live.map((r) => String(r.id)));
      const next = getWatch();
      live.forEach((r) => {
        const e = next[String(r.id)];
        if (e) { e.lastCount = r.reply_count || 0; if (r.title) e.title = r.title; }
      });
      setWatch(next);
      paint(panel, watcherHTML(Object.keys(next), next, liveIds));
    } catch (e) { /* keep cached paint */ }
  }

  function toggleCollapse() {
    const collapsed = !watcherCollapsed();
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : ''); } catch (e) { /* quota */ }
    const panel = document.getElementById('thread-watcher');
    if (!panel) return;
    panel.classList.toggle('collapsed', collapsed);
    const c = panel.querySelector('[data-collapse]');
    if (c) c.textContent = collapsed ? '[+]' : '[–]';
  }

  // Keep the panel on-screen and draggable by its header.
  function clamp(panel, x, y) {
    const maxX = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - 28);   // keep the header reachable
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
  }
  function place(panel, x, y) {
    const c = clamp(panel, x, y);
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = `${c.x}px`;
    panel.style.top = `${c.y}px`;
  }
  function makeDraggable(panel) {
    try { const p = JSON.parse(localStorage.getItem(POS_KEY)); if (p) place(panel, p.x, p.y); } catch (e) { /* ignore */ }

    let sx, sy, ox, oy, dragging = false;
    panel.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.watcher-head') || e.target.closest('[data-collapse]')) return;
      const r = panel.getBoundingClientRect();
      ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY; dragging = true;
      place(panel, ox, oy);
      panel.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    panel.addEventListener('pointermove', (e) => {
      if (dragging) place(panel, ox + (e.clientX - sx), oy + (e.clientY - sy));
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      try {
        localStorage.setItem(POS_KEY, JSON.stringify({
          x: parseInt(panel.style.left, 10) || 0,
          y: parseInt(panel.style.top, 10) || 0,
        }));
      } catch (e) { /* ignore */ }
    };
    panel.addEventListener('pointerup', end);
    panel.addEventListener('pointercancel', end);

    window.addEventListener('resize', () => {
      if (panel.style.right !== 'auto') return;   // never dragged -> CSS anchors it
      place(panel, parseInt(panel.style.left, 10) || 0, parseInt(panel.style.top, 10) || 0);
    });
  }

  function onClick(e) {
    const starEl = e.target.closest('a.watch-star[data-watch]');
    if (starEl) {
      e.preventDefault();
      const id = starEl.dataset.watch;
      if (isWatched(id)) unwatchThread(id);
      else watchThread(id, starEl.dataset.count, starEl.dataset.board, starEl.dataset.title);
      refreshStars(id);
      renderWatcher();
      return;
    }
    const unwatch = e.target.closest('[data-unwatch]');
    if (unwatch) {
      e.preventDefault();
      unwatchThread(unwatch.dataset.unwatch);
      refreshStars(unwatch.dataset.unwatch);
      renderWatcher();
      return;
    }
    const collapse = e.target.closest('[data-collapse]');
    if (collapse) { e.preventDefault(); toggleCollapse(); return; }
    const rep = e.target.closest('[data-report]');
    if (rep) { e.preventDefault(); report(rep.dataset.report); return; }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    document.addEventListener('click', onClick);
    renderWatcher();
  }

  return { init, renderWatcher, markRead, isWatched, star, reportButton, report };
})();
