// Commented by anthropic's Opus 4.8
'use strict';

// Local state: (You)s, settings dialog, drafts, post cooldown, auto-refresh.

// ============================================================
// YOU'S
// ============================================================

const Yous = (() => {
  const STORAGE_KEY = 'yourPosts';
  let itemsCache = null;
  let itemSetCache = null;

  function normalizePostNum(raw) {
    const normalized = String(raw || '').trim();
    return /^\d+$/.test(normalized) ? normalized : null;
  }

  function setCache(items) {
    itemsCache = items;
    itemSetCache = new Set(items);
    return itemsCache;
  }

  function loadAll() {
    if (itemsCache) return itemsCache.slice();

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return setCache([]).slice();

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return setCache([]).slice();

      return setCache(Array.from(new Set(
        parsed
          .map(normalizePostNum)
          .filter(Boolean)
      )).sort((a, b) => Number(a) - Number(b))).slice();
    } catch (e) {
      console.warn('Failed to read local You posts:', e);
      return setCache([]).slice();
    }
  }

  function saveAll(items) {
    setCache(items.slice());

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.warn('Failed to save local You posts:', e);
    }
  }

  function add(postNum) {
    const normalized = normalizePostNum(postNum);
    if (!normalized) return;

    const items = loadAll();
    if (items.includes(normalized)) return;

    items.push(normalized);
    items.sort((a, b) => Number(a) - Number(b));
    saveAll(items);
  }

  function has(postNum) {
    const normalized = normalizePostNum(postNum);
    if (!normalized) return false;

    if (!itemSetCache) {
      loadAll();
    }

    return itemSetCache.has(normalized);
  }

  function clear() {
    setCache([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  function toFieldValue() {
    return loadAll().join(', ');
  }

  return {
    add,
    has,
    clear,
    toFieldValue,
  };
})();


// ============================================================
// SETTINGS
// ============================================================

const Settings = (() => {
  const STORAGE_KEY = 'boardSettings';
  const STORAGE_VERSION = 1;
  const MAX_CUSTOM_CSS_CHARS = 12000;
  const CUSTOM_CSS_STYLE_ID = 'custom-settings-css';
  const DEFAULTS = Object.freeze({
    version: STORAGE_VERSION,
    defaultName: '',
    themePreset: '',
    customCss: '',
  });

  let state = loadState();
  let initialized = false;
  let dialogEl = null;
  let inputEl = null;
  let cssEl = null;
  let presetEl = null;
  let themeNoteEl = null;
  let yousEl = null;
  let statusEl = null;
  let styleEl = null;
  let lastFocusedEl = null;

  function normalizeName(raw) {
    return Utils.sanitizeText(raw, { maxChars: 20 }).trim();
  }

  function normalizeThemePreset(raw, options = {}) {
    const { allowBlank = false, fallbackKey = DEFAULT_THEME_PRESET_KEY } = options;
    const normalized = String(raw || '').trim();
    if (!normalized) return allowBlank ? '' : getThemePresetKey('', fallbackKey);
    return getThemePresetKey(normalized, fallbackKey);
  }

  function normalizeCustomCss(raw) {
    return String(raw || '')
      .replace(/\r\n?/g, '\n')
      .slice(0, MAX_CUSTOM_CSS_CHARS)
      .trim();
  }

  function getEngineDefaultThemePreset() {
    return getThemePresetKey(CONFIG.ui.defaultThemePreset || DEFAULT_THEME_PRESET_KEY);
  }

  function sanitizeState(raw = {}) {
    return {
      version: STORAGE_VERSION,
      defaultName: normalizeName(raw.defaultName || DEFAULTS.defaultName),
      themePreset: normalizeThemePreset(raw.themePreset, { allowBlank: true }),
      customCss: normalizeCustomCss(raw.customCss || DEFAULTS.customCss),
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULTS };
      return sanitizeState(JSON.parse(raw));
    } catch (e) {
      console.warn('Failed to read settings:', e);
      return { ...DEFAULTS };
    }
  }

  function persistState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save settings:', e);
    }
  }

  function showStatus(message = '') {
    if (statusEl) statusEl.textContent = message;
  }

  function ensureStyleEl() {
    if (styleEl) return styleEl;

    styleEl = document.getElementById(CUSTOM_CSS_STYLE_ID);
    if (styleEl) return styleEl;

    styleEl = document.createElement('style');
    styleEl.id = CUSTOM_CSS_STYLE_ID;
    document.head.appendChild(styleEl);
    return styleEl;
  }

  function getCurrentBoardKey() {
    try {
      if (typeof Router !== 'undefined' && Router && typeof Router.current === 'function') {
        const current = Router.current();
        if (current && current.board && getBoardConfig(current.board)) {
          return current.board;
        }
      }
    } catch (e) {
      // Fall back to parsing the URL directly.
    }

    const params = new URLSearchParams(window.location.search);
    const board = String(params.get('board') || '').trim();
    return board && getBoardConfig(board) ? board : null;
  }

  function getEffectiveThemeState(boardKey = getCurrentBoardKey(), rawState = state) {
    const policy = getBoardThemePolicy(boardKey);

    if (policy.forcePreset) {
      return {
        ...policy,
        themePreset: policy.forcePreset,
        customCss: getThemePreset(policy.forcePreset, policy.defaultPreset).css,
        source: 'board-forced',
      };
    }

    const savedThemePreset = normalizeThemePreset(rawState.themePreset, {
      allowBlank: true,
      fallbackKey: policy.defaultPreset,
    });
    const savedCustomCss = normalizeCustomCss(rawState.customCss);

    if (savedThemePreset || savedCustomCss) {
      const themePreset = savedThemePreset || policy.defaultPreset;
      return {
        ...policy,
        themePreset,
        customCss: savedCustomCss || getThemePreset(themePreset, policy.defaultPreset).css,
        source: savedCustomCss ? 'user-custom' : 'user-preset',
      };
    }

    return {
      ...policy,
      themePreset: policy.defaultPreset,
      customCss: getThemePreset(policy.defaultPreset, policy.siteDefaultPreset).css,
      source: policy.board && policy.board.defaultThemePreset ? 'board-default' : 'site-default',
    };
  }

  function applyThemeCss(cssText) {
    ensureStyleEl().textContent = cssText || '';
  }

  function syncRouteTheme(boardKey = getCurrentBoardKey()) {
    const effectiveTheme = getEffectiveThemeState(boardKey);
    applyThemeCss(effectiveTheme.customCss);
    return effectiveTheme;
  }

  function loadPresetIntoEditor(presetKey) {
    const effectiveTheme = getEffectiveThemeState();
    const normalizedKey = normalizeThemePreset(presetKey, {
      fallbackKey: effectiveTheme.defaultPreset,
    });
    const preset = getThemePreset(normalizedKey, effectiveTheme.defaultPreset);
    if (!preset || !cssEl || !presetEl) return;

    presetEl.value = normalizedKey;
    cssEl.value = preset.css;
    showStatus('Loaded. Save to apply.');
  }

  function syncDialog() {
    if (!dialogEl || !inputEl || !cssEl || !presetEl || !themeNoteEl || !yousEl) return;
    const effectiveTheme = getEffectiveThemeState();
    const editorThemePreset = state.themePreset || effectiveTheme.themePreset;
    const editorCss = state.customCss || getThemePreset(editorThemePreset, effectiveTheme.defaultPreset).css;

    inputEl.value = state.defaultName;
    presetEl.value = editorThemePreset;
    cssEl.value = editorCss;
    yousEl.value = Yous.toFieldValue();

    if (effectiveTheme.source === 'board-forced') {
      themeNoteEl.textContent = `This board forces the ${getThemePreset(effectiveTheme.themePreset).label} preset.`;
    } else if (!state.themePreset && !state.customCss && effectiveTheme.source === 'board-default') {
      themeNoteEl.textContent = `This board defaults to the ${getThemePreset(effectiveTheme.themePreset).label} preset until you save your own theme.`;
    } else if (!state.themePreset && !state.customCss) {
      themeNoteEl.textContent = `Using the site default ${getThemePreset(effectiveTheme.themePreset).label} preset.`;
    } else {
      themeNoteEl.textContent = '';
    }
  }

  function applyDefaultName(input, options = {}) {
    if (!input) return;

    const { force = false } = options;
    const wasPrefilled = input.dataset.prefilledBySettings === '1';
    const hasValue = input.value.trim().length > 0;

    if (!state.defaultName) {
      if (force || wasPrefilled) {
        input.value = '';
      }
      delete input.dataset.prefilledBySettings;
      return;
    }

    if (force || !hasValue || wasPrefilled) {
      input.value = state.defaultName;
      input.dataset.prefilledBySettings = '1';
    }
  }

  function bindNameField(target, options = {}) {
    const input = typeof target === 'string' ? document.getElementById(target) : target;
    if (!input) return;

    if (!input.dataset.settingsBound) {
      input.dataset.settingsBound = '1';
      input.addEventListener('input', () => {
        delete input.dataset.prefilledBySettings;
      });
    }

    applyDefaultName(input, options);
  }

  function syncKnownNameFields(options = {}) {
    bindNameField('f-name', options);
    bindNameField('r-name', options);
  }

  function setState(nextState, options = {}) {
    state = sanitizeState(nextState);
    persistState();
    const appliedTheme = syncRouteTheme(options.boardKey);
    syncDialog();
    syncKnownNameFields();
    return appliedTheme;
  }

  function saveFromDialog() {
    const hadThemeOverride = Boolean(state.themePreset || state.customCss);
    const nextDefaultName = normalizeName(inputEl ? inputEl.value : '');
    const effectiveTheme = getEffectiveThemeState();
    let nextThemePreset = normalizeThemePreset(
      presetEl ? presetEl.value : effectiveTheme.defaultPreset,
      { fallbackKey: effectiveTheme.defaultPreset }
    );
    let nextCustomCss = normalizeCustomCss(cssEl ? cssEl.value : '');

    if (!hadThemeOverride) {
      const fallbackCss = normalizeCustomCss(effectiveTheme.customCss);
      if (nextThemePreset === effectiveTheme.themePreset && nextCustomCss === fallbackCss) {
        nextThemePreset = '';
        nextCustomCss = '';
      }
    }

    const changed = nextDefaultName !== state.defaultName
      || nextThemePreset !== state.themePreset
      || nextCustomCss !== state.customCss;

    const appliedTheme = setState({
      ...state,
      defaultName: nextDefaultName,
      themePreset: nextThemePreset,
      customCss: nextCustomCss,
    });

    if (!changed) {
      showStatus('No changes to save.');
      return;
    }

    showStatus(
      appliedTheme.source === 'board-forced'
        ? `Saved. This board still forces the ${getThemePreset(appliedTheme.themePreset).label} preset.`
        : 'Saved.'
    );
  }

  function clearFromDialog() {
    if (inputEl) inputEl.value = '';
    setState({
      ...state,
      defaultName: '',
    });
    showStatus('Name cleared.');
  }

  function resetThemeFromDialog() {
    if (cssEl) cssEl.value = '';
    if (presetEl) presetEl.value = getEngineDefaultThemePreset();
    setState({
      ...state,
      themePreset: '',
      customCss: '',
    });
    showStatus('Theme reset to board or site default.');
  }

  function clearYousFromDialog() {
    Yous.clear();
    syncDialog();
    if (document.getElementById('app') && typeof render === 'function') {
      render();
    }
    showStatus('You posts cleared.');
  }

  function closeDialog() {
    if (!dialogEl || dialogEl.hidden) return;

    dialogEl.hidden = true;
    document.body.classList.remove('settings-open');
    showStatus('');

    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
      lastFocusedEl.focus();
    }
  }

  function openDialog() {
    ensureDialog();

    lastFocusedEl = document.activeElement;
    syncDialog();
    showStatus('');
    dialogEl.hidden = false;
    document.body.classList.add('settings-open');

    if (inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  }

  function ensureDialog() {
    if (dialogEl) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="settings-modal" id="settings-modal" hidden>
        <div class="settings-backdrop" data-settings-close="1"></div>
        <div class="settings-panel postform-inner" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div class="postform-header">
            <span id="settings-title">Settings</span>
            <button type="button" class="close-form settings-close-btn" data-settings-close="1">[×]</button>
          </div>
          <div class="settings-panel-body compact-settings-body">
            <div class="form-row settings-form-row">
              <div class="label">Name</div>
              <div class="field-stack">
                <input id="settings-default-name" type="text" placeholder="Anonymous" maxlength="20">
              </div>
            </div>
            <div class="form-row settings-form-row settings-css-row">
              <div class="label">CSS</div>
              <div class="field-stack">
                <textarea id="settings-custom-css" class="settings-css-input" placeholder=":root {
  --fg: #1f4a7a;
  --border: #b8cade;
  --link: #22548c;
  --link-hover: #b94d31;
  --table-bg: #f7fbff;
  --body-bg: #dfe9f5;
  --post-bg: #edf4fb;
  --greentext: #2d7a45;
  --post-outline-color: #a9bfd7;
  --reply-outline-color: #9db4cc;
  --op-name: #c8e0ff;
  --op-trip: #eef6ff;
  --op-time: #dcecff;
  --op-post-num: #cfe3ff;
  --reply-header-bg: #bfd3e8;
  --reply-header-fg: #17324c;
  --reply-name: #214d78;
  --reply-trip: #355d84;
  --reply-time: #3a5d79;
  --reply-post-num: #274c70;
  --sticky: #f4d38a;
  --thread-mode: #d6eeff;
  --poster-id-bg: rgba(255, 255, 255, 0.55);
}

.reply-post .post-header {
  background: var(--reply-header-bg);
  color: var(--reply-header-fg);
}

.reply-post .post-header a {
  color: inherit;
}"></textarea>
                <select id="settings-theme-preset" class="settings-preset-select">
                  ${Object.entries(THEME_PRESETS).map(([key, preset]) =>
                    `<option value="${Utils.escHtml(key)}">${Utils.escHtml(preset.label)}</option>`
                  ).join('')}
                </select>
                <div class="settings-theme-note" id="settings-theme-note"></div>
                <div class="settings-inline-actions">
                  <button type="button" class="settings-secondary-btn" id="settings-reset-theme-btn">Reset Theme</button>
                </div>
              </div>
            </div>
            <div class="form-row settings-form-row settings-yous-row">
              <div class="label">(You)'s</div>
              <div class="field-stack">
                <textarea id="settings-yous" class="settings-yous-input" placeholder="No saved posts." readonly></textarea>
                <div class="settings-inline-actions">
                  <button type="button" class="settings-secondary-btn" id="settings-clear-yous-btn">Clear (You)'s</button>
                </div>
              </div>
            </div>
            <div class="settings-status" id="settings-status" aria-live="polite"></div>
          </div>
          <div class="form-row-submit settings-actions">
            <button type="button" class="settings-primary-btn" id="settings-save-btn">Save</button>
          </div>
        </div>
      </div>
    `.trim();

    dialogEl = wrapper.firstElementChild;
    document.body.appendChild(dialogEl);

    inputEl = dialogEl.querySelector('#settings-default-name');
    cssEl = dialogEl.querySelector('#settings-custom-css');
    presetEl = dialogEl.querySelector('#settings-theme-preset');
    themeNoteEl = dialogEl.querySelector('#settings-theme-note');
    yousEl = dialogEl.querySelector('#settings-yous');
    statusEl = dialogEl.querySelector('#settings-status');

    dialogEl.querySelectorAll('[data-settings-close]').forEach(el => {
      el.addEventListener('click', closeDialog);
    });

    dialogEl.querySelector('#settings-save-btn').addEventListener('click', saveFromDialog);
    dialogEl.querySelector('#settings-reset-theme-btn').addEventListener('click', resetThemeFromDialog);
    dialogEl.querySelector('#settings-clear-yous-btn').addEventListener('click', clearYousFromDialog);
    presetEl.addEventListener('change', () => {
      loadPresetIntoEditor(presetEl.value);
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveFromDialog();
      }
    });

    cssEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        saveFromDialog();
      }
    });

    syncDialog();
  }

  function ensureNavButton() {
    const nav = document.querySelector('nav');
    if (!nav) return;

    let actionsEl = nav.querySelector('.nav-actions');
    if (!actionsEl) {
      actionsEl = document.createElement('div');
      actionsEl.className = 'nav-actions';
      nav.appendChild(actionsEl);
    }

    if (actionsEl.querySelector('[data-settings-toggle]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-settings-btn';
    button.dataset.settingsToggle = '1';
    button.textContent = '[Settings]';
    button.addEventListener('click', openDialog);
    actionsEl.appendChild(button);
  }

  function handleGlobalKeydown(e) {
    if (e.key === 'Escape') {
      closeDialog();
    }
  }

  function rememberPostedName(rawName) {
    const nextDefaultName = normalizeName(rawName);
    if (!nextDefaultName) return;
    if (nextDefaultName === state.defaultName) return;

    setState({
      ...state,
      defaultName: nextDefaultName,
    });
  }

  function initUI() {
    syncRouteTheme();
    ensureNavButton();
    ensureDialog();
    syncKnownNameFields();

    if (initialized) return;
    initialized = true;

    document.addEventListener('keydown', handleGlobalKeydown);
  }

  return {
    initUI,
    openDialog,
    bindNameField,
    rememberPostedName,
    syncRouteTheme,
    getDefaultName: () => state.defaultName,
  };
})();


// ============================================================
// DRAFTS
// ============================================================

const Drafts = (() => {
  const THREAD_PREFIX = 'draft:thread:';
  const REPLY_PREFIX = 'draft:reply:';

  function threadKey(board) {
    return `${THREAD_PREFIX}${String(board || '').trim()}`;
  }

  function replyKey(board, threadId) {
    return `${REPLY_PREFIX}${String(board || '').trim()}:${String(threadId || '').trim()}`;
  }

  function normalizeThreadDraft(raw = {}) {
    return {
      subject: Utils.sanitizeText(raw.subject || '', { maxChars: CONFIG.posts.maxSubjectChars }),
      body: Utils.sanitizeText(raw.body || '', { preserveNewlines: true, maxChars: CONFIG.maxBodyChars }),
      idsEnabled: Boolean(raw.idsEnabled),
    };
  }

  function normalizeReplyDraft(raw = {}) {
    return {
      body: Utils.sanitizeText(raw.body || '', { preserveNewlines: true, maxChars: CONFIG.maxBodyChars }),
      sage: Boolean(raw.sage),
    };
  }

  function read(key, normalize) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return normalize({});
      return normalize(JSON.parse(raw));
    } catch (e) {
      console.warn('Failed to read draft:', e);
      return normalize({});
    }
  }

  function hasThreadContent(draft) {
    return Boolean(String(draft.subject || '').trim() || String(draft.body || '').trim());
  }

  function hasReplyContent(draft) {
    return Boolean(String(draft.body || '').trim());
  }

  function loadThread(board) {
    return read(threadKey(board), normalizeThreadDraft);
  }

  function saveThread(board, draft) {
    const normalized = normalizeThreadDraft(draft);
    if (!hasThreadContent(normalized)) {
      clearThread(board);
      return normalized;
    }

    try {
      sessionStorage.setItem(threadKey(board), JSON.stringify(normalized));
    } catch (e) {
      console.warn('Failed to save thread draft:', e);
    }

    return normalized;
  }

  function clearThread(board) {
    sessionStorage.removeItem(threadKey(board));
  }

  function hasThreadDraft(board) {
    return hasThreadContent(loadThread(board));
  }

  function loadReply(board, threadId) {
    return read(replyKey(board, threadId), normalizeReplyDraft);
  }

  function saveReply(board, threadId, draft) {
    const normalized = normalizeReplyDraft(draft);
    if (!hasReplyContent(normalized)) {
      clearReply(board, threadId);
      return normalized;
    }

    try {
      sessionStorage.setItem(replyKey(board, threadId), JSON.stringify(normalized));
    } catch (e) {
      console.warn('Failed to save reply draft:', e);
    }

    return normalized;
  }

  function clearReply(board, threadId) {
    sessionStorage.removeItem(replyKey(board, threadId));
  }

  function hasReplyDraft(board, threadId) {
    return hasReplyContent(loadReply(board, threadId));
  }

  return {
    loadThread,
    saveThread,
    clearThread,
    hasThreadDraft,
    loadReply,
    saveReply,
    clearReply,
    hasReplyDraft,
  };
})();


// ============================================================
// FORM OPEN STATE
// ============================================================
// Remembers whether a post form was left open, per board / per thread, so a
// reload doesn't collapse it (sessionStorage = survives reload, clears on close).

const FormState = (() => {
  const THREAD_PREFIX = 'formopen:thread:';
  const REPLY_PREFIX = 'formopen:reply:';

  function key(prefix, ...parts) {
    return prefix + parts.map(p => String(p || '').trim()).join(':');
  }
  function set(k, open) {
    try { if (open) sessionStorage.setItem(k, '1'); else sessionStorage.removeItem(k); }
    catch (e) { /* ignore */ }
  }
  function get(k) {
    try { return sessionStorage.getItem(k) === '1'; } catch (e) { return false; }
  }

  return {
    setThreadOpen(board, open) { set(key(THREAD_PREFIX, board), open); },
    isThreadOpen(board) { return get(key(THREAD_PREFIX, board)); },
    setReplyOpen(board, threadId, open) { set(key(REPLY_PREFIX, board, threadId), open); },
    isReplyOpen(board, threadId) { return get(key(REPLY_PREFIX, board, threadId)); },
  };
})();


// Poster IDs are derived server-side now (see prepare_post in supabase-setup.sql).


// ============================================================
// POORLY MADE ANTISPAM
// ============================================================

const Spam = (() => {
  const KEY = 'lastPost';

  function secondsLeft() {
    const last    = parseInt(localStorage.getItem(KEY) || '0');
    const elapsed = Math.floor((Date.now() - last) / 1000);
    return Math.max(0, CONFIG.cooldown - elapsed);
  }

  function stamp() {
    localStorage.setItem(KEY, Date.now().toString());
  }

  function startCountdown(el, onDone) {
    let secs = secondsLeft();
    if (secs <= 0) { onDone && onDone(); return; }

    el.style.display = 'block';
    el.textContent   = `Wait ${secs}s before posting again.`;

    const iv = setInterval(() => {
      secs--;
      if (secs <= 0) {
        clearInterval(iv);
        el.style.display = 'none';
        onDone && onDone();
      } else {
        el.textContent = `Wait ${secs}s before posting again.`;
      }
    }, 1000);
  }

  return { secondsLeft, stamp, startCountdown };
})();


// ============================================================
// AUTO-REFRESH
// ============================================================

const AutoRefresh = (() => {
  let interval   = null;
  let lastUpdate = null;

  function start(onTick) {
    stop();
    interval = setInterval(() => {
      if (!document.hidden) onTick();
    }, CONFIG.refresh * 1000);
  }

  function stop() {
    if (interval) { clearInterval(interval); interval = null; }
  }

  function setLastUpdate(ts) { lastUpdate = ts; }
  function getLastUpdate()    { return lastUpdate; }

  return { start, stop, setLastUpdate, getLastUpdate };
})();
