// Commented by anthropic's Opus 4.8
'use strict';

// Hover quote previews. A stack of popups (root -> deepest): the mouse can
// travel into a preview and onto the quote links inside it, each opening the
// next popup. A short close delay + "is the pointer still in the chain?" check
// keeps the right popups alive. Listeners are delegated on document because the
// popups live in <body>, outside #app.
const ViewQuotePreview = (() => {
  const chain = [];                 // [{ link, el }] from root to deepest
  let closeTimer = null;
  let pointer = { x: 0, y: 0 };
  let initialized = false;

  function makePopup() {
    const el = document.createElement('div');
    el.className = 'quote-preview-popup';
    document.body.appendChild(el);
    return el;
  }

  function teardownFrom(index) {
    for (let i = chain.length - 1; i >= index; i--) {
      const { el } = chain[i];
      if (el && el.parentNode) el.parentNode.removeChild(el);
      chain.pop();
    }
  }

  function cancelClose() {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  }

  function hideQuotePreview() {
    cancelClose();
    teardownFrom(0);
    ViewsState.activePreviewLink = null;
  }

  // Deepest chain entry whose link or popup is under the pointer; below it is stale.
  function deepestHoveredIndex() {
    const el = document.elementFromPoint(pointer.x, pointer.y);
    if (!el) return -1;
    let keep = -1;
    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];
      if (entry.el.contains(el) || entry.link === el || (entry.link.contains && entry.link.contains(el))) {
        keep = i;
      }
    }
    return keep;
  }

  function scheduleClose() {
    cancelClose();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      teardownFrom(deepestHoveredIndex() + 1);
      if (!chain.length) ViewsState.activePreviewLink = null;
    }, 150);
  }

  function positionPopup(el, link) {
    const r = link.getBoundingClientRect();
    const gap = 4;
    const maxLeft = Math.max(8, window.innerWidth - el.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - el.offsetHeight - 8);
    const left = Math.min(Math.max(8, r.left), maxLeft);
    const below = r.bottom + gap + el.offsetHeight <= window.innerHeight - 8;
    const top = below
      ? Math.min(r.bottom + gap, maxTop)
      : Math.max(8, r.top - el.offsetHeight - gap);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function renderQuotePreviewPost(post, quoteMap) {
    const { data, isReply, num } = post;
    const meta = Utils.postMeta(data);
    const safeTitle = Utils.sanitizeText(data.title || '');
    const body = Utils.renderPreview(data.body, 500, 8, quoteMap);
    const stickyTag = !isReply && data.isPinned ? '<span class="sticky-tag">[Pinned]</span>' : '';
    const idsTag = !isReply && meta.idsEnabled ? '<span class="thread-mode-tag">[IDs]</span>' : '';
    const isYou = Yous.has(num);
    const headerClass = isReply ? 'post-header reply-post-header' : 'post-header';
    const timeClass = isReply ? 'post-time reply-post-time' : 'post-time';
    const numClass = isReply ? 'post-num reply-post-num' : 'post-num op-post-num';
    const truncatedHtml = body.truncated
      ? '<div class="quote-preview-note">Preview truncated.</div>'
      : '';

    return `
      <div class="quote-preview-card">
        <div class="${isReply ? 'reply-post' : 'op-post'} quote-preview-post">
          <div class="${headerClass}">
            ${!isReply ? `<span class="post-subject">${stickyTag}${idsTag}${Utils.escHtml(safeTitle.slice(0, 50))}</span>` : ''}
            ${Utils.nameHtml(meta, isReply, { isYou })}
            <span class="${timeClass}" title="${Utils.fullTime(data.created_at)}">${Utils.displayTime(data.created_at)}</span>
            <span class="${numClass}">No.${num}</span>
          </div>
          <div class="post-body">${body.html || '<em style="color:#aaa">No text.</em>'}</div>
          ${truncatedHtml}
        </div>
      </div>`;
  }

  function getLocalQuotePreview(num) {
    const key = String(num);

    if (ViewsState.currentThreadPostsByNum.has(key)) {
      return {
        post: ViewsState.currentThreadPostsByNum.get(key),
        quoteMap: ViewsState.currentThreadQuoteMap,
      };
    }

    if (ViewsState.currentBoardIssuesByNum.has(key)) {
      return {
        post: {
          data: ViewsState.currentBoardIssuesByNum.get(key),
          isReply: false,
          num: key,
          anchorId: 'op',
          backlinks: [],
        },
        quoteMap: ViewsState.currentBoardQuoteMap,
      };
    }

    return null;
  }

  async function loadQuotePreview(num) {
    return getLocalQuotePreview(num) || QuoteTargets.loadPreview(num);
  }

  // Open (or keep) the preview for `link`; its depth is one past the popup it sits in.
  async function showFor(link) {
    const num = link.dataset.quoteNum;
    if (!num) return;
    cancelClose();

    let parentIndex = -1;
    for (let i = 0; i < chain.length; i++) {
      if (chain[i].el.contains(link)) parentIndex = i;
    }
    const depth = parentIndex + 1;

    if (chain[depth] && chain[depth].link === link) {   // same link already open here
      teardownFrom(depth + 1);
      return;
    }

    teardownFrom(depth);                 // drop stale siblings/children

    const el = makePopup();
    const entry = { link, el };
    chain.push(entry);
    ViewsState.activePreviewLink = link;

    el.innerHTML = '<div class="quote-preview-loading">Loading...</div>';
    positionPopup(el, link);

    const preview = await loadQuotePreview(num);
    if (!chain.includes(entry)) return;  // torn down while loading

    if (!preview) {
      teardownFrom(chain.indexOf(entry));
      return;
    }

    el.innerHTML = renderQuotePreviewPost(preview.post, preview.quoteMap);
    positionPopup(el, link);             // height changed after load
  }

  function quoteLinkFrom(node) {
    return node && node.closest ? node.closest('a.quote-link[data-quote-num]') : null;
  }
  function popupFrom(node) {
    return node && node.closest ? node.closest('.quote-preview-popup') : null;
  }

  function onOver(e) {
    const link = quoteLinkFrom(e.target);
    if (link) { cancelClose(); showFor(link); return; }
    if (popupFrom(e.target)) cancelClose();
  }

  function onOut(e) {
    if (quoteLinkFrom(e.target) || popupFrom(e.target)) scheduleClose();
  }

  function onMove(e) {
    pointer = { x: e.clientX, y: e.clientY };
  }

  function onFocusIn(e) {
    const link = quoteLinkFrom(e.target);
    if (link) { cancelClose(); showFor(link); }
  }

  function onFocusOut(e) {
    if (quoteLinkFrom(e.target)) scheduleClose();
  }

  function init() {
    if (initialized) return;
    initialized = true;
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('click', (e) => { if (quoteLinkFrom(e.target)) hideQuotePreview(); });
    window.addEventListener('scroll', () => { if (chain.length) hideQuotePreview(); }, true);
  }

  return { init, hideQuotePreview };
})();
