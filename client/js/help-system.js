/**
 * help-system.js
 *
 * Per-game-type rules overlay.  Fetches markdown from
 * GET /api/games/types/:type/help on first open per type, caches it, renders
 * it through a small hand-rolled markdown subset, and shows it in a modal-ish
 * overlay that covers most of the viewport.
 *
 * The overlay does NOT pause the underlying game — clicking outside dismisses
 * it but does not block clicks reaching the game UI.  A player who reads help
 * while their turn timer is running loses turn time; that's intentional (see
 * the help-system design notes in README.md).
 *
 * Supported markdown subset (anything else is ignored or rendered literally):
 *   - H1 (#) through H4 (####)
 *   - Paragraphs separated by blank lines
 *   - *italic* and **bold**
 *   - Bulleted lists (-) and numbered lists (1.), single level only
 *   - Pipe tables with a header separator row
 *   - Horizontal rules (---)
 *
 * Not supported (and not used in help content): code blocks, inline code,
 * links, images, blockquotes, nested lists, HTML passthrough.
 */

const HelpSystem = (() => {

  // ── markdown renderer ──────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Inline transforms run on already-escaped HTML — escaping happens first so
  // the markdown source can contain raw `<` without producing tags.
  function renderInline(text) {
    let out = escapeHtml(text);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return out;
  }

  function renderTable(rows) {
    // rows: array of pipe-trimmed strings, with rows[1] being the |---|---| separator.
    const splitCells = (row) =>
      row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

    const head = splitCells(rows[0]);
    const body = rows.slice(2).map(splitCells);

    let html = '<table class="help-table"><thead><tr>';
    for (const cell of head) html += `<th>${renderInline(cell)}</th>`;
    html += '</tr></thead><tbody>';
    for (const row of body) {
      html += '<tr>';
      for (const cell of row) html += `<td>${renderInline(cell)}</td>`;
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  function render(markdown) {
    const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
    const out = [];

    // Parser state: 'paragraph' | 'ul' | 'ol' | 'table' | null
    let mode = null;
    let buffer = []; // lines accumulated for the current block

    const flushParagraph = () => {
      if (!buffer.length) return;
      const joined = buffer.join(' ');
      out.push(`<p>${renderInline(joined)}</p>`);
      buffer = [];
    };
    const flushList = (tag) => {
      if (!buffer.length) return;
      let html = `<${tag}>`;
      for (const item of buffer) html += `<li>${renderInline(item)}</li>`;
      html += `</${tag}>`;
      out.push(html);
      buffer = [];
    };
    const flushTable = () => {
      if (buffer.length < 2) {
        // Malformed table (no separator row); fall back to paragraph.
        if (buffer.length) out.push(`<p>${renderInline(buffer.join(' '))}</p>`);
      } else {
        out.push(renderTable(buffer));
      }
      buffer = [];
    };
    const flush = () => {
      if (mode === 'paragraph') flushParagraph();
      else if (mode === 'ul')   flushList('ul');
      else if (mode === 'ol')   flushList('ol');
      else if (mode === 'table') flushTable();
      mode = null;
    };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');

      // Blank line ends the current block.
      if (line.trim() === '') { flush(); continue; }

      // Horizontal rule.
      if (/^-{3,}\s*$/.test(line)) {
        flush();
        out.push('<hr>');
        continue;
      }

      // Headers (#  H1 through ####  H4).  Require a space after the #s so
      // lines that just start with a # aren't misread.
      const headerMatch = /^(#{1,4})\s+(.+)$/.exec(line);
      if (headerMatch) {
        flush();
        const level = headerMatch[1].length;
        out.push(`<h${level}>${renderInline(headerMatch[2])}</h${level}>`);
        continue;
      }

      // Bulleted list item.
      const bulletMatch = /^[-*]\s+(.+)$/.exec(line);
      if (bulletMatch) {
        if (mode !== 'ul') { flush(); mode = 'ul'; }
        buffer.push(bulletMatch[1]);
        continue;
      }

      // Numbered list item.
      const numberedMatch = /^\d+\.\s+(.+)$/.exec(line);
      if (numberedMatch) {
        if (mode !== 'ol') { flush(); mode = 'ol'; }
        buffer.push(numberedMatch[1]);
        continue;
      }

      // Table row (must contain a pipe and not be the kind of line above).
      if (/^\|.*\|\s*$/.test(line)) {
        if (mode !== 'table') { flush(); mode = 'table'; }
        buffer.push(line);
        continue;
      }

      // Default: paragraph text (lines collapsed by space).
      if (mode !== 'paragraph') { flush(); mode = 'paragraph'; }
      buffer.push(line);
    }
    flush();

    return out.join('\n');
  }

  // ── overlay DOM ────────────────────────────────────────────────────────────

  // Per-game cache: gameType → rendered HTML string.  Render is cheap but
  // caching avoids reparsing every reopen.
  const htmlCache = new Map();
  let overlayEl = null;
  let bodyEl = null;
  let titleEl = null;
  let escListener = null;

  function ensureOverlay() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.className = 'help-overlay';
    overlayEl.style.display = 'none';
    overlayEl.innerHTML = `
      <div class="help-overlay-content" role="dialog" aria-modal="false" aria-label="Game rules">
        <div class="help-overlay-header">
          <h2 class="help-overlay-title">Help</h2>
          <button type="button" class="help-overlay-close" aria-label="Close">✕</button>
        </div>
        <div class="help-overlay-body"></div>
      </div>
    `;

    titleEl = overlayEl.querySelector('.help-overlay-title');
    bodyEl  = overlayEl.querySelector('.help-overlay-body');

    overlayEl.querySelector('.help-overlay-close').addEventListener('click', close);

    // Click on the dimmed area (but not the content) closes the overlay.
    // The spec acknowledges the UX trade-off — a stray click loses the
    // reader's place — and accepts it as the standard modal pattern.
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) close();
    });

    document.body.appendChild(overlayEl);
  }

  function open(gameType) {
    if (!gameType) return;
    ensureOverlay();

    titleEl.textContent = formatTitle(gameType);

    if (htmlCache.has(gameType)) {
      bodyEl.innerHTML = htmlCache.get(gameType);
      showOverlay();
    } else {
      bodyEl.innerHTML = '<p class="help-loading">Loading rules…</p>';
      showOverlay();
      API.getGameTypeHelp(gameType).then((data) => {
        const html = render(data.content || '');
        htmlCache.set(gameType, html);
        // Guard: a different game type may have been opened in the interim.
        if (titleEl.textContent === formatTitle(gameType)) {
          bodyEl.innerHTML = html;
        }
      }).catch((err) => {
        bodyEl.innerHTML = `<p class="help-error">Could not load help: ${escapeHtml(err.message)}</p>`;
      });
    }
  }

  function close() {
    if (!overlayEl) return;
    overlayEl.style.display = 'none';
    if (escListener) {
      document.removeEventListener('keydown', escListener);
      escListener = null;
    }
  }

  function isOpen() {
    return !!overlayEl && overlayEl.style.display !== 'none';
  }

  function showOverlay() {
    overlayEl.style.display = 'flex';
    bodyEl.scrollTop = 0;
    escListener = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escListener);
  }

  // Titles: 'tic-tac-toe' → 'Tic Tac Toe', etc.  Special-case 'life' which
  // would otherwise display as a bare 'Life'.
  function formatTitle(gameType) {
    const overrides = {
      'tic-tac-toe':   'Tic-Tac-Toe',
      'connect-four':  'Connect Four',
      'life':          'The Game of Life',
    };
    if (overrides[gameType]) return `${overrides[gameType]} — Rules`;
    return `${gameType.charAt(0).toUpperCase()}${gameType.slice(1)} — Rules`;
  }

  return { open, close, isOpen, render };

})();
