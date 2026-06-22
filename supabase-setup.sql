-- Commented by anthropic's Opus 4.8
-- ============================================================
--  Supabase backend. Run once in the SQL editor; safe to re-run.
--  The browser uses only the public anon key; RLS + triggers keep posting honest.
--
--  Data model:
--    posts  — threads AND replies (thread IS NULL -> OP; title is its subject).
--    logs   — changelog / news entries.
--    boards — allowlist of valid board slugs.
--
--  After running: fill scripts/site-config.js with your URL + anon key, and set
--  a modpass (bottom).
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- secrets ----------
-- Server-only key/value store. RLS denies everyone, so the anon client can
-- never read these; only SECURITY DEFINER functions below can.
create table if not exists public.app_secrets (
    key   text primary key,
    value text not null
);
alter table public.app_secrets enable row level security;

-- A stable random secret for secure (##) tripcodes, and another for the
-- per-thread poster IDs, so neither can be forged or pre-computed off-site.
insert into public.app_secrets (key, value)
values ('tripsecret',     encode(gen_random_bytes(24), 'hex')),
       ('posterid_secret', encode(gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- ---------- boards allowlist ----------
-- The API can only post to a board slug that exists here. Per-board *display*
-- config (names, themes, placeholders, …) still lives in scripts/site-config.js;
-- when you add a board there, add its slug here too.
create table if not exists public.boards (slug text primary key);
insert into public.boards (slug) values ('plaza'), ('meta'), ('test')
on conflict (slug) do nothing;
alter table public.boards enable row level security;
drop policy if exists "boards are public" on public.boards;
create policy "boards are public" on public.boards for select using (true);

-- ---------- posts (threads + replies) ----------
create table if not exists public.posts (
    id            bigint      generated always as identity primary key,
    board         text        not null,
    -- NULL = an OP (a thread). A value = a reply pointing at its OP.
    thread        bigint      references public.posts(id) on delete cascade,
    title         text        check (title is null or length(title) <= 80),  -- OP subject only
    body          text        not null check (length(body) between 1 and 2000),
    -- identity: display name + computed tripcode (both set server-side, see trigger)
    name          text,
    tripcode      text,
    -- sage: a reply that does NOT bump its thread
    sage          boolean     not null default false,
    -- per-thread poster IDs (4chan-style). Toggled on the OP; the value on each
    -- post is derived server-side so it can't be spoofed by the client.
    ids_enabled   boolean     not null default false,
    poster_id     text,
    -- moderation flags (OP only)
    pinned        boolean     not null default false,
    closed        boolean     not null default false,
    author        uuid        not null default auth.uid(),
    created_at    timestamptz not null default now(),
    -- maintained by triggers for cheap ordering + counts:
    bumped_at     timestamptz not null default now(),   -- last NON-sage activity
    last_reply_at timestamptz,                            -- last reply of any kind
    reply_count   int         not null default 0
);

-- Board listing: pinned first, then most-recently-bumped. Only OPs.
create index if not exists posts_threads_idx
    on public.posts (board, pinned desc, bumped_at desc) where thread is null;
-- Replies of a thread, in post order.
create index if not exists posts_by_thread_idx
    on public.posts (thread, created_at) where thread is not null;
-- Rate limiting / "my posts" lookups.
create index if not exists posts_author_time_idx
    on public.posts (author, created_at desc);

-- ============================================================
--  Tripcodes — 4chan / 2ch (Futaba) compatible.
--
--  Insecure trip  "name#pass"   -> classic DES crypt(3) tripcode  (!xxxxxxxxxx)
--  Secure trip    "name##pass"  -> SHA1 + this site's secret salt (!!xxxxxxxxxxx)
--
--  Computed in a BEFORE INSERT trigger, so a client can never forge someone
--  else's tripcode — whatever it sends in `tripcode` is ignored.
-- ============================================================
create or replace function public.compute_tripcode(p_input text)
returns text language plpgsql stable as $$
declare
    pass   text;
    salt   text;
    secret text;
begin
    if p_input is null then return null; end if;

    if position('##' in p_input) > 0 then           -- secure ## takes precedence
        pass := substring(p_input from position('##' in p_input) + 2);
        if pass = '' then return null; end if;
        select value into secret from public.app_secrets where key = 'tripsecret';
        return '!!' || substr(
            encode(digest(pass || coalesce(secret, ''), 'sha1'), 'base64'), 1, 11);
    elsif position('#' in p_input) > 0 then
        pass := substring(p_input from position('#' in p_input) + 1);
    else
        return null;
    end if;

    if pass = '' then return null; end if;

    -- htmlspecialchars (ENT_COMPAT), exactly like Futaba/4chan
    pass := replace(pass, '&', '&amp;');
    pass := replace(pass, '"', '&quot;');
    pass := replace(pass, '<', '&lt;');
    pass := replace(pass, '>', '&gt;');

    salt := substr(pass || 'H..', 2, 2);
    salt := regexp_replace(salt, '[^.-z]', '.', 'g');
    salt := translate(salt, ':;<=>?@[\]^_`', 'ABCDEFGabcdef');

    return '!' || right(crypt(left(pass, 8), salt), 10);
end $$;

-- Split the raw "name#pass" the client submits in `name`: keep the display
-- name (capped at 20 chars, like the old engine) and (re)compute the tripcode.
-- SECURITY DEFINER so compute_tripcode can read the secure-trip secret from
-- app_secrets (which is RLS deny-all to the anon client).
create or replace function public.apply_name_tripcode()
returns trigger language plpgsql security definer as $$
declare
    raw      text := new.name;
    hash_pos int;
begin
    new.tripcode := public.compute_tripcode(raw);
    if raw is null then
        new.name := null;
    else
        hash_pos := position('#' in raw);
        if hash_pos > 0 then raw := left(raw, hash_pos - 1); end if;
        new.name := nullif(left(btrim(raw), 20), '');
    end if;
    return new;
end $$;

drop trigger if exists trg_name_tripcode on public.posts;
create trigger trg_name_tripcode
    before insert on public.posts
    for each row execute function public.apply_name_tripcode();

-- ============================================================
--  Field normalisation + server-derived poster IDs
--  Replies can't carry a title/pin/lock or set their own poster id; the OP's
--  `ids_enabled` flag decides whether a whole thread shows poster IDs.
-- ============================================================
create or replace function public.prepare_post()
returns trigger language plpgsql security definer as $$
declare
    parent     public.posts%rowtype;
    ids_on     boolean;
    secret     text;
    thread_key bigint;
begin
    if new.thread is null then
        -- OP: keep its own ids_enabled; OPs never sage.
        new.sage      := false;
        ids_on        := new.ids_enabled;
        thread_key    := new.id;          -- identity is already assigned here
    else
        -- Reply: inherit the thread's board + ID policy, drop OP-only fields.
        select * into parent from public.posts where id = new.thread;
        if not found then
            raise exception 'no_such_thread' using hint = 'That thread does not exist.';
        end if;
        new.board       := parent.board;
        new.title       := null;
        new.pinned      := false;
        new.closed      := false;
        new.ids_enabled := false;
        ids_on          := parent.ids_enabled;
        thread_key      := new.thread;
    end if;

    if ids_on then
        select value into secret from public.app_secrets where key = 'posterid_secret';
        new.poster_id := upper(substr(
            encode(hmac(thread_key::text || ':' || new.author::text, coalesce(secret, ''), 'sha256'), 'hex'),
            1, 8));
    else
        new.poster_id := null;
    end if;

    return new;
end $$;

drop trigger if exists trg_prepare_post on public.posts;
create trigger trg_prepare_post
    before insert on public.posts
    for each row execute function public.prepare_post();

-- ---------- bump + reply_count ----------
-- Every reply bumps last_reply_at and the count; a `sage` reply does NOT move
-- bumped_at, so it won't lift the thread up the board.
create or replace function public.on_reply_bump()
returns trigger language plpgsql security definer as $$
begin
    if new.thread is not null then
        update public.posts
           set bumped_at     = case when new.sage then bumped_at else now() end,
               last_reply_at = now(),
               reply_count   = reply_count + 1
         where id = new.thread;
    end if;
    return new;
end $$;

drop trigger if exists trg_reply_bump on public.posts;
create trigger trg_reply_bump
    after insert on public.posts
    for each row execute function public.on_reply_bump();

-- Keep reply_count correct when a reply is removed (mod delete, cascade, …).
create or replace function public.on_reply_delete()
returns trigger language plpgsql security definer as $$
begin
    if old.thread is not null then
        update public.posts
           set reply_count = greatest(reply_count - 1, 0)
         where id = old.thread;
    end if;
    return old;
end $$;

drop trigger if exists trg_reply_delete on public.posts;
create trigger trg_reply_delete
    after delete on public.posts
    for each row execute function public.on_reply_delete();

-- ---------- rate limit ----------
-- Server-side backstop (the client also enforces a per-post cooldown).
-- 5 posts / 60 seconds per anonymous identity.
create or replace function public.enforce_rate_limit()
returns trigger language plpgsql security definer as $$
begin
    if (select count(*) from public.posts
          where author = auth.uid()
            and created_at > now() - interval '60 seconds') >= 5 then
        raise exception 'rate_limited'
            using hint = 'Slow down — too many posts.';
    end if;
    return new;
end $$;

drop trigger if exists trg_rate_limit on public.posts;
create trigger trg_rate_limit
    before insert on public.posts
    for each row execute function public.enforce_rate_limit();

-- ---------- valid board ----------
create or replace function public.enforce_board()
returns trigger language plpgsql security definer as $$
begin
    if not exists (select 1 from public.boards where slug = new.board) then
        raise exception 'unknown_board' using hint = 'No such board.';
    end if;
    return new;
end $$;

drop trigger if exists trg_board on public.posts;
create trigger trg_board
    before insert on public.posts
    for each row execute function public.enforce_board();

-- ============================================================
--  Posting switches + per-thread lock
-- ============================================================
create table if not exists public.site_config (
    key   text primary key,
    value text not null
);
alter table public.site_config enable row level security;
drop policy if exists "config readable" on public.site_config;
create policy "config readable" on public.site_config for select using (true);

insert into public.site_config (key, value) values
    ('threads_open', 'true'),
    ('replies_open', 'true')
on conflict (key) do nothing;

-- Enforce the switches + closed-thread lock server-side, regardless of client.
create or replace function public.enforce_posting_open()
returns trigger language plpgsql security definer as $$
declare v text;
begin
    select value into v from public.site_config
      where key = case when new.thread is null then 'threads_open' else 'replies_open' end;
    if v = 'false' then
        raise exception 'posting_disabled' using hint = 'Posting is disabled.';
    end if;
    if new.thread is not null and (select closed from public.posts where id = new.thread) then
        raise exception 'thread_closed' using hint = 'This thread is closed.';
    end if;
    return new;
end $$;

drop trigger if exists trg_posting_open on public.posts;
create trigger trg_posting_open
    before insert on public.posts
    for each row execute function public.enforce_posting_open();

-- ---------- row level security ----------
alter table public.posts enable row level security;

-- anyone (even logged-out) can read the board
drop policy if exists "posts are public" on public.posts;
create policy "posts are public"
    on public.posts for select
    using (true);

-- only a signed-in identity can post, and only as itself
drop policy if exists "anon can insert own posts" on public.posts;
create policy "anon can insert own posts"
    on public.posts for insert
    to anon, authenticated
    with check (auth.uid() is not null and author = auth.uid());

-- no public update/delete — moderation goes through the RPCs below.

-- ============================================================
--  Logs (the old `log` label)
-- ============================================================
create table if not exists public.logs (
    id         bigint      generated always as identity primary key,
    title      text        not null check (length(title) between 1 and 120),
    body       text        not null,
    created_at timestamptz not null default now()
);
create index if not exists logs_created_idx on public.logs (created_at desc);

alter table public.logs enable row level security;
drop policy if exists "logs are public" on public.logs;
create policy "logs are public" on public.logs for select using (true);
-- no public insert/update/delete — use mod_add_log / mod_delete_log below.

-- ============================================================
--  Moderation — passphrase-gated RPCs (no admin token in the client)
-- ============================================================
-- Seed a RANDOM, unknown modpass (bcrypt-hashed) so there is no default
-- password in this file. `do nothing` keeps a real one you set later.
-- Set your own afterwards in the SQL editor:
--   update public.app_secrets
--      set value = crypt('your-strong-pass', gen_salt('bf'))
--    where key = 'modpass';
insert into public.app_secrets (key, value)
values ('modpass', crypt(encode(gen_random_bytes(18), 'hex'), gen_salt('bf')))
on conflict (key) do nothing;

create or replace function public.is_mod(p_pass text)
returns boolean language sql stable security definer as $$
    select exists (
        select 1 from public.app_secrets
         where key = 'modpass' and value = crypt(p_pass, value)
    );
$$;
grant execute on function public.is_mod(text) to anon, authenticated;

-- Delete a post. If it's an OP, the reply cascade removes the whole thread.
create or replace function public.mod_delete_post(p_id bigint, p_pass text)
returns text language plpgsql security definer as $$
begin
    if not public.is_mod(p_pass) then return 'forbidden'; end if;
    delete from public.posts where id = p_id;
    return 'ok';
end $$;
grant execute on function public.mod_delete_post(bigint, text) to anon, authenticated;

-- Pin / unpin a thread (sticky).
create or replace function public.mod_set_pinned(p_id bigint, p_pinned boolean, p_pass text)
returns text language plpgsql security definer as $$
begin
    if not public.is_mod(p_pass) then return 'forbidden'; end if;
    update public.posts set pinned = p_pinned where id = p_id and thread is null;
    return 'ok';
end $$;
grant execute on function public.mod_set_pinned(bigint, boolean, text) to anon, authenticated;

-- Close / reopen a thread (closed = readable but no new replies).
create or replace function public.mod_set_closed(p_id bigint, p_closed boolean, p_pass text)
returns text language plpgsql security definer as $$
begin
    if not public.is_mod(p_pass) then return 'forbidden'; end if;
    update public.posts set closed = p_closed where id = p_id and thread is null;
    return 'ok';
end $$;
grant execute on function public.mod_set_closed(bigint, boolean, text) to anon, authenticated;

-- Flip a global posting switch (threads_open / replies_open).
create or replace function public.mod_set_config(p_key text, p_value text, p_pass text)
returns text language plpgsql security definer as $$
begin
    if not public.is_mod(p_pass) then return 'forbidden'; end if;
    if p_key not in ('threads_open', 'replies_open') then return 'bad key'; end if;
    insert into public.site_config (key, value) values (p_key, p_value)
      on conflict (key) do update set value = excluded.value;
    return 'ok';
end $$;
grant execute on function public.mod_set_config(text, text, text) to anon, authenticated;

-- Post / remove a log entry (the old "open an issue with the log label").
create or replace function public.mod_add_log(p_title text, p_body text, p_pass text)
returns bigint language plpgsql security definer as $$
declare new_id bigint;
begin
    if not public.is_mod(p_pass) then return null; end if;
    insert into public.logs (title, body) values (p_title, p_body) returning id into new_id;
    return new_id;
end $$;
grant execute on function public.mod_add_log(text, text, text) to anon, authenticated;

create or replace function public.mod_delete_log(p_id bigint, p_pass text)
returns text language plpgsql security definer as $$
begin
    if not public.is_mod(p_pass) then return 'forbidden'; end if;
    delete from public.logs where id = p_id;
    return 'ok';
end $$;
grant execute on function public.mod_delete_log(bigint, text) to anon, authenticated;

-- ============================================================
--  Reports (the [!] button). Same model as the rest: anon files a report as
--  itself; reports are unreadable via the API; mods read them through an RPC.
-- ============================================================
create table if not exists public.reports (
    id         bigint      generated always as identity primary key,
    post       bigint      not null references public.posts(id) on delete cascade,
    reporter   uuid        not null default auth.uid(),
    reason     text        check (reason is null or length(reason) <= 280),
    created_at timestamptz not null default now(),
    unique (post, reporter)   -- one report per identity per post (dedup)
);
create index if not exists reports_post_idx on public.reports (post);

-- light anti-spam: 15 reports / 10 min per identity
create or replace function public.enforce_report_rate()
returns trigger language plpgsql security definer as $$
begin
    if (select count(*) from public.reports
          where reporter = auth.uid()
            and created_at > now() - interval '10 minutes') >= 15 then
        raise exception 'report_rate' using hint = 'Too many reports, slow down.';
    end if;
    return new;
end $$;

drop trigger if exists trg_report_rate on public.reports;
create trigger trg_report_rate
    before insert on public.reports
    for each row execute function public.enforce_report_rate();

alter table public.reports enable row level security;

-- file a report: must be signed in, only as yourself
drop policy if exists "anon can file reports" on public.reports;
create policy "anon can file reports"
    on public.reports for insert
    to anon, authenticated
    with check (auth.uid() is not null and reporter = auth.uid());
-- no SELECT policy => reports are unreadable via the API; mods use the RPC below.

-- Mod-only: reported posts, newest first, with how many reports each has.
create or replace function public.list_reports(p_pass text)
returns table (post bigint, report_count bigint, reasons text[], last_report timestamptz)
language plpgsql security definer as $$
begin
    if not public.is_mod(p_pass) then raise exception 'forbidden'; end if;
    return query
        select r.post, count(*),
               array_remove(array_agg(r.reason order by r.created_at desc), null),
               max(r.created_at)
          from public.reports r
         group by r.post
         order by max(r.created_at) desc;
end $$;
grant execute on function public.list_reports(text) to anon, authenticated;

-- Mod: dismiss the reports on a post without deleting it (false alarm).
create or replace function public.mod_clear_reports(p_id bigint, p_pass text)
returns text language plpgsql security definer as $$
begin
    if not public.is_mod(p_pass) then return 'forbidden'; end if;
    delete from public.reports where post = p_id;
    return 'ok';
end $$;
grant execute on function public.mod_clear_reports(bigint, text) to anon, authenticated;

-- ============================================================
--  Optional: Telegram alerts on new reports // I added this just for myself, you can get rid of this whole thing -- C9k
-- ----------------------------------------------------------
--  Pushes a message to a Telegram chat whenever a post is reported, so you
--  don't have to poll Mod.reports(). It stays dormant until you set the three
--  secrets below; with them unset it is a no-op.
--
--  To enable:
--    1) Create a bot with @BotFather -> copy its token.
--    2) Get your chat id: message the bot, then open
--         https://api.telegram.org/bot<token>/getUpdates
--       and read result[].message.chat.id  (for a group, add the bot to it).
--    3) Set the two secrets (replace the values), then re-run this file:
--         update public.app_secrets set value = '123456:ABC-yourBotToken'
--           where key = 'telegram_bot_token';
--         update public.app_secrets set value = '987654321'
--           where key = 'telegram_chat_id';
-- ============================================================
create extension if not exists pg_net;

insert into public.app_secrets (key, value) values
    ('telegram_bot_token', 'SET_ME'),
    ('telegram_chat_id',   'SET_ME')
on conflict (key) do nothing;

create or replace function public.notify_telegram_report()
returns trigger language plpgsql security definer as $$
declare
    tok    text;
    chat   text;
    tid    bigint;
    brd    text;
    anchor text;
    msg    text;
begin
    select value into tok  from public.app_secrets where key = 'telegram_bot_token';
    select value into chat from public.app_secrets where key = 'telegram_chat_id';
    if tok is null or chat is null or tok = 'SET_ME' or chat = 'SET_ME' then
        return new;  -- not configured yet
    end if;

    -- thread + board + anchor of the reported post, for a clickable link
    select coalesce(p.thread, p.id), p.board,
           case when p.thread is null then 'op' else 'reply-' || p.id end
      into tid, brd, anchor
      from public.posts p where p.id = new.post;

    msg := 'Report' || E'\n'
        || 'Post: No.' || new.post || E'\n'
        || 'Reason: ' || coalesce(new.reason, '(none)') || E'\n'
        || 'https://staticboard.nekoweb.org/board.html?board=' || brd
        || '&thread=' || tid || '#' || anchor;

    perform net.http_post(
        url     := 'https://api.telegram.org/bot' || tok || '/sendMessage',
        body    := jsonb_build_object('chat_id', chat, 'text', msg),
        headers := jsonb_build_object('Content-Type', 'application/json')
    );
    return new;
end $$;

drop trigger if exists trg_report_telegram on public.reports;
create trigger trg_report_telegram
    after insert on public.reports
    for each row execute function public.notify_telegram_report();

-- ============================================================
--  Done. Quick reference for the console mod helpers in scripts/api.js:
--    Mod.delete(id, 'pass')          remove a post (or whole thread if OP)
--    Mod.pin(id, true, 'pass')       sticky a thread
--    Mod.close(id, true, 'pass')     lock a thread
--    Mod.addLog('Title','Body','pass')
--    Mod.config('threads_open','false','pass')
--    Mod.reports('pass')             list reported posts
--    Mod.clearReports(id, 'pass')    dismiss reports on a post
-- ============================================================
