// Commented by anthropic's Opus 4.8
'use strict';

// Shared state for the view modules. Request tokens guard against stale async
// renders winning the race after navigation.
const ViewsState = {
  currentThreadIssue: null,
  postHighlightTimeout: null,
  lastFocusedTarget: '',
  currentThreadPostsByNum: new Map(),
  currentThreadQuoteMap: new Map(),
  currentBoardIssues: [],
  currentBoardIssuesByNum: new Map(),
  currentBoardQuoteMap: new Map(),
  currentBoardIssueSignature: '',
  quotePreviewEl: null,
  activePreviewLink: null,
  activePreviewToken: 0,
  boardRequestToken: 0,
  threadRequestToken: 0,
  boardHydrationToken: 0,
  boardRefreshNoticeTimeout: null,
  BOARD_CACHE_PREFIX: 'boardIssuesCache:',
};

const ViewCore = (() => {
  function clearBoardPreviewState() {
    ViewsState.currentBoardIssues = [];
    ViewsState.currentBoardIssuesByNum = new Map();
    ViewsState.currentBoardQuoteMap = new Map();
    ViewsState.currentBoardIssueSignature = '';
  }

  function clearThreadPreviewState() {
    ViewsState.currentThreadPostsByNum = new Map();
    ViewsState.currentThreadQuoteMap = new Map();
  }

  function updateCharCounter(textareaId, counterId, maxChars = CONFIG.maxBodyChars) {
    const textarea = document.getElementById(textareaId);
    const counter = document.getElementById(counterId);
    if (!textarea || !counter) return;

    const len = textarea.value.length;
    counter.textContent = `${len}/${maxChars}`;
    counter.classList.toggle('is-limit', len >= maxChars);
  }

  function bindCharCounter(textareaId, counterId, maxChars = CONFIG.maxBodyChars) {
    const textarea = document.getElementById(textareaId);
    if (!textarea) return;

    const update = () => updateCharCounter(textareaId, counterId, maxChars);
    textarea.addEventListener('input', update);
    update();
  }

  function buildBoardCacheKey(board) {
    return `${ViewsState.BOARD_CACHE_PREFIX}${board}`;
  }

  function loadCachedBoardIssues(board) {
    try {
      const raw = sessionStorage.getItem(buildBoardCacheKey(board));
      if (!raw) return null;

      const cached = JSON.parse(raw);
      return cached && Array.isArray(cached.issues) ? cached.issues : null;
    } catch (e) {
      console.warn('Failed to read cached board issues:', e);
      return null;
    }
  }

  function saveCachedBoardIssues(board, issues) {
    try {
      sessionStorage.setItem(buildBoardCacheKey(board), JSON.stringify({
        savedAt: Date.now(),
        issues,
      }));
    } catch (e) {
      console.warn('Failed to cache board issues:', e);
    }
  }

  function createBoardIssueSignature(issues) {
    // Include state fields so a thread changing from open -> completed forces a
    // board rerender even if its post count did not change. bump_at and
    // last_reply_at are engine-derived activity fields, so they also need to
    // participate or manual refresh can miss sage/non-sage updates.
    return issues.map(issue => [
      issue.number,
      issue.state || '',
      issue.state_reason || '',
      issue.updated_at || '',
      issue.bump_at || '',
      issue.last_reply_at || '',
      issue.comments || 0,
      issue.isPinned ? '1' : '0',
    ].join(':')).join('|');
  }

  function setBoardRefreshNotice(message) {
    const indicatorEl = document.getElementById('board-refresh-indicator');
    if (!indicatorEl) return;

    if (ViewsState.boardRefreshNoticeTimeout) {
      clearTimeout(ViewsState.boardRefreshNoticeTimeout);
      ViewsState.boardRefreshNoticeTimeout = null;
    }

    indicatorEl.textContent = message;
    indicatorEl.style.display = 'inline-flex';
    indicatorEl.style.visibility = 'visible';
  }

  function hideBoardRefreshNotice() {
    const indicatorEl = document.getElementById('board-refresh-indicator');
    if (!indicatorEl) return;

    if (ViewsState.boardRefreshNoticeTimeout) {
      clearTimeout(ViewsState.boardRefreshNoticeTimeout);
      ViewsState.boardRefreshNoticeTimeout = null;
    }

    indicatorEl.style.display = 'inline-flex';
    indicatorEl.style.visibility = 'hidden';
  }

  function showBoardRefreshNotice(message) {
    setBoardRefreshNotice(message);
    const indicatorEl = document.getElementById('board-refresh-indicator');
    if (!indicatorEl) return;

    ViewsState.boardRefreshNoticeTimeout = setTimeout(() => {
      indicatorEl.style.display = 'inline-flex';
      indicatorEl.style.visibility = 'hidden';
      ViewsState.boardRefreshNoticeTimeout = null;
    }, 4000);
  }

  function boardLinkHandler(e) {
    const link = e.target.closest('a[data-thread]');
    if (!link) return;

    e.preventDefault();
    Router.toThread(link.dataset.board, link.dataset.thread, link.dataset.hash || '');
  }

  function utilityClickHandler(e) {
    const jumpLink = e.target.closest('a[data-jump]');
    if (!jumpLink) return;

    e.preventDefault();

    if (jumpLink.dataset.jump === 'top') {
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }

    if (jumpLink.dataset.jump === 'bottom') {
      const pageBottom = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      );
      window.scrollTo({ top: pageBottom, behavior: 'auto' });
    }
  }

  function hashChangeHandler() {
    ViewThread.focusHashTarget(true);
  }

  // map a Postgres trigger error to a one-line message
  function postErrorMessage(error) {
    const text = String((error && error.message) || error || '');
    if (/rate_limited/.test(text)) return 'Slow down — you are posting too fast.';
    if (/thread_closed/.test(text)) return 'This thread is closed.';
    if (/posting_disabled/.test(text)) return 'Posting is currently disabled.';
    if (/unknown_board|no_such_thread/.test(text)) return 'That board or thread no longer exists.';
    return 'Failed to post. Please try again.';
  }

  return {
    clearBoardPreviewState,
    clearThreadPreviewState,
    updateCharCounter,
    bindCharCounter,
    loadCachedBoardIssues,
    saveCachedBoardIssues,
    createBoardIssueSignature,
    setBoardRefreshNotice,
    hideBoardRefreshNotice,
    showBoardRefreshNotice,
    boardLinkHandler,
    utilityClickHandler,
    hashChangeHandler,
    postErrorMessage,
  };
})();
