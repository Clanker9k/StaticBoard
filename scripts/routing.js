// Commented by anthropic's Opus 4.8
'use strict';

function getBoardKeyForIssue(issue) {
  if (!issue || !issue.board) return null;
  // board column is the slug; map back to a config key
  if (getBoardConfig(issue.board)) return issue.board;
  return getBoardKeys().find(key => getBoardLabel(key) === issue.board) || null;
}

function buildThreadHref(board, threadId, hash = '') {
  const params = new URLSearchParams();
  params.set('board', board);
  params.set('thread', String(threadId));
  return `?${params.toString()}${hash || ''}`;
}

function createThreadQuoteTarget(board, threadId, options = {}) {
  const {
    anchorId = 'op',
    isOp = anchorId === 'op',
    postNum = threadId,
  } = options;
  const hash = anchorId === 'op' ? '' : `#${anchorId}`;

  return {
    href: buildThreadHref(board, threadId, hash),
    board,
    threadId: String(threadId),
    hash,
    anchorId,
    isOp,
    isYou: Yous.has(String(postNum)),
  };
}


// ============================================================
// ROUTER
// ============================================================

const Router = (() => {
  function current() {
    const p = new URLSearchParams(window.location.search);
    return {
      board:  p.get('board')  || null,
      thread: p.get('thread') || null,
      search: p.get('search') || null,
    };
  }

  function go(params) {
    const p = new URLSearchParams();
    if (params.board)  p.set('board',  params.board);
    if (params.thread) p.set('thread', params.thread);
    if (params.search) p.set('search', params.search);
    const hash = params.hash || '';
    history.pushState(params, '', '?' + p.toString() + hash);
    render();
  }

  function toBoard(board, search = null) {
    AutoRefresh.stop();
    go({ board, search });
  }

  function toThread(board, threadId, hash = '') {
    go({ board, thread: threadId, hash });
  }

  window.addEventListener('popstate', () => {
    AutoRefresh.stop();
    render();
  });

  return { current, go, toBoard, toThread };
})();

const QuoteTargets = (() => {
  const targetCache = new Map();
  const postCache = new Map();
  const previewCache = new Map();

  function getCached(cache, key, loader) {
    const cacheKey = String(key);

    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, loader().catch((error) => {
        cache.delete(cacheKey);
        throw error;
      }));
    }

    return cache.get(cacheKey);
  }

  // a >>num may be an OP or a reply; one fetch, then check .thread
  function getPost(num) {
    return getCached(postCache, num, () => API.getPost(num));
  }

  function createPreviewPost(post, quoteMap = null) {
    return {
      post,
      quoteMap,
    };
  }

  // quote link -> the post's thread page, anchored at the post
  function targetForPost(post, board) {
    const isReply = post.thread != null;
    return createThreadQuoteTarget(board, isReply ? post.thread : post.number, {
      anchorId: isReply ? `reply-${post.id}` : 'op',
      isOp: !isReply,
      postNum: post.id,
    });
  }

  async function resolveExternalTarget(num) {
    try {
      const post = await getPost(num);
      const board = getBoardKeyForIssue(post);
      if (!board) return null;
      return targetForPost(post, board);
    } catch (e) {
      return null;
    }
  }

  function resolve(num, localQuoteMap = null) {
    const key = String(num);

    if (localQuoteMap && localQuoteMap.has(key)) {
      return Promise.resolve(localQuoteMap.get(key));
    }

    if (!targetCache.has(key)) {
      targetCache.set(key, resolveExternalTarget(key));
    }

    return targetCache.get(key);
  }

  async function build(rawBodies, initialQuoteMap = new Map()) {
    const quoteMap = new Map(initialQuoteMap);
    const refs = Array.from(new Set(
      rawBodies
        .flatMap(raw => Utils.extractQuoteRefs(raw))
        .filter(ref => !quoteMap.has(ref))
    ));

    const resolved = await Promise.all(refs.map(async (ref) => {
      const target = await resolve(ref, quoteMap);
      return [ref, target];
    }));

    resolved.forEach(([ref, target]) => {
      if (target) {
        quoteMap.set(ref, target);
      }
    });

    return quoteMap;
  }

  async function loadPreview(num) {
    const key = String(num);

    if (!previewCache.has(key)) {
      previewCache.set(key, (async () => {
        try {
          const post = await getPost(key);
          const board = getBoardKeyForIssue(post);
          if (!board) return null;

          const isReply = post.thread != null;
          const previewPost = {
            data: post,
            isReply,
            num: String(post.id),
            anchorId: isReply ? `reply-${post.id}` : 'op',
            backlinks: [],
          };
          const quoteMap = await build([post.body], new Map([
            [String(post.id), targetForPost(post, board)],
          ]));
          return createPreviewPost(previewPost, quoteMap);
        } catch (e) {
          return null;
        }
      })());
    }

    return previewCache.get(key);
  }

  return { build, resolve, loadPreview };
})();


// ============================================================
// NAV
// ============================================================

function buildNav(activeBoard) {
  const navBoards = document.querySelector('.nav-boards');
  if (!navBoards) return;

  const links = getBoardKeys()
    .map((key) => [key, getBoardConfig(key)])
    .filter(([, info]) => info && info.showInNav)
    .map(([key, info]) => {
      const cls = key === activeBoard ? ' class="active"' : '';
      return `<a${cls} href="#" data-nav-board="${Utils.escHtml(key)}">${Utils.escHtml(info.name)}</a>`;
    }).join(' ');

  navBoards.innerHTML = '[ ' + links + ' ]';

  navBoards.querySelectorAll('a[data-nav-board]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      Router.toBoard(a.dataset.navBoard);
    });
  });
}
