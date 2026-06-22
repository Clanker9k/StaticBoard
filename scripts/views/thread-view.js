// Commented by anthropic's Opus 4.8
'use strict';

const ViewThread = (() => {
  function buildThreadPosts(issue, comments) {
    const posts = [
      {
        data: issue,
        isReply: false,
        num: String(issue.number),
        anchorId: 'op',
      },
      ...comments.map(comment => ({
        data: comment,
        isReply: true,
        num: String(comment.id),
        anchorId: `reply-${comment.id}`,
      })),
    ];

    const quoteMap = new Map(posts.map(post => [post.num, {
      anchorId: post.anchorId,
      isOp: !post.isReply,
      isYou: Yous.has(post.num),
    }]));
    const backlinks = new Map(posts.map(post => [post.num, []]));

    posts.forEach(post => {
      // Backlinks are resolved only against posts present in the loaded thread,
      // while cross-thread previews are handled later by QuoteTargets.
      const uniqueRefs = Utils.extractQuoteRefs(post.data.body)
        .filter(ref => ref !== post.num && quoteMap.has(ref));

      post.quoteRefs = Array.from(new Set(uniqueRefs));

      post.quoteRefs.forEach(ref => {
        backlinks.get(ref).push({
          num: post.num,
          anchorId: post.anchorId,
        });
      });
    });

    posts.forEach(post => {
      post.backlinks = backlinks.get(post.num) || [];
    });

    return { posts, quoteMap };
  }

  function renderBacklinks(backlinks) {
    if (!backlinks.length) return '';
    return `
      <div class="post-backlinks">
        ${backlinks.map(link =>
          `<a class="quote-link" data-quote-num="${Utils.escHtml(link.num)}" href="#${link.anchorId}">&gt;&gt;${link.num}</a>`
        ).join(' ')}
      </div>`;
  }

  function renderPost(post, quoteMap) {
    const { data, isReply, num, anchorId, backlinks } = post;
    const meta = Utils.postMeta(data);
    const body = Utils.renderBody(data.body, quoteMap);
    const safeTitle = Utils.sanitizeText(data.title || '');
    const backlinksHtml = renderBacklinks(backlinks);
    const stickyTag = !isReply && data.isPinned ? '<span class="sticky-tag">[Pinned]</span>' : '';
    const idsTag = !isReply && meta.idsEnabled ? '<span class="thread-mode-tag">[IDs]</span>' : '';
    const closedTag = !isReply && API.isThreadClosed(data) ? '<span class="thread-mode-tag">[Closed]</span>' : '';
    const isYou = Yous.has(num);
    const headerClass = isReply ? 'post-header reply-post-header' : 'post-header';
    const timeClass = isReply ? 'post-time reply-post-time' : 'post-time';
    const numClass = isReply ? 'post-num reply-post-num' : 'post-num op-post-num';

    return `
      <div class="${isReply ? 'reply-post' : 'op-post'}" id="${anchorId}" data-post-num="${num}">
        <div class="${headerClass}">
          ${!isReply ? `<span class="post-subject">${stickyTag}${idsTag}${closedTag}${Utils.escHtml(safeTitle.slice(0, 50))}</span>` : ''}
          ${Utils.nameHtml(meta, isReply, { isYou })}
          <span class="${timeClass}" title="${Utils.fullTime(data.created_at)}">${Utils.displayTime(data.created_at)}</span>
          <span class="${numClass}">
            ${Social.reportButton(num)}
            ${!isReply ? Social.star(num, data.comments, data.board, safeTitle) : ''}
            <a href="#${anchorId}" class="post-num-link" title="Link to this post">No.</a><a href="#replyform-inner" class="post-num-quote" data-reply-to="${num}" title="Quote in reply">${num}</a>
          </span>
        </div>
        <div class="post-body">${body}</div>
        ${backlinksHtml}
      </div>`;
  }

  async function renderThreadPosts(issue, comments, requestToken = ViewsState.threadRequestToken) {
    ViewQuotePreview.hideQuotePreview();
    const { posts, quoteMap: localQuoteMap } = buildThreadPosts(issue, comments);
    // QuoteTargets extends the local thread map with cross-thread targets so
    // previews and quote links still work for references outside this page.
    const quoteMap = await QuoteTargets.build(
      posts.map(post => post.data.body),
      localQuoteMap
    );

    if (requestToken !== ViewsState.threadRequestToken) return;

    const opWrapEl = document.getElementById('op-wrap');
    const replyListEl = document.getElementById('reply-list');
    if (!opWrapEl || !replyListEl) return;

    ViewsState.currentThreadPostsByNum = new Map(posts.map(post => [post.num, post]));
    ViewsState.currentThreadQuoteMap = quoteMap;
    const [opPost, ...replyPosts] = posts;

    opWrapEl.innerHTML = renderPost(opPost, quoteMap);
    replyListEl.innerHTML = replyPosts.map(post => renderPost(post, quoteMap)).join('');
    focusHashTarget();
  }

  function focusHashTarget(force = false) {
    const hash = window.location.hash;
    if (!hash || hash === '#replyform-inner' || hash === '#view-top' || hash === '#view-bottom') return;
    const targetKey = `${window.location.search}${hash}`;
    if (!force && targetKey === ViewsState.lastFocusedTarget) return;

    const target = document.querySelector(hash);
    if (!target || !(target.classList.contains('op-post') || target.classList.contains('reply-post'))) return;

    if (ViewsState.postHighlightTimeout) {
      clearTimeout(ViewsState.postHighlightTimeout);
      ViewsState.postHighlightTimeout = null;
    }

    document.querySelectorAll('.post-highlight').forEach(el => el.classList.remove('post-highlight'));
    target.classList.add('post-highlight');
    ViewsState.lastFocusedTarget = targetKey;
    target.scrollIntoView({ block: 'center' });

    ViewsState.postHighlightTimeout = setTimeout(() => {
      target.classList.remove('post-highlight');
    }, 2500);
  }

  function openReplyFormWithQuote(num) {
    const form = document.getElementById('replyform-inner');
    const toggle = document.getElementById('toggle-reply-btn');
    const textarea = document.getElementById('r-body');
    if (!form || !toggle || !textarea) return;

    form.style.display = 'block';
    toggle.textContent = '[Close]';
    const here = Router.current();
    if (here.board && here.thread) FormState.setReplyOpen(here.board, here.thread, true);
    Settings.bindNameField('r-name');

    const quoteLine = `>>${num}`;
    const existingLines = textarea.value.replace(/\r\n?/g, '\n').split('\n');

    if (!existingLines.includes(quoteLine)) {
      const trimmed = textarea.value.trimEnd();
      textarea.value = trimmed ? `${trimmed}\n${quoteLine}\n` : `${quoteLine}\n`;
      ViewCore.updateCharCounter('r-body', 'r-body-count');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function renderClosedThreadNotice(issue) {
    // closed = readable but no new replies
    const reason = API.isCompletedThread(issue)
      ? 'This thread is closed.'
      : 'This thread is closed and cannot be replied to.';

    return `
      <div class="form-wrapper">
        <div class="postform-inner" style="display:block">
          <div class="postform-header"><span>Thread Closed</span></div>
          <div class="form-row"><div class="field-stack">${Utils.escHtml(reason)}</div></div>
        </div>
      </div>`;
  }

  async function showThread(board, threadId) {
    const app = document.getElementById('app');
    const info = getBoardConfig(board);
    if (!app || !info) return;

    const allowReplyPosting = !info.readOnly && info.allowReplyPosting;
    ViewsState.boardRequestToken++;

    buildNav(board);
    ViewCore.clearBoardPreviewState();
    ViewQuotePreview.hideQuotePreview();

    app.innerHTML = `
      <div id="view-top"></div>
      <div class="floating-jump-nav">
        <a href="#!" data-jump="top">[▲]</a>
        <a href="#!" data-jump="bottom">[▼]</a>
      </div>
      <main>
        <p class="back-link">
          <a id="back-btn" href="#!">← Return to ${Utils.escHtml(info ? info.name : board)}</a>
        </p>
        <div id="loading">Loading thread...</div>
        <div id="error-msg" style="display:none;text-align:center;padding:20px;color:var(--fg);font-size:12px">
          Thread not found or failed to load.
        </div>
        <div id="op-wrap"></div>
        <div id="reply-list" class="replies"></div>
        <div id="refresh-indicator"
          style="font-size:11px;color:#888;text-align:right;padding:4px 10px;display:none"></div>
        <hr style="margin:10px 0">
        <div id="reply-form-wrap" style="display:none">
          ${allowReplyPosting ? `
            <div class="form-wrapper">
              <a class="post-button" id="toggle-reply-btn" href="#!">[Post a Reply]</a>
              <div class="postform-inner" id="replyform-inner" style="display:none">
                <div class="postform-header">
                  <span>Post a Reply</span>
                  <a class="close-form" id="close-replyform" href="#!">[×]</a>
                </div>
                <div class="form-row">
                  <div class="label">Name</div>
                  <input id="r-name" type="text" placeholder="${Utils.escHtml(CONFIG.posts.defaultName)}" style="max-width:220px" maxlength="20">
                </div>
                <div class="form-row">
                  <div class="label">Comment</div>
                  <div class="field-stack">
                    <textarea id="r-body" placeholder="${Utils.escHtml(info.replyCommentPlaceholder)}" maxlength="${CONFIG.maxBodyChars}"></textarea>
                    <div class="char-counter" id="r-body-count">0/${CONFIG.maxBodyChars}</div>
                  </div>
                </div>
                <div class="form-row-submit">
                  <input id="r-submit" type="submit" value="Reply">
                  <label><input id="r-sage" type="checkbox"> No-Bump</label>
                  <span class="pro-tip">[Pro Tip: ${Utils.escHtml(Utils.proTip())}]</span>
                  <div id="cooldown-msg"></div>
                </div>
              </div>
            </div>
          ` : info.readOnly ? `
            <div class="form-wrapper">
              <div class="postform-inner" style="display:block">
                <div class="postform-header"><span>Read-Only Board</span></div>
                <div class="form-row"><div class="field-stack">${Utils.escHtml(info.repliesDisabledMessage)}</div></div>
              </div>
            </div>
          ` : ''}
        </div>
        <div id="view-bottom"></div>
      </main>`;

    document.getElementById('back-btn').onclick = (e) => {
      e.preventDefault();
      Router.toBoard(board);
    };

    const toggleReplyBtn = document.getElementById('toggle-reply-btn');
    const closeReplyBtn = document.getElementById('close-replyform');
    const submitReplyBtn = document.getElementById('r-submit');
    const replyBodyField = document.getElementById('r-body');
    const replySageField = document.getElementById('r-sage');
    const replyFormInner = document.getElementById('replyform-inner');

    const openReplyForm = () => {
      if (!replyFormInner || !toggleReplyBtn) return;
      replyFormInner.style.display = 'block';
      toggleReplyBtn.textContent = '[Close]';
      FormState.setReplyOpen(board, threadId, true);
      Settings.bindNameField('r-name');
    };

    const closeReplyForm = () => {
      if (!replyFormInner || !toggleReplyBtn) return;
      replyFormInner.style.display = 'none';
      toggleReplyBtn.textContent = '[Post a Reply]';
      FormState.setReplyOpen(board, threadId, false);
    };

    const saveReplyDraft = () => {
      if (!replyBodyField || !replySageField) return;

      Drafts.saveReply(board, threadId, {
        body: replyBodyField.value,
        sage: replySageField.checked,
      });
    };

    if (toggleReplyBtn) {
      toggleReplyBtn.onclick = (e) => {
        e.preventDefault();
        if (!replyFormInner) return;
        const open = replyFormInner.style.display === 'none';
        if (open) {
          openReplyForm();
        } else {
          closeReplyForm();
        }
      };
    }

    if (closeReplyBtn) {
      closeReplyBtn.onclick = (e) => {
        e.preventDefault();
        closeReplyForm();
      };
    }

    app.removeEventListener('click', ViewCore.boardLinkHandler);
    app.removeEventListener('click', threadClickHandler);
    app.removeEventListener('click', ViewCore.utilityClickHandler);
    app.addEventListener('click', ViewCore.boardLinkHandler);
    app.addEventListener('click', threadClickHandler);
    app.addEventListener('click', ViewCore.utilityClickHandler);
    window.removeEventListener('hashchange', ViewCore.hashChangeHandler);
    window.addEventListener('hashchange', ViewCore.hashChangeHandler);

    ViewQuotePreview.init();
    Social.init();

    if (submitReplyBtn) {
      submitReplyBtn.onclick = () => submitReply(board, threadId);
      ViewCore.bindCharCounter('r-body', 'r-body-count');
      Settings.bindNameField('r-name');
    }

    const savedReplyDraft = Drafts.loadReply(board, threadId);
    if (replyBodyField) {
      replyBodyField.value = savedReplyDraft.body;
      ViewCore.updateCharCounter('r-body', 'r-body-count');
      replyBodyField.addEventListener('input', saveReplyDraft);
    }
    if (replySageField) {
      replySageField.checked = savedReplyDraft.body ? savedReplyDraft.sage : false;
      replySageField.addEventListener('change', saveReplyDraft);
    }

    if (savedReplyDraft.body || FormState.isReplyOpen(board, threadId)) {
      openReplyForm();
    }

    await fetchThread(threadId, board);
    AutoRefresh.start(() => refreshReplies(threadId));
  }

  async function fetchThread(threadId, board) {
    const requestToken = ++ViewsState.threadRequestToken;
    ViewCore.clearThreadPreviewState();

    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error-msg');
    const replyFormWrapEl = document.getElementById('reply-form-wrap');

    if (!loadingEl || !errorEl || !replyFormWrapEl) return;

    try {
      const [issue, comments] = await Promise.all([
        API.getThread(threadId),
        API.getReplies(threadId),
      ]);

      if (requestToken !== ViewsState.threadRequestToken) return;

      ViewsState.currentThreadIssue = issue;

      loadingEl.style.display = 'none';
      await renderThreadPosts(issue, comments, requestToken);
      if (requestToken !== ViewsState.threadRequestToken) return;
      const boardConfig = getBoardConfig(board);
      if (API.isThreadClosed(issue)) {
        replyFormWrapEl.innerHTML = renderClosedThreadNotice(issue);
        replyFormWrapEl.style.display = 'block';
      } else if (boardConfig && !boardConfig.readOnly && boardConfig.allowReplyPosting) {
        replyFormWrapEl.style.display = 'block';
      }

      document.title = `${issue.title} — BoardEngine`;

      AutoRefresh.setLastUpdate(
        comments.length ? comments[comments.length - 1].created_at : issue.created_at
      );
      syncWatchRead(threadId, comments);
    } catch (e) {
      if (requestToken !== ViewsState.threadRequestToken) return;
      loadingEl.style.display = 'none';
      errorEl.style.display = 'block';
      console.error(e);
    }
  }

  // viewing a watched thread clears its unread
  function syncWatchRead(threadId, comments) {
    if (!Social.isWatched(threadId)) return;
    Social.markRead(threadId, comments.length);
    Social.renderWatcher();
  }

  function threadClickHandler(e) {
    const replyLink = e.target.closest('a[data-reply-to]');
    if (!replyLink) return;

    e.preventDefault();
    openReplyFormWithQuote(replyLink.dataset.replyTo);
  }

  async function refreshReplies(threadId) {
    const requestToken = ViewsState.threadRequestToken;

    try {
      const comments = await API.getReplies(threadId);
      if (requestToken !== ViewsState.threadRequestToken) return;

      const lastKnown = AutoRefresh.getLastUpdate();
      const newOnes = comments.filter(c => c.created_at > lastKnown);

      if (!newOnes.length) return;

      if (ViewsState.currentThreadIssue) {
        await renderThreadPosts(ViewsState.currentThreadIssue, comments, requestToken);
        if (requestToken !== ViewsState.threadRequestToken) return;
      }
      AutoRefresh.setLastUpdate(newOnes[newOnes.length - 1].created_at);
      syncWatchRead(threadId, comments);

      const ind = document.getElementById('refresh-indicator');
      if (ind) {
        ind.style.display = 'block';
        ind.textContent = `${newOnes.length} new repl${newOnes.length === 1 ? 'y' : 'ies'} — updated just now`;
        setTimeout(() => { ind.style.display = 'none'; }, 4000);
      }
    } catch (e) {
      console.warn('Auto-refresh failed:', e);
    }
  }

  async function submitReply(board, threadId) {
    const boardConfig = getBoardConfig(board);
    if (!boardConfig || boardConfig.readOnly || !boardConfig.allowReplyPosting) {
      alert('Replies are disabled on this board.');
      return;
    }
    // Guard reply submission separately from the rendered form so a stale UI
    // cannot post into a thread that was closed after the page loaded.
    if (ViewsState.currentThreadIssue && API.isThreadClosed(ViewsState.currentThreadIssue)) {
      alert('This thread is closed.');
      return;
    }

    const requestToken = ViewsState.threadRequestToken;
    const secs = Spam.secondsLeft();
    if (secs > 0) {
      Spam.startCountdown(document.getElementById('cooldown-msg'));
      return;
    }

    const rawName = document.getElementById('r-name').value;
    const rawBody = document.getElementById('r-body').value;
    const body = Utils.sanitizeText(rawBody, { preserveNewlines: true }).trim();
    const sage = document.getElementById('r-sage').checked;

    if (body.length > CONFIG.maxBodyChars) { alert(`Post is too long. Max ${CONFIG.maxBodyChars} characters.`); return; }
    if (body.length < CONFIG.posts.minBodyChars) { alert('Post is too short.'); return; }

    const btn = document.getElementById('r-submit');
    btn.disabled = true;
    btn.value = 'Posting...';

    try {
      // trip + poster ID computed server-side
      const createdReply = await API.createReply(board, threadId, {
        body,
        name: Utils.sanitizeName(rawName) || null,
        sage,
      });
      if (requestToken !== ViewsState.threadRequestToken) return;

      Spam.stamp();
      Settings.rememberPostedName(rawName);
      Yous.add(createdReply && createdReply.id);
      Drafts.clearReply(board, threadId);
      document.getElementById('r-name').value = '';
      document.getElementById('r-body').value = '';
      ViewCore.updateCharCounter('r-body', 'r-body-count');
      document.getElementById('r-sage').checked = false;
      FormState.setReplyOpen(board, threadId, false);
      const replyFormInner = document.getElementById('replyform-inner');
      if (replyFormInner) replyFormInner.style.display = 'none';
      const toggleReplyBtn = document.getElementById('toggle-reply-btn');
      if (toggleReplyBtn) toggleReplyBtn.textContent = '[Post a Reply]';

      const comments = await API.getReplies(threadId);
      if (requestToken !== ViewsState.threadRequestToken) return;

      if (ViewsState.currentThreadIssue) {
        await renderThreadPosts(ViewsState.currentThreadIssue, comments, requestToken);
        if (requestToken !== ViewsState.threadRequestToken) return;
      }
      if (comments.length) {
        AutoRefresh.setLastUpdate(comments[comments.length - 1].created_at);
      }
      syncWatchRead(threadId, comments);
    } catch (e) {
      alert(ViewCore.postErrorMessage(e));
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.value = 'Reply';
    }
  }

  return {
    showThread,
    focusHashTarget,
    threadClickHandler,
  };
})();
