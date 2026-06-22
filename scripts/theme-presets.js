// Commented by anthropic's Opus 4.8
'use strict';

// Built-in theme presets, kept out of config so it doesn't become a wall of CSS.
const DEFAULT_THEME_PRESET_KEY = 'red';

const THEME_PRESETS = Object.freeze({
  red: {
    label: 'Red',
    css: `:root {
  --fg: #800000;
  --border: #d9bfb7;
  --link: #34345c;
  --link-hover: #dd0000;
  --table-bg: #ffffee;
  --body-bg: #d4b8b0;
  --post-bg: #f0e0d6;
  --greentext: #789922;
  --post-outline-color: #c9a89e;
  --reply-outline-color: #b8a090;
  --op-name: #ffcc88;
  --op-trip: #ffffaa;
  --op-time: #ddd;
  --op-post-num: #ffaaaa;
  --reply-header-bg: #c8a870;
  --reply-header-fg: #000;
  --reply-name: #800000;
  --reply-trip: #555;
  --reply-time: #444;
  --reply-post-num: #800000;
  --sticky: #ffcc88;
  --thread-mode: #d6f0ff;
  --poster-id-bg: transparent;
}`,
  },
  blue: {
    label: 'Blue',
    css: `:root {
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
}`,
  },
  monochrome: {
    label: 'Monochrome',
    css: `:root {
  --fg: #111111;
  --border: #9a9a9a;
  --link: #1f1f1f;
  --link-hover: #555555;
  --table-bg: #f5f5f5;
  --body-bg: #d9d9d9;
  --post-bg: #ececec;
  --greentext: #6a6a6a;
  --post-outline-color: #9f9f9f;
  --reply-outline-color: #8a8a8a;
  --op-name: #ffffff;
  --op-trip: #d7d7d7;
  --op-time: #c8c8c8;
  --op-post-num: #f0f0f0;
  --reply-header-bg: #bcbcbc;
  --reply-header-fg: #111111;
  --reply-name: #222222;
  --reply-trip: #505050;
  --reply-time: #4a4a4a;
  --reply-post-num: #1a1a1a;
  --sticky: #efefef;
  --thread-mode: #e4e4e4;
  --poster-id-bg: rgba(255, 255, 255, 0.45);
}`,
  },
});

function getThemePresetKeys() {
  return Object.keys(THEME_PRESETS);
}

function getThemePresetKey(rawKey, fallbackKey = DEFAULT_THEME_PRESET_KEY) {
  const normalizedFallback = String(fallbackKey || '').trim();
  const safeFallback = THEME_PRESETS[normalizedFallback]
    ? normalizedFallback
    : DEFAULT_THEME_PRESET_KEY;
  const normalizedKey = String(rawKey || '').trim();
  return THEME_PRESETS[normalizedKey] ? normalizedKey : safeFallback;
}

function getThemePreset(rawKey, fallbackKey = DEFAULT_THEME_PRESET_KEY) {
  const presetKey = getThemePresetKey(rawKey, fallbackKey);
  return THEME_PRESETS[presetKey] || THEME_PRESETS[DEFAULT_THEME_PRESET_KEY];
}
