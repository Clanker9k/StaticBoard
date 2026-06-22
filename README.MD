# StaticBoard

StaticBoard is a static textboard. The pages are plain HTML/CSS/JS you can
host anywhere; the content lives in a [Supabase](https://supabase.com) project
(hosted Postgres).

## Why

IndieWeb has no idea

## Setup

1. Create a Supabase project
2. In the project's **SQL editor**, paste and run
   [`supabase-setup.sql`](supabase-setup.sql). It creates the tables, triggers,
   RLS policies, and moderation functions. It is safe to re-run.
   - Then **enable anonymous sign-ins**: Authentication → Sign In / Providers →
     turn on **Anonymous**. Posting needs an anonymous session so RLS can
     attribute and rate-limit posts; reading works without it. (Without this,
     posts fail wow)
3. In **Project Settings → API**, copy the **Project URL** and the **anon /
   public** key. Put them in [`scripts/site-config.js`](scripts/site-config.js)
   (it loads after `config.js` and is the single source of truth for creds):
   ```js
   Object.assign(CONFIG.supabase, {
     url: "https://YOUR-PROJECT.supabase.co",
     anonKey: "YOUR-ANON-KEY"
   });
   ```
4. **Define your boards** in `BOARDS` (same file). Each board key is also its
   stored board slug — so every board key you use must also exist in the
   `boards` table. The setup script seeds `plaza`, `meta`, and `test`.
5. **Set a modpass.**
   ```sql
   update public.app_secrets
      set value = crypt('your-strong-pass', gen_salt('bf'))
    where key = 'modpass';
   ```
6. Deploy

### Deploying to Nekoweb

Nekoweb serves your site from the root, and these pages use root-absolute paths
(`/scripts/...`, `/style.css`). Upload the repository contents to the root of
your Nekoweb site so the layout looks like:

```
/index.html
/board.html
/log.html
/board.js
/style.css
/Logo.png
/scripts/...
```

Built-in theme presets live in [`scripts/theme-presets.js`](scripts/theme-presets.js)
(`red`, `blue`, `monochrome`).

## Board Setup

Boards are defined in `BOARDS` inside `scripts/site-config.js`.

```js
const BOARDS = {
  plaza: {
    name: '/plaza/',
    desc: 'General posting.',
    forceThreadIds: true,
    defaultThemePreset: 'red',
    searchPlaceholder: 'Search /plaza/',
  },
  meta: {
    name: '/meta/',
    desc: 'Site discussion.',
    allowIds: false,
    forceThemePreset: 'blue',
  },
};
```

The key is the board key, which is also its database board slug. If you want a
different slug, set `label` (make sure that slug exists in the `boards`
table).

Per-board options:

- `label` (`string`): overrides the database board slug for this key.
- `showInNav` (`boolean`): show/hide the board in the shared top nav.
- `showInDirectory` (`boolean`): show/hide the board in the homepage list.
- `readOnly` (`boolean`): disables both new threads and replies.
- `allowThreadCreation` (`boolean`): allow new thread posting on that board.
- `allowReplyPosting` (`boolean`): allow replies in thread view on that board.
- `allowIds` (`boolean`): enables the IDs checkbox for new threads.
- `forceThreadIds` (`boolean`): force every new thread on that board to use IDs.
- `defaultIdsEnabled` (`boolean`): whether the IDs checkbox starts checked.
- `searchEnabled` (`boolean`): enable/disable board search for that board.
- `defaultThemePreset` (`string`): built-in preset used until a visitor saves
  their own theme choice.
- `forceThemePreset` (`string`): built-in preset that always overrides local
  theme choice on this board.
- `threadSubjectPlaceholder` / `threadCommentPlaceholder` /
  `replyCommentPlaceholder` (`string`): form placeholders.
- `emptyBoardMessage` / `readOnlyMessage` / `repliesDisabledMessage` /
  `searchPlaceholder` (`string`): UI strings.

## Moderating

There is no admin panel and no privileged code in the page. Moderation goes
through passphrase-gated database functions; the password is verified inside
Postgres, never trusted from the client. Open the browser dev console and use
the `Mod` helpers

```js
Mod.delete(23, 'pass')             // remove a post (or the whole thread if it's an OP)
Mod.pin(23, true, 'pass')          // sticky a thread (false to unpin)
Mod.close(23, true, 'pass')        // lock a thread (false to reopen)
Mod.addLog('Title', 'Body', 'pass')// post a log/changelog entry
Mod.delLog(5, 'pass')              // remove a log entry
Mod.config('threads_open', 'false', 'pass')  // global posting switch
```

For anything larger, add your own kool admin page that calls the same RPCs.

## File Layout

- `index.html`: homepage, log preview, and board directory
- `board.html`: board/thread shell
- `log.html`: site log page
- `board.js`: bootstrap entry / router
- `supabase-setup.sql`: the entire backend (tables, triggers, RLS, mod RPCs)
- `scripts/config.js`: engine config core and helpers
- `scripts/site-config.js`: host-owned Supabase credentials, theme, boards
- `scripts/theme-presets.js`: built-in theme registry
- `scripts/api.js`: Supabase data layer
- `scripts/utils.js`: parsing and rendering helpers
- `scripts/persistence.js`: settings, local state, drafts, `(You)`s
- `scripts/routing.js`: router, quote target helpers, nav
- `scripts/views.js` + `scripts/views/*.js`: board / thread / search / preview UI
- `style.css`: main styling

## What It Does Not Try To Be

- Not anonymous at the infrastructure level (Supabase sees request metadata).
- Not a full moderation suite.
- Not built for huge scale (textboards are dead ANYWAYS)

## Notes

- Your safety comes from the RLS policies and triggers in `supabase-setup.sql`.
- Anonymous sign-in is enabled per-browser so RLS can attribute posts and
  rate-limit, but it's an ass of a safety matter.
