// Commented by anthropic's Opus 4.8
'use strict';

// API — Supabase data layer. Threads + replies are rows in `posts`
// (thread IS NULL = an OP); logs live in `logs`. Methods return objects shaped
// the way the views expect (number/id, title, body, created_at, comments, meta…).

const API = (() => {
  // One client for the page. The anon key is public by design; RLS does the protecting.
  const client = window.supabase && CONFIG.supabase && CONFIG.supabase.url
    ? window.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey)
    : null;

  if (!client) {
    console.error('Supabase client unavailable. Check the CDN <script> tag and scripts/site-config.js.');
  }

  const POST_COLS =
    'id,board,thread,title,body,name,tripcode,sage,ids_enabled,poster_id,pinned,closed,created_at,bumped_at,last_reply_at,reply_count';

  function db() {
    if (!client) throw new Error('Supabase not initialised');
    return client;
  }

  // Reads work with the anon key; inserting needs an anonymous session so RLS
  // can own the row and rate-limit by it.
  let sessionPromise = null;
  async function ensureSession() {
    const { data } = await db().auth.getSession();
    if (data && data.session) return;
    if (!sessionPromise) {
      sessionPromise = db().auth.signInAnonymously().finally(() => { sessionPromise = null; });
    }
    await sessionPromise;
  }

  // Raw posts row -> the shape the views consume (works for OP and reply).
  function shapePost(row) {
    if (!row) return row;
    const closed = !!row.closed;
    const board = row.board || null;
    return {
      id: row.id,
      number: row.id,
      thread: row.thread == null ? null : row.thread,
      board,
      labels: board ? [board] : [],
      title: row.title || '',
      body: row.body || '',
      created_at: row.created_at,
      updated_at: row.bumped_at || row.created_at,
      bump_at: row.bumped_at || row.created_at,
      last_reply_at: row.last_reply_at || null,
      comments: row.reply_count || 0,
      state: closed ? 'closed' : 'open',
      state_reason: closed ? 'completed' : '',
      isClosed: closed,
      isCompleted: closed,
      isPinned: !!row.pinned,
      closed,
      meta: {
        name: row.name || 'Anonymous',
        trip: row.tripcode || null,
        sage: !!row.sage,
        idsEnabled: !!row.ids_enabled,
        posterId: row.poster_id || null,
      },
    };
  }

  function isThreadClosed(issue) {
    return !!(issue && (issue.isClosed || issue.closed || issue.state === 'closed'));
  }

  function isCompletedThread(issue) {
    return !!(issue && (issue.isCompleted || issue.closed));
  }

  async function listThreads(boardKey, limit) {
    const boardSlug = getBoardLabel(boardKey);
    let query = db()
      .from('posts')
      .select(POST_COLS)
      .eq('board', boardSlug)
      .is('thread', null)
      .order('pinned', { ascending: false })   // pinned first, then newest bump
      .order('bumped_at', { ascending: false });

    if (limit) query = query.limit(limit);

    const { data, error } = await query;
    if (error) throw new Error(`getThreads: ${error.message}`);
    return (data || []).map(shapePost);
  }

  function shapeLog(row) {
    return {
      number: row.id,
      id: row.id,
      title: row.title || '',
      body: row.body || '',
      created_at: row.created_at,
    };
  }

  return {
    client,
    ensureSession,
    isThreadClosed,
    isCompletedThread,

    // threads — `options` is accepted but ignored; Supabase reads are always live.
    async getThreads(boardKey, _options = {}) {
      return listThreads(boardKey, CONFIG.perPage);
    },

    async getAllThreads(boardKey, _options = {}) {
      return listThreads(boardKey, null);
    },

    async getBoardStats(boardKey, _options = {}) {
      const boardSlug = getBoardLabel(boardKey);
      const [{ count: total }, { count: threads }] = await Promise.all([
        db().from('posts').select('id', { count: 'exact', head: true }).eq('board', boardSlug),
        db().from('posts').select('id', { count: 'exact', head: true }).eq('board', boardSlug).is('thread', null),
      ]);
      return { threads: threads || 0, posts: total || 0 };   // posts = threads + replies
    },

    async getThread(id) {
      const { data, error } = await db()
        .from('posts')
        .select(POST_COLS)
        .eq('id', id)
        .is('thread', null)
        .maybeSingle();
      if (error) throw new Error(`getThread: ${error.message}`);
      if (!data) throw new Error('getThread: not found');
      return shapePost(data);
    },

    async getReplies(id) {
      const { data, error } = await db()
        .from('posts')
        .select(POST_COLS)
        .eq('thread', id)
        .order('created_at', { ascending: true });
      if (error) throw new Error(`getReplies: ${error.message}`);
      return (data || []).map(shapePost);
    },

    // Any post (OP or reply) by id — for resolving cross-thread quotes.
    async getPost(id) {
      const { data, error } = await db()
        .from('posts')
        .select(POST_COLS)
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`getPost: ${error.message}`);
      if (!data) throw new Error('getPost: not found');
      return shapePost(data);
    },

    async getReply(id) {
      return this.getPost(id);
    },

    async getLogs(limit = 10, page = 1) {
      const from = (Math.max(1, page) - 1) * limit;
      const { data, error } = await db()
        .from('logs')
        .select('id,title,body,created_at')
        .order('created_at', { ascending: false })
        .range(from, from + limit - 1);
      if (error) throw new Error(`getLogs: ${error.message}`);
      return (data || []).map(shapeLog);
    },

    async getAllLogs() {
      const { data, error } = await db()
        .from('logs')
        .select('id,title,body,created_at')
        .order('created_at', { ascending: false });
      if (error) throw new Error(`getAllLogs: ${error.message}`);
      return (data || []).map(shapeLog);
    },

    // Posting — the server splits name#trip, computes the tripcode and poster IDs.
    async createThread(boardKey, { subject, body, name, idsEnabled }) {
      await ensureSession();
      const { data, error } = await db()
        .from('posts')
        .insert({
          board: getBoardLabel(boardKey),
          title: subject,
          body,
          name: name || null,
          ids_enabled: !!idsEnabled,
        })
        .select('id')
        .single();
      if (error) throw new Error(`createThread: ${error.message}`);
      return { number: data.id, id: data.id };
    },

    async createReply(boardKey, threadId, { body, name, sage }) {
      await ensureSession();
      const { data, error } = await db()
        .from('posts')
        .insert({
          board: getBoardLabel(boardKey),
          thread: Number(threadId),
          body,
          name: name || null,
          sage: !!sage,
        })
        .select('id')
        .single();
      if (error) throw new Error(`createReply: ${error.message}`);
      return { id: data.id, number: data.id };
    },

    async createReport(postId, reason) {
      await ensureSession();
      const { error } = await db()
        .from('reports')
        .insert({ post: Number(postId), reason: reason || null });
      if (error) throw error;
    },

    // Watched threads — id/title/reply_count for the watcher panel.
    async getThreadsByIds(ids) {
      const list = (ids || []).map(Number).filter(Boolean);
      if (!list.length) return [];
      const { data, error } = await db()
        .from('posts')
        .select('id,title,reply_count,closed')
        .in('id', list)
        .is('thread', null);
      if (error) throw new Error(`getThreadsByIds: ${error.message}`);
      return data || [];
    },

    async getSiteStats() {
      const dayAgo = new Date(Date.now() - 86400000).toISOString();
      const hourAgo = new Date(Date.now() - 3600000).toISOString();
      const head = { count: 'exact', head: true };
      const [{ count: total }, { count: day }, { count: hour }] = await Promise.all([
        db().from('posts').select('id', head),
        db().from('posts').select('id', head).gte('created_at', dayAgo),
        db().from('posts').select('id', head).gte('created_at', hourAgo),
      ]);
      return { total: total || 0, day: day || 0, hour: hour || 0 };
    },
  };
})();

// Mod — console moderation helpers. The password is checked in Postgres.
// e.g. Mod.delete(42, 'pass')
const Mod = (() => {
  async function rpc(name, args) {
    if (!API.client) return console.error('Supabase not initialised');
    await API.ensureSession();
    const { data, error } = await API.client.rpc(name, args);
    if (error) { console.error(name, error.message); return null; }
    console.log(name, '→', data);
    return data;
  }
  return {
    delete: (id, pass)          => rpc('mod_delete_post', { p_id: id, p_pass: pass }),
    pin:    (id, on, pass)      => rpc('mod_set_pinned',  { p_id: id, p_pinned: on !== false, p_pass: pass }),
    close:  (id, on, pass)      => rpc('mod_set_closed',  { p_id: id, p_closed: on !== false, p_pass: pass }),
    addLog: (title, body, pass) => rpc('mod_add_log',     { p_title: title, p_body: body, p_pass: pass }),
    delLog: (id, pass)          => rpc('mod_delete_log',  { p_id: id, p_pass: pass }),
    config: (key, value, pass)  => rpc('mod_set_config',  { p_key: key, p_value: value, p_pass: pass }),
    reports: (pass)             => rpc('list_reports',    { p_pass: pass }),
    clearReports: (id, pass)    => rpc('mod_clear_reports',{ p_id: id, p_pass: pass }),
  };
})();
