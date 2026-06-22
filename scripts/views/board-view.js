// Commented by anthropic's Opus 4.8
'use strict';

const ViewBoard = (() => {
  // click a card (not a link/button) opens the thread
  function cardClickHandler(e) {
    if (e.target.closest('a, button, input, textarea, label, .watch-star, .report-btn, .quote-link')) return;
    if (window.getSelection && String(window.getSelection())) return;   // ignore text selections
    const card = e.target.closest('.thread[data-thread]');
    if (!card) return;
    Router.toThread(card.dataset.board, card.dataset.thread);
  }

  function renderThreadCard(issue, board, options = {}) {
    const { searchMatches = [], quoteMap = null } = options;
    const meta = Utils.postMeta(issue);
    const previewData = Utils.renderPreview(issue.body, CONFIG.previewChars, CONFIG.previewLines, quoteMap);
    const replies = issue.comments;
    const lastReplyAt = replies > 0
      ? (issue.last_reply_at || issue.updated_at || issue.created_at)
      : null;
    const isClosed = API.isThreadClosed(issue);
    const safeTitle = Utils.sanitizeText(issue.title);
    const searchMatchesHtml = ViewBoardSearch.renderSearchMatches(searchMatches, board, issue.number);
    const stickyTag = issue.isPinned ? '<span class="sticky-tag">[Pinned]</span>' : '';
    const idsTag = meta.idsEnabled ? '<span class="thread-mode-tag">[IDs]</span>' : '';
    const closedTag = isClosed ? '<span class="thread-mode-tag">[Closed]</span>' : '';
    const lastReplyHtml = lastReplyAt
      ? `<span class="thread-last-reply" title="Last reply: ${Utils.fullTime(lastReplyAt)}">-- ${Utils.relTime(lastReplyAt)}</span>`:'';
    const truncatedNotice = previewData.truncated
      ? `<div class="post-truncation-notice">
           Post truncated.
           <a href="#" data-board="${Utils.escHtml(board)}" data-thread="${issue.number}">Open thread</a>
         </div>`
      : '';

    return `
      <div class="thread is-clickable" id="t-${issue.number}" data-board="${Utils.escHtml(board)}" data-thread="${issue.number}">
        <div class="op-post">
          <div class="post-header">
            <span class="post-subject">
              ${stickyTag}
              ${idsTag}
              ${closedTag}
              <a href="#" data-board="${Utils.escHtml(board)}" data-thread="${issue.number}">
                ${Utils.escHtml(safeTitle)}
              </a>
            </span>
            ${Utils.nameHtml(meta, false, { isYou: Yous.has(issue.number) })}
            <span class="post-time" title="${Utils.fullTime(issue.created_at)}">${Utils.displayTime(issue.created_at)}</span>
            <span class="post-num">
              ${Social.reportButton(issue.number)}
              ${Social.star(issue.number, replies, board, safeTitle)}
              No.${issue.number}
            </span>
          </div>
          <div class="post-body post-preview">
            ${previewData.html || '<em style="color:#aaa">No text.</em>'}
          </div>
          ${searchMatchesHtml}
          ${truncatedNotice}
          <div class="thread-footer">
            ${isClosed
              ? '<span class="thread-closed-notice">[Closed]</span>'
              : `<a href="#" data-board="${Utils.escHtml(board)}" data-thread="${issue.number}">[Reply]</a>`
            }
            <span class="reply-count">${replies} repl${replies === 1 ? 'y' : 'ies'}</span>
            ${lastReplyHtml}
          </div>
        </div>
      </div>`;
  }

  async function showBoard(board, searchQuery = '') {
    const app = document.getElementById('app');
    const info = getBoardConfig(board);
    if (!app || !info) return;

    const normalizedSearch = ViewBoardSearch.normalizeSearchQuery(searchQuery);
    const safeSearchValue = Utils.escHtml(normalizedSearch);
    const searchEnabled = CONFIG.search.enabled && info.searchEnabled;
    const searchMode = searchEnabled && safeSearchValue.length > 0;
    const allowThreadCreation = !info.readOnly && info.allowThreadCreation;
    const allowIds = info.allowIds;
    const forceThreadIds = info.forceThreadIds && allowIds;
    const idsDefault = info.defaultIdsEnabled == null
      ? CONFIG.posts.allowIdsByDefault
      : Boolean(info.defaultIdsEnabled);
    ViewsState.threadRequestToken++;

    buildNav(board);
    ViewsState.currentThreadIssue = null;
    ViewCore.clearThreadPreviewState();
    ViewQuotePreview.hideQuotePreview();

    app.innerHTML = `
      <div id="view-top"></div>
      <div class="floating-jump-nav">
        <a href="#!" data-jump="top">[▲]</a>
        <a href="#!" data-jump="bottom">[▼]</a>
      </div>
      <div class="board-header">
        <h1>${Utils.escHtml(info.name)}</h1>
        <p>${Utils.escHtml(info.desc)}</p>
      </div>
      <hr>

      ${allowThreadCreation ? `
        <div class="form-wrapper">
          <a class="post-button" id="toggle-form-btn" href="#!">[Start a New Thread]</a>
          <div class="postform-inner" id="postform-wrap" style="display:none">
            <div class="postform-header">
              <span>New Thread</span>
              <a class="close-form" id="close-form-btn" href="#!">[×]</a>
            </div>
            <div class="form-row">
              <div class="label">Name</div>
              <input id="f-name" type="text" placeholder="${Utils.escHtml(CONFIG.posts.defaultName)}" style="max-width:220px" maxlength="20">
            </div>
            <div class="form-row">
              <div class="label">Subject</div>
              <input id="f-subject" type="text" placeholder="${Utils.escHtml(info.threadSubjectPlaceholder)}" style="max-width:400px" maxlength="${CONFIG.posts.maxSubjectChars}">
            </div>
            <div class="form-row">
              <div class="label">Comment</div>
              <div class="field-stack">
                <textarea id="f-body" placeholder="${Utils.escHtml(info.threadCommentPlaceholder)}" maxlength="${CONFIG.maxBodyChars}"></textarea>
                <div class="char-counter" id="f-body-count">0/${CONFIG.maxBodyChars}</div>
              </div>
            </div>
            <div class="form-row-submit">
              <input id="f-submit" type="submit" value="Post">
              ${allowIds ? `<label><input id="f-ids" type="checkbox" ${idsDefault ? 'checked' : ''} ${forceThreadIds ? 'disabled' : ''}> IDs${forceThreadIds ? ' [Forced]' : ''}</label>` : ''}
              <span class="pro-tip">[Pro Tip: ${Utils.escHtml(Utils.proTip())}]</span>
              <div id="cooldown-msg"></div>
            </div>
          </div>
        </div>
      ` : info.readOnly ? `
        <div class="form-wrapper">
          <div class="postform-inner" style="display:block">
            <div class="postform-header"><span>Read-Only Board</span></div>
            <div class="form-row"><div class="field-stack">${Utils.escHtml(info.readOnlyMessage)}</div></div>
          </div>
        </div>
      ` : ''}

      <hr>
      <main>
        <div class="threads-header">
          <div class="threads-status">
            <span id="thread-count"></span>
            <span id="board-refresh-indicator" class="board-refresh-indicator" aria-live="polite"></span>
          </div>
          <div class="threads-tools">
            ${searchEnabled ? `
              <div class="board-search compact-search">
                <input id="board-search-input" type="text" value="${safeSearchValue}" placeholder="${Utils.escHtml(info.searchPlaceholder)}" maxlength="${CONFIG.search.maxQueryChars}">
                <a id="search-btn" href="#!">[Search]</a>
                ${searchMode ? '<a id="clear-search-btn" href="#!">[Clear]</a>' : ''}
              </div>
            ` : ''}
            <span class="jump-links">
              <a id="refresh-btn" href="#!">[Refresh]</a>
            </span>
          </div>
        </div>
        <div id="loading">Loading threads...</div>
        <div id="error-msg" style="display:none">Failed to load. Check the Supabase config.</div>
        <div id="thread-list"></div>
        <div id="view-bottom"></div>
      </main>`;

    const toggleFormBtn = document.getElementById('toggle-form-btn');
    const closeFormBtn = document.getElementById('close-form-btn');
    const submitThreadBtn = document.getElementById('f-submit');
    const subjectField = document.getElementById('f-subject');
    const bodyField = document.getElementById('f-body');
    const idsField = document.getElementById('f-ids');
    const formWrap = document.getElementById('postform-wrap');

    const openThreadForm = () => {
      if (!formWrap || !toggleFormBtn) return;
      formWrap.style.display = 'block';
      toggleFormBtn.textContent = '[Close Form]';
      FormState.setThreadOpen(board, true);
      Settings.bindNameField('f-name');
    };

    const closeThreadForm = () => {
      if (!formWrap || !toggleFormBtn) return;
      formWrap.style.display = 'none';
      toggleFormBtn.textContent = '[Start a New Thread]';
      FormState.setThreadOpen(board, false);
    };

    const saveThreadDraft = () => {
      if (!subjectField || !bodyField) return;

      Drafts.saveThread(board, {
        subject: subjectField.value,
        body: bodyField.value,
        idsEnabled: idsField ? idsField.checked : false,
      });
    };

    if (toggleFormBtn) {
      toggleFormBtn.onclick = (e) => {
        e.preventDefault();
        if (!formWrap) return;
        const open = formWrap.style.display === 'none';
        if (open) {
          openThreadForm();
        } else {
          closeThreadForm();
        }
      };
    }

    if (closeFormBtn) {
      closeFormBtn.onclick = (e) => {
        e.preventDefault();
        closeThreadForm();
      };
    }

    document.getElementById('refresh-btn').onclick = (e) => {
      e.preventDefault();
      fetchBoard(board, Router.current().search || '');
    };

    if (submitThreadBtn) {
      submitThreadBtn.onclick = () => submitThread(board);
      ViewCore.bindCharCounter('f-body', 'f-body-count');
      Settings.bindNameField('f-name');
    }

    if (idsField) {
      if (!allowIds) {
        idsField.checked = false;
        idsField.disabled = true;
      } else if (forceThreadIds) {
        idsField.checked = true;
        idsField.disabled = true;
      }
    }

    const savedThreadDraft = Drafts.loadThread(board);
    if (subjectField) subjectField.value = savedThreadDraft.subject;
    if (bodyField) bodyField.value = savedThreadDraft.body;
    if (idsField && !forceThreadIds) {
      idsField.checked = savedThreadDraft.subject || savedThreadDraft.body
        ? savedThreadDraft.idsEnabled
        : idsField.checked;
    }

    if (bodyField) {
      ViewCore.updateCharCounter('f-body', 'f-body-count');
      bodyField.addEventListener('input', saveThreadDraft);
    }
    if (subjectField) {
      subjectField.addEventListener('input', saveThreadDraft);
    }
    if (idsField) {
      idsField.addEventListener('change', saveThreadDraft);
    }

    if (savedThreadDraft.subject || savedThreadDraft.body || FormState.isThreadOpen(board)) {
      openThreadForm();
    }

    const searchInput = document.getElementById('board-search-input');
    const searchBtn = document.getElementById('search-btn');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const runSearch = () => {
      if (!searchInput) return;
      const nextQuery = ViewBoardSearch.normalizeSearchQuery(searchInput.value);
      Router.toBoard(board, nextQuery || null);
    };

    if (searchBtn) {
      searchBtn.onclick = (e) => {
        e.preventDefault();
        runSearch();
      };
    }

    if (clearSearchBtn) {
      clearSearchBtn.onclick = (e) => {
        e.preventDefault();
        Router.toBoard(board);
      };
    }

    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        runSearch();
      });
    }

    app.removeEventListener('click', ViewThread.threadClickHandler);
    app.removeEventListener('click', ViewCore.boardLinkHandler);
    app.removeEventListener('click', ViewCore.utilityClickHandler);
    app.removeEventListener('click', cardClickHandler);
    app.addEventListener('click', ViewCore.boardLinkHandler);
    app.addEventListener('click', ViewCore.utilityClickHandler);
    app.addEventListener('click', cardClickHandler);
    window.removeEventListener('hashchange', ViewCore.hashChangeHandler);

    ViewQuotePreview.init();
    Social.init();

    if (searchMode) {
      AutoRefresh.stop();
    } else {
      AutoRefresh.start(() => refreshBoard(board));
    }

    fetchBoard(board, searchEnabled ? normalizedSearch : '');
  }

  function buildBoardThreadQuoteMap(issues, board) {
    return new Map(issues.map(issue => [
      String(issue.number),
      createThreadQuoteTarget(board, issue.number, {
        anchorId: 'op',
        isOp: true,
        postNum: issue.number,
      }),
    ]));
  }

  async function buildBoardPreviewQuoteMap(issues, board) {
    return QuoteTargets.build(
      issues.map(issue => issue.body),
      buildBoardThreadQuoteMap(issues, board)
    );
  }

  function renderBoardIssueList(board, issues, options = {}) {
    const {
      quoteMap = buildBoardThreadQuoteMap(issues, board),
      countLabel = `${issues.length} thread${issues.length !== 1 ? 's' : ''}`,
    } = options;
    const listEl = document.getElementById('thread-list');
    const countEl = document.getElementById('thread-count');

    if (!listEl || !countEl) return;

    ViewsState.currentBoardIssues = issues.slice();
    ViewsState.currentBoardIssuesByNum = new Map(issues.map(issue => [String(issue.number), issue]));
    ViewsState.currentBoardQuoteMap = quoteMap;
    ViewsState.currentBoardIssueSignature = ViewCore.createBoardIssueSignature(issues);
    countEl.textContent = countLabel;

    if (!issues.length) {
      listEl.innerHTML =
        `<p style="text-align:center;color:#888;padding:20px;font-size:12px">${Utils.escHtml((getBoardConfig(board) || {}).emptyBoardMessage || 'No threads yet. Start one!')}</p>`;
      return;
    }

    listEl.innerHTML = issues.map(issue => renderThreadCard(issue, board, { quoteMap })).join('');
  }

  async function hydrateBoardIssueList(board, issues, requestToken, signature = ViewCore.createBoardIssueSignature(issues)) {
    if (!issues.length) return;

    const hydrationToken = ++ViewsState.boardHydrationToken;
    const quoteMap = await buildBoardPreviewQuoteMap(issues, board);

    if (requestToken !== ViewsState.boardRequestToken) return;
    if (hydrationToken !== ViewsState.boardHydrationToken) return;
    if (signature !== ViewsState.currentBoardIssueSignature) return;

    const listEl = document.getElementById('thread-list');
    if (!listEl) return;

    ViewsState.currentBoardQuoteMap = quoteMap;
    listEl.innerHTML = issues.map(issue => renderThreadCard(issue, board, { quoteMap })).join('');
  }

  async function fetchBoard(board, searchQuery = '') {
    const requestToken = ++ViewsState.boardRequestToken;
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error-msg');
    const listEl = document.getElementById('thread-list');
    const countEl = document.getElementById('thread-count');

    if (!loadingEl || !errorEl || !listEl || !countEl) return;

    loadingEl.style.display = 'block';
    loadingEl.textContent = 'Loading threads...';
    errorEl.style.display = 'none';
    listEl.innerHTML = '';
    countEl.textContent = '';
    ViewCore.clearBoardPreviewState();
    ViewQuotePreview.hideQuotePreview();

    try {
      if (searchQuery && searchQuery.trim()) {
        loadingEl.textContent = CONFIG.search.includeReplies
          ? 'Searching threads and replies...'
          : 'Searching threads...';

        const results = await ViewBoardSearch.buildSearchResults(board, searchQuery.trim());
        const previewQuoteMap = await buildBoardPreviewQuoteMap(
          results.map(result => result.issue),
          board
        );

        if (requestToken !== ViewsState.boardRequestToken) return;

        ViewsState.currentBoardIssues = results.map(result => result.issue);
        ViewsState.currentBoardIssuesByNum = new Map(
          results.map(result => [String(result.issue.number), result.issue])
        );
        ViewsState.currentBoardQuoteMap = previewQuoteMap;
        ViewsState.currentBoardIssueSignature = ViewCore.createBoardIssueSignature(ViewsState.currentBoardIssues);
        loadingEl.style.display = 'none';

        if (!results.length) {
          countEl.textContent = `0 results for "${searchQuery}"`;
          listEl.innerHTML =
            '<p style="text-align:center;color:#888;padding:20px;font-size:12px">No matching threads found.</p>';
          return;
        }

        countEl.textContent =
          `${results.length} matching thread${results.length !== 1 ? 's' : ''} for "${searchQuery}"`;
        listEl.innerHTML =
          results.map(result => renderThreadCard(result.issue, board, {
            searchMatches: result.matches,
            quoteMap: previewQuoteMap,
          })).join('');
        return;
      }

      const cachedIssues = ViewCore.loadCachedBoardIssues(board);
      if (cachedIssues) {
        renderBoardIssueList(board, cachedIssues);
        loadingEl.style.display = 'none';
        ViewCore.setBoardRefreshNotice('Updating threads...');
      }

      const issues = await API.getThreads(board, { fresh: true });

      if (requestToken !== ViewsState.boardRequestToken) return;

      ViewCore.saveCachedBoardIssues(board, issues);
      loadingEl.style.display = 'none';
      ViewCore.hideBoardRefreshNotice();
      const nextSignature = ViewCore.createBoardIssueSignature(issues);

      if (nextSignature !== ViewsState.currentBoardIssueSignature || !listEl.innerHTML.trim()) {
        renderBoardIssueList(board, issues);
      } else {
        ViewsState.currentBoardIssues = issues.slice();
        ViewsState.currentBoardIssuesByNum = new Map(issues.map(issue => [String(issue.number), issue]));
      }

      hydrateBoardIssueList(board, issues, requestToken, nextSignature);
    } catch (e) {
      if (requestToken !== ViewsState.boardRequestToken) return;
      loadingEl.style.display = 'none';
      ViewCore.hideBoardRefreshNotice();
      if (!ViewsState.currentBoardIssues.length) {
        errorEl.style.display = 'block';
      }
      console.error(e);
    }
  }

  async function refreshBoard(board) {
    const requestToken = ViewsState.boardRequestToken;

    try {
      const issues = await API.getThreads(board, { fresh: true });
      if (requestToken !== ViewsState.boardRequestToken) return;

      const nextSignature = ViewCore.createBoardIssueSignature(issues);
      if (nextSignature === ViewsState.currentBoardIssueSignature) return;

      const previousIssueNumbers = new Set(ViewsState.currentBoardIssues.map(issue => String(issue.number)));
      const newThreadCount = issues.reduce((count, issue) => {
        return previousIssueNumbers.has(String(issue.number)) ? count : count + 1;
      }, 0);

      ViewCore.saveCachedBoardIssues(board, issues);
      renderBoardIssueList(board, issues);
      hydrateBoardIssueList(board, issues, requestToken, nextSignature);

      ViewCore.showBoardRefreshNotice(
        newThreadCount > 0
          ? `${newThreadCount} new thread${newThreadCount === 1 ? '' : 's'} — updated just now`
          : 'Board updated just now'
      );
      Social.renderWatcher();
    } catch (e) {
      console.warn('Board auto-refresh failed:', e);
    }
  }

  async function submitThread(board) {
    const boardConfig = getBoardConfig(board);
    if (!boardConfig || boardConfig.readOnly || !boardConfig.allowThreadCreation) {
      alert('Posting is disabled on this board.');
      return;
    }

    const requestToken = ViewsState.boardRequestToken;
    const secs = Spam.secondsLeft();
    if (secs > 0) {
      Spam.startCountdown(document.getElementById('cooldown-msg'));
      return;
    }

    const rawName = document.getElementById('f-name').value;
    const rawSubject = document.getElementById('f-subject').value;
    const rawBody = document.getElementById('f-body').value;
    const idsField = document.getElementById('f-ids');
    const idsEnabled = boardConfig.forceThreadIds
      ? true
      : boardConfig.allowIds && idsField
        ? idsField.checked
        : false;
    const subject = Utils.sanitizeText(rawSubject, { maxChars: CONFIG.posts.maxSubjectChars }).trim();
    const body = Utils.sanitizeText(rawBody, { preserveNewlines: true }).trim();

    if (subject.length < CONFIG.posts.minSubjectChars) {
      alert('Subject is required.');
      return;
    }
    if (body.length > CONFIG.maxBodyChars) { alert(`Post is too long. Max ${CONFIG.maxBodyChars} characters.`); return; }
    if (body.length < CONFIG.posts.minBodyChars) { alert('Post is too short.'); return; }

    const btn = document.getElementById('f-submit');
    btn.disabled = true;
    btn.value = 'Posting...';

    try {
      // server computes trip + poster IDs; just send the raw fields
      const createdThread = await API.createThread(board, {
        subject,
        body,
        name: Utils.sanitizeName(rawName) || null,
        idsEnabled,
      });
      if (requestToken !== ViewsState.boardRequestToken) return;

      Spam.stamp();
      Settings.rememberPostedName(rawName);
      Yous.add(createdThread && createdThread.number);
      Drafts.clearThread(board);
      document.getElementById('f-name').value = '';
      document.getElementById('f-subject').value = '';
      document.getElementById('f-body').value = '';
      if (idsField) {
        idsField.checked = boardConfig.forceThreadIds
          ? true
          : boardConfig.defaultIdsEnabled == null
            ? CONFIG.posts.allowIdsByDefault
            : Boolean(boardConfig.defaultIdsEnabled);
      }
      ViewCore.updateCharCounter('f-body', 'f-body-count');
      FormState.setThreadOpen(board, false);
      const postformWrap = document.getElementById('postform-wrap');
      if (postformWrap) {
        postformWrap.style.display = 'none';
      }
      const toggleFormBtn = document.getElementById('toggle-form-btn');
      if (toggleFormBtn) {
        toggleFormBtn.textContent = '[Start a New Thread]';
      }
      await fetchBoard(board, Router.current().search || '');
    } catch (e) {
      alert(ViewCore.postErrorMessage(e));
      console.error(e);
    } finally {
      btn.disabled = false;
      btn.value = 'Post';
    }
  }

  return {
    showBoard,
    fetchBoard,
    refreshBoard,
    submitThread,
  };
})();
