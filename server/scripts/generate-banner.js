/**
 * generate-banner.js
 *
 * Renders the README banner (docs/banner.png) from an inline HTML/SVG template
 * using headless Chromium. The design uses the app's own brand palette
 * (see client/css/main.css) so the banner matches the running game.
 *
 * Usage:
 *   cd server
 *   npm run banner
 *
 * Output: docs/banner.png (2× device scale → crisp ~2560×800 PNG)
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

// ── paths ───────────────────────────────────────────────────────────────────
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'docs');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'banner.png');

// ── dimensions ──────────────────────────────────────────────────────────────
const WIDTH = 1280;
const HEIGHT = 400;
const SCALE = 2;

// ── brand palette (from client/css/main.css) ────────────────────────────────
const COLORS = {
  bg: '#1a2e1a',
  surface: '#1f3820',
  surface2: '#243f25',
  border: '#2d5230',
  accent: '#4caf50',
  accentHover: '#66bb6a',
  text: '#e8f5e9',
  muted: '#8fac91',
  gradientFrom: '#1f3820',
  gradientTo: '#0d1f0d',
};

// ── banner markup ─────────────────────────────────────────────────────────--
// A wordmark + tagline on the brand gradient, with subtle game-piece motifs
// (dice pips, a checkers grid, an O/X, a Connect-Four disc) tucked into the
// corners at low opacity so they read as texture rather than clutter.
function bannerHtml() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
    color: ${COLORS.text};
    overflow: hidden;
  }
  .banner {
    position: relative;
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    background:
      radial-gradient(ellipse at 32% 38%, ${COLORS.surface2} 0%, ${COLORS.gradientFrom} 42%, ${COLORS.gradientTo} 100%);
    border-bottom: 4px solid ${COLORS.accent};
    overflow: hidden;
  }
  /* faint board-grid texture across the whole banner */
  .grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(to right, ${COLORS.border} 1px, transparent 1px),
      linear-gradient(to bottom, ${COLORS.border} 1px, transparent 1px);
    background-size: 40px 40px;
    opacity: 0.14;
  }
  /* soft accent glow behind the wordmark */
  .glow {
    position: absolute;
    left: -120px;
    top: 50%;
    transform: translateY(-50%);
    width: 720px;
    height: 720px;
    background: radial-gradient(circle, rgba(76, 175, 80, 0.18) 0%, transparent 62%);
  }
  .content {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 84px;
    z-index: 2;
  }
  .wordmark {
    display: flex;
    align-items: center;
    gap: 22px;
    font-size: 84px;
    font-weight: 800;
    letter-spacing: -2px;
    line-height: 1;
  }
  .wordmark .die { font-size: 76px; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.45)); }
  .wordmark .name { color: ${COLORS.text}; }
  .wordmark .name b { color: ${COLORS.accentHover}; font-weight: 800; }
  .tagline {
    margin-top: 20px;
    font-size: 27px;
    font-weight: 500;
    color: ${COLORS.muted};
    letter-spacing: 0.2px;
  }
  .chips {
    margin-top: 26px;
    display: flex;
    gap: 12px;
  }
  .chip {
    font-size: 17px;
    font-weight: 600;
    color: ${COLORS.text};
    background: ${COLORS.surface2};
    border: 1px solid ${COLORS.border};
    border-radius: 999px;
    padding: 8px 18px;
  }
  .chip .dot { color: ${COLORS.accent}; }
  /* decorative game pieces */
  .motif { position: absolute; z-index: 1; }
</style>
</head>
<body>
  <div class="banner">
    <div class="grid"></div>
    <div class="glow"></div>

    <!-- decorative motifs (low opacity) -->
    <svg class="motif" style="right: 96px; top: 54px; opacity: 0.9;" width="150" height="150" viewBox="0 0 100 100">
      <!-- die showing five pips -->
      <rect x="6" y="6" width="88" height="88" rx="18"
            fill="${COLORS.surface2}" stroke="${COLORS.accent}" stroke-width="3"/>
      <g fill="${COLORS.accentHover}">
        <circle cx="28" cy="28" r="7"/><circle cx="72" cy="28" r="7"/>
        <circle cx="50" cy="50" r="7"/>
        <circle cx="28" cy="72" r="7"/><circle cx="72" cy="72" r="7"/>
      </g>
    </svg>

    <svg class="motif" style="right: 300px; bottom: 40px; opacity: 0.5;" width="118" height="118" viewBox="0 0 100 100">
      <!-- checkers king disc -->
      <circle cx="50" cy="50" r="42" fill="${COLORS.border}" stroke="${COLORS.accent}" stroke-width="3"/>
      <circle cx="50" cy="50" r="26" fill="none" stroke="${COLORS.muted}" stroke-width="3"/>
      <path d="M36 52 l4 -14 6 9 4 -13 4 13 6 -9 4 14 z" fill="${COLORS.accentHover}"/>
    </svg>

    <svg class="motif" style="right: 150px; bottom: 60px; opacity: 0.55;" width="92" height="92" viewBox="0 0 100 100">
      <!-- tic-tac-toe O -->
      <circle cx="50" cy="50" r="34" fill="none" stroke="${COLORS.muted}" stroke-width="10"/>
    </svg>

    <svg class="motif" style="right: 460px; top: 70px; opacity: 0.4;" width="80" height="80" viewBox="0 0 100 100">
      <!-- tic-tac-toe X -->
      <g stroke="${COLORS.accent}" stroke-width="11" stroke-linecap="round">
        <line x1="22" y1="22" x2="78" y2="78"/>
        <line x1="78" y1="22" x2="22" y2="78"/>
      </g>
    </svg>

    <div class="content">
      <div class="wordmark">
        <span class="die">🎲</span>
        <span class="name">LAN&nbsp;<b>Games</b></span>
      </div>
      <div class="tagline">Self-hosted multiplayer board games for your LAN party</div>
      <div class="chips">
        <span class="chip">8 games</span>
        <span class="chip">real-time multiplayer</span>
        <span class="chip"><span class="dot">●</span> offline by design</span>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ── main ──────────────────────────────────────────────────────────────────--
async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: SCALE,
    });
    const page = await context.newPage();
    await page.setContent(bannerHtml(), { waitUntil: 'networkidle' });
    // Let fonts/emoji settle before capture.
    await page.waitForTimeout(400);
    await page.screenshot({ path: OUTPUT_PATH });
    await context.close();
  } finally {
    await browser.close();
  }

  const size = fs.statSync(OUTPUT_PATH).size;
  console.log(
    `✓ banner written to docs/banner.png (${(size / 1024).toFixed(0)} KB, ${WIDTH * SCALE}×${HEIGHT * SCALE})`,
  );
}

main().catch((err) => {
  console.error('\nBanner generation failed:', err);
  process.exit(1);
});
