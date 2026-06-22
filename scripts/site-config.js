// Commented by anthropic's Opus 4.8
'use strict';

// Host-owned overrides — your Supabase creds, default theme, and boards.

// Supabase project credentials (Project Settings -> API). The anon key is
// safe to ship publicly; Row Level Security in supabase-setup.sql is what
// actually protects writes. There is no admin token in the client.
// NOTE: this file loads AFTER config.js and wins, so it is the single source
// of truth for credentials — set them here.
Object.assign(CONFIG.supabase, {
  url: "https://amwqhshpkwcdipwlbosa.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtd3Foc2hwa3djZGlwd2xib3NhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNDU3MzEsImV4cCI6MjA5NzYyMTczMX0.ieTq1xO2ZjFsgXjYVYr50VasvwOOL_CAPuDt_TjhR90"
});

Object.assign(CONFIG.ui, {
  defaultThemePreset: "blue"
});

Object.assign(BOARDS, {
  "plaza": {
    name: "/plaza/",
    desc: "The place to post.",
    defaultIdsEnabled: true,
    threadSubjectPlaceholder: "Start a thread",
    threadCommentPlaceholder: "Post something worth reading. . .",
    replyCommentPlaceholder: "Reply. . .",
    searchPlaceholder: "Search /plaza/"
  },
  "meta": {
    name: "/meta/",
    desc: "I am known as the ultimate master!",
    allowIds: false,
    threadSubjectPlaceholder: "Meta topic",
    threadCommentPlaceholder: "Talk about the engine, site, or bugs...",
    replyCommentPlaceholder: "Write a meta reply...",
    searchPlaceholder: "Search /meta/"
  },
  "test": {
    name: "/test/",
    desc: "Test.",
    showInNav: false,
    showInDirectory: false,
    defaultIdsEnabled: true,
    forceThreadIds: true,
    threadSubjectPlaceholder: "Test thread",
    threadCommentPlaceholder: "Throw junk in here...",
    replyCommentPlaceholder: "Reply with more junk..."
  },
});
