// Commented by anthropic's Opus 4.8
'use strict';

const ViewBoardSearch = (() => {
  function normalizeSearchQuery(raw) {
    return Utils.sanitizeText(raw, { maxChars: CONFIG.search.maxQueryChars }).trim();
  }

  function findSearchOffsets(text, query, maxMatches) {
    const offsets = [];
    const haystack = String(text || '').toLocaleLowerCase();
    const needle = String(query || '').toLocaleLowerCase();

    if (!needle) return offsets;

    let cursor = 0;
    while (offsets.length < maxMatches) {
      const index = haystack.indexOf(needle, cursor);
      if (index === -1) break;
      offsets.push(index);
      cursor = index + Math.max(needle.length, 1);
    }

    return offsets;
  }

  function buildSearchFragment(text, start, length, contextChars = CONFIG.search.snippetContextChars) {
    const source = String(text || '').replace(/\r\n?/g, '\n');
    const from = Math.max(0, start - contextChars);
    const to = Math.min(source.length, start + length + contextChars);
    let fragment = source.slice(from, to).replace(/\s+/g, ' ').trim();

    if (from > 0 && fragment) fragment = `…${fragment}`;
    if (to < source.length && fragment) fragment = `${fragment}…`;
    return fragment;
  }

  function collectMatchesFromText(text, query, options = {}) {
    const {
      label = 'Match',
      hash = '',
      maxMatches = CONFIG.search.maxMatchesPerPost,
    } = options;
    const clean = Utils.sanitizeText(text || '', { preserveNewlines: true }).trim();
    if (!clean) return [];

    return findSearchOffsets(clean, query, maxMatches).map(offset => ({
      label,
      fragment: buildSearchFragment(clean, offset, query.length),
      hash,
    }));
  }

  function dedupeSearchMatches(matches, maxMatches = CONFIG.search.maxMatchesPerThread) {
    const seen = new Set();
    const deduped = [];

    for (const match of matches) {
      // key on snippet+anchor (not label) so subject/OP dupes collapse
      const key = `${match.fragment}|${match.hash}`;
      if (!match.fragment || seen.has(key)) continue;
      seen.add(key);
      deduped.push(match);
      if (deduped.length >= maxMatches) break;
    }

    return deduped;
  }

  async function buildSearchResults(board, query) {
    // dedupe by thread number, defensively
    const seenThreads = new Set();
    const issues = (await API.getAllThreads(board)).filter((issue) => {
      const key = String(issue.number);
      if (seenThreads.has(key)) return false;
      seenThreads.add(key);
      return true;
    });
    const repliesByThread = new Map();

    if (CONFIG.search.includeReplies) {
      // local search so we can show several matches per thread (OP + replies)
      const replyEntries = await Promise.all(issues.map(async (issue) => {
        try {
          return [String(issue.number), await API.getReplies(issue.number)];
        } catch (e) {
          console.warn('Failed to load replies for search:', issue.number, e);
          return [String(issue.number), []];
        }
      }));

      replyEntries.forEach(([threadId, replies]) => {
        repliesByThread.set(threadId, replies);
      });
    }

    const results = issues.map((issue) => {
      const matches = [
        ...collectMatchesFromText(issue.title || '', query, {
          label: 'Match in subject',
          hash: '#op',
        }),
        ...collectMatchesFromText(Utils.cleanBody(issue.body), query, {
          label: 'Match in OP',
          hash: '#op',
        }),
      ];

      if (CONFIG.search.includeReplies) {
        const replies = repliesByThread.get(String(issue.number)) || [];

        for (const reply of replies) {
          if (matches.length >= CONFIG.search.maxMatchesPerThread) break;

          const replyMatches = collectMatchesFromText(Utils.cleanBody(reply.body), query, {
            label: `Match in reply No.${reply.id}`,
            hash: `#reply-${reply.id}`,
            maxMatches: CONFIG.search.maxMatchesPerPost,
          });

          matches.push(...replyMatches);
        }
      }

      const dedupedMatches = dedupeSearchMatches(matches);
      if (!dedupedMatches.length) return null;

      return {
        issue,
        matches: dedupedMatches,
        matchCount: dedupedMatches.length,
      };
    }).filter(Boolean);

    if (CONFIG.search.sort === 'updated') {
      results.sort((a, b) =>
        getResultSortTime(b.issue) - getResultSortTime(a.issue)
      );
    } else {
      results.sort((a, b) =>
        b.matchCount - a.matchCount
        || getResultSortTime(b.issue) - getResultSortTime(a.issue)
      );
    }

    return results.slice(0, CONFIG.search.resultLimit);
  }

  function renderSearchMatches(matches, board, threadNumber) {
    if (!matches.length) return '';

    return `
      <div class="search-match-list">
        ${matches.map(match => `
          <div class="search-match">
            <span class="search-match-label">${Utils.escHtml(match.label)}:</span>
            <span class="search-match-fragment">${Utils.escHtml(match.fragment)}</span>
            ${match.hash
              ? `<a href="#" data-board="${Utils.escHtml(board)}" data-thread="${threadNumber}" data-hash="${Utils.escHtml(match.hash)}">[Open match]</a>`
              : ''
            }
          </div>
        `).join('')}
      </div>`;
  }

  return {
    normalizeSearchQuery,
    buildSearchResults,
    renderSearchMatches,
  };
})();
  function getResultSortTime(issue) {
    return new Date(issue.bump_at || issue.updated_at || issue.created_at || 0);
  }
