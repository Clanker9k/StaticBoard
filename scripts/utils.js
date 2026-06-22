// Commented by anthropic's Opus 4.8
'use strict';

// Utils — text sanitizing, time formatting, name line, body/markdown rendering.

const Utils = (() => {
  const combiningMarkRe = /\p{M}/u;

  const TIPS = [
    "You don't need no [contact] button",
    "You lack personality",
    "IndieWeb? Ze New World Order!",
    "Reality is fake; a 2D projection on a 3D holographic display",
    "The internet is 4 cats",
    "What's a power trip? Figure it out",
    "Nothing is sacred",
    "Unless it's not",
    "Lurk Moar",
    "Stop lurking; POST",
    "Zero Literacy Policy",
    "1e308 instances is not enough",
    "BedroomBound? So what?",
    "ADHD is an optic",
    "Wer R Astoundingly Detestably Hideous Dregs!",
    "They came from another dimension to harvest our souls, they need sacrifices to complete their evil rituals. . .",
    "Fusagiko is a cat",
    "Your ad here",
    "Hail Eris",
    "In Eris We Trust",
    "We can't gurantee that the thruth is separated from the bullshit",
    "The internet is /pol/luted",
    "// And honestly? This is slop",
    "Television sets are going cheap!",
    "Stab me with a knife",
    "If they can get inside of me, then they can get inside of you, and together we can take over the world!",
    "Look up in the sunny day, there's poison in the sky, fill your lungs with mind control and only they know why",
    "The Law of Fives is never wrong",
    "Do you believe that?",
    "Bullshit makes the flowers grow, and that is beautiful",
    "I am known as the ultimate master!",
    "Today is the day",
    "Great Fnord awaits ahead. . .",
    "Hatman is international",
    "Kill The Kool",
    "How many to-do lists does it take to do nothing?",
    "omigosh he's really dead?",
    "herd you liek GOATSE",
    "Neocities? I'm in the litter",
    "Feel rewarded?",
    "Reload again",
    "Hi-Point is my problem solver",
  ];

  function proTip() {
    return TIPS[Math.floor(Math.random() * TIPS.length)];
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sanitizeText(raw, opts = {}) {
    const {
      maxChars = Infinity,
      preserveNewlines = false,
      maxCombiningMarks = CONFIG.maxCombiningMarks,
    } = opts;

    let text = String(raw || '').replace(/\r\n?/g, '\n');

    try {
      text = text.normalize('NFKC');
    } catch (_) {
      // Leave text as-is if normalization is unavailable.
    }

    text = text
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      .replace(/[\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '');

    if (!preserveNewlines) {
      text = text.replace(/\n+/g, ' ');
    }

    let cleaned = '';
    let combiningCount = 0;

    for (const ch of text) {
      if (combiningMarkRe.test(ch)) {
        combiningCount++;
        if (combiningCount > maxCombiningMarks) continue;
      } else {
        combiningCount = 0;
      }

      cleaned += ch;
      if (cleaned.length >= maxChars) break;
    }

    return cleaned;
  }

  function relTime(iso) {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)    return `${diff}s ago`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function fullTime(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  // relative if under a day old, else a fixed "dd/mm/yy (Mon)" stamp
  function displayTime(iso) {
    const then = new Date(iso);
    if (Date.now() - then.getTime() < 86400000) return relTime(iso);
    const dd = String(then.getDate()).padStart(2, '0');
    const mm = String(then.getMonth() + 1).padStart(2, '0');
    const yy = String(then.getFullYear()).slice(-2);
    const wk = then.toLocaleDateString('en-GB', { weekday: 'short' });
    return `${dd}/${mm}/${yy} (${wk})`;
  }

  // trim the raw "name#pass"; the server splits the name and computes the trip
  function sanitizeName(raw) {
    return sanitizeText(raw, { maxChars: 40 }).trim();
  }

  // post.meta with safe defaults
  function postMeta(post) {
    const m = (post && post.meta) || {};
    return {
      name: m.name || 'Anonymous',
      trip: m.trip || null,
      sage: !!m.sage,
      idsEnabled: !!m.idsEnabled,
      posterId: m.posterId || null,
    };
  }

  // bodies are stored clean now — just normalise + trim
  function cleanBody(raw) {
    return sanitizeText(raw, { preserveNewlines: true }).trim();
  }

  function extractQuoteRefs(raw) {
    const refs = new Set();
    const text = cleanBody(raw);

    for (const match of text.matchAll(/>>(\d+)/g)) {
      refs.add(match[1]);
    }

    return Array.from(refs);
  }

  function stripMarkdown(raw) {
    return String(raw || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^[-*]\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitLogMeta(raw) {
    const text = String(raw || '').replace(/\r\n?/g, '\n').trim();
    const lines = text.split('\n');
    const firstLine = lines[0] ? lines[0].trim() : '';
    const match = firstLine.match(/^desc:\s*(.+)$/i);

    if (!match) {
      return {
        desc: null,
        body: text,
      };
    }

    const body = lines.slice(1).join('\n').trim();
    return {
      desc: match[1].trim() || null,
      body,
    };
  }

  function getLogExcerpt(raw, maxChars = 72) {
    const { desc, body } = splitLogMeta(raw);
    const plain = stripMarkdown(desc || body);
    if (plain.length <= maxChars) return plain;
    return `${plain.slice(0, maxChars).trimEnd()}…`;
  }

  function renderInlineMarkdown(text) {
    let html = escHtml(text);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
    return html;
  }

  function renderMarkdownBlock(block) {
    if (!block.trim()) return '';
    if (/^__CODE_BLOCK_\d+__$/.test(block.trim())) return block.trim();

    if (/^#{1,6}\s/.test(block)) {
      const line = block.trim();
      const level = Math.min(6, (line.match(/^#+/) || ['#'])[0].length);
      return `<h${level}>${renderInlineMarkdown(line.slice(level).trim())}</h${level}>`;
    }

    if (/^>\s?/m.test(block) && block.split('\n').every(line => /^>\s?/.test(line.trim()))) {
      const content = block.split('\n')
        .map(line => renderInlineMarkdown(line.replace(/^>\s?/, '').trim()))
        .join('<br>');
      return `<blockquote>${content}</blockquote>`;
    }

    if (block.split('\n').every(line => /^[-*]\s+/.test(line.trim()))) {
      const items = block.split('\n')
        .map(line => `<li>${renderInlineMarkdown(line.replace(/^[-*]\s+/, '').trim())}</li>`)
        .join('');
      return `<ul>${items}</ul>`;
    }

    return `<p>${block.split('\n').map(line => renderInlineMarkdown(line.trim())).join('<br>')}</p>`;
  }

  function renderMarkdown(raw) {
    const { body } = splitLogMeta(raw);
    const source = body;
    const fenceRe = /```([\s\S]*?)```/g;
    const codeBlocks = [];
    const tokenized = source.replace(fenceRe, (_, code) => {
      const token = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push(`<pre><code>${escHtml(code.trim())}</code></pre>`);
      return token;
    });

    const html = tokenized
      .split(/\n{2,}/)
      .map(block => renderMarkdownBlock(block))
      .filter(Boolean)
      .join('\n');

    return html.replace(/__CODE_BLOCK_(\d+)__/g, (_, index) => codeBlocks[Number(index)] || '');
  }

  function renderLine(line, quoteMap) {
    let html = escHtml(line);

    if (quoteMap) {
      html = html.replace(/&gt;&gt;(\d+)/g, (match, num) => {
        const target = quoteMap.get(num);
        if (!target) {
          // Dead quotes stay visible instead of collapsing, which mirrors the
          // "reply to a deleted post" behavior imageboards usually expect.
          return `<span class="dead-quote" data-quote-num="${escHtml(num)}">&gt;&gt;${num}</span>`;
        }

        const markers = [];
        if (target.isOp) {
          markers.push('<span class="quote-marker quote-op-marker">(OP)</span>');
        }
        if (target.isYou) {
          markers.push('<span class="quote-marker quote-you-marker">(You)</span>');
        }
        const attrs = target.href
          ? [
              `href="${escHtml(target.href)}"`,
              target.board ? `data-board="${escHtml(target.board)}"` : '',
              target.threadId ? `data-thread="${escHtml(String(target.threadId))}"` : '',
              target.hash ? `data-hash="${escHtml(target.hash)}"` : '',
            ].filter(Boolean).join(' ')
          : `href="#${escHtml(target.anchorId)}"`;

        return `<a class="quote-link" data-quote-num="${escHtml(num)}" ${attrs}>&gt;&gt;${num}</a>${markers.length ? ` ${markers.join(' ')}` : ''}`;
      });
    }

    return line.startsWith('>')
      ? `<span class="greentext">${html}</span>`
      : html;
  }

  function renderLines(lines, quoteMap = null) {
    return lines.map(line => renderLine(line, quoteMap)).join('<br>');
  }

  // Markdown removed — plain text renderer with greentext support.
  // Lines starting with > become greentext spans; everything else is
  // HTML-escaped and joined with <br>. No external dependencies needed.
  function renderBody(raw, quoteMap = null) {
    const text = cleanBody(raw);
    if (!text) return '';
    return renderLines(text.split('\n'), quoteMap);
  }

  function renderPreview(raw, maxChars = CONFIG.previewChars, maxLines = CONFIG.previewLines, quoteMap = null) {
    const text = cleanBody(raw);
    if (!text) return { html: '', truncated: false };

    const fullLines = text.split('\n');
    const charLimitedText = text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;
    const previewLines = charLimitedText.split('\n');

    if (previewLines.length > maxLines) {
      const kept = previewLines.slice(0, maxLines);
      const last = kept[maxLines - 1].replace(/…?$/, '').trimEnd();
      kept[maxLines - 1] = `${last}…`;
      return { html: renderLines(kept, quoteMap), truncated: true };
    }

    return {
      html: renderLines(previewLines, quoteMap),
      truncated: text.length > maxChars || fullLines.length > maxLines,
    };
  }

  function nameHtml(meta, isReply, options = {}) {
    const { isYou = false } = options;
    const tripHtml = meta.trip
      ? ` <span class="${isReply ? 'reply-trip' : 'post-trip'}">${escHtml(meta.trip)}</span>`
      : '';
    const sageHtml = meta.sage
      ? ' <span class="sage-tag" title="no-bump">↓</span>'
      : '';
    const youHtml = isYou
      ? ' <span class="you-marker">(You)</span>'
      : '';
    const idHtml = meta.posterId
      ? ` <span class="poster-id">ID:${escHtml(meta.posterId)}</span>`
      : '';
    const nameClasses = [
      isReply ? 'reply-name' : 'post-name',
      meta.sage ? 'is-sage' : '',
    ].filter(Boolean).join(' ');
    return `<span class="${nameClasses}">${escHtml(meta.name)}${tripHtml}${sageHtml}${youHtml}${idHtml}</span>`;
  }

  return {
    escHtml,
    sanitizeText,
    relTime,
    fullTime,
    displayTime,
    proTip,
    sanitizeName,
    postMeta,
    cleanBody,
    extractQuoteRefs,
    getLogExcerpt,
    renderMarkdown,
    renderBody,
    renderPreview,
    nameHtml,
  };
})();
