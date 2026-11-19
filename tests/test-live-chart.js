// Live-Test (echte APIs): Jupiter-Preise, eigener 1-Sekunden-Chart aus GeckoTerminal-Trades MIT Einstieg/Ziel/Stop,
// 1-Min-Chart, DexScreener-1s-Einbettung, Solana-Fokus (max. etablierte Coins).
const { chromium } = require('playwright');
const { openBot } = require('./helpers');
(async () => {
  const b = await chromium.launch(); let fail = 0;
  const ok = (c, t) => { console.log((c ? '✓ ' : '✗ ') + t); if (!c) fail++; };
  const p = await b.newPage({ viewport: { width: 1180, height: 1400 }, isMobile: true, hasTouch: true });
  const errs = [], jup = [];
  p.on('pageerror', (e) => errs.push({ msg: e.message, own: /localhost|github\.io/.test(e.stack || '') && !/dexscreener|geckoterminal/.test(e.stack || '') }));
  p.on('response', (r) => { if (r.url().includes('lite-api.jup.ag')) jup.push(r.status()); });
  await openBot(p); await p.waitForTimeout(20000);
  const st = await p.evaluate(() => ({ cg: Object.values(S.pos).filter((x) => x.src === 'cg').length, max: P().maxCg, all: Object.keys(S.pos).length }));
  ok(st.cg <= st.max, `Solana-Fokus: ${st.cg} von ${st.all} Positionen etabliert (max ${st.max})`);
  // Einen liquiden Solana-Coin (Papier) kaufen und in den Fokus legen
  const sym = await p.evaluate(() => { const m = Object.values(mk).filter((x) => x.pool && x.liq > 50000 && x.price && !S.pos[x.key]).sort((a, b) => (b.vol5 || 0) - (a.vol5 || 0))[0]; buy(m, 'Test', null); focusSel = m.key; render(); return m.sym; });
  await p.click('#chart-mode button[data-m="s1"]'); await p.waitForTimeout(15000);
  const s1 = await p.evaluate(() => ({ n: Object.keys(secBars[focusKey] || {}).length, lines: lines.length, canvas: document.querySelectorAll('#tv canvas').length, embed: $('tv').classList.contains('embed') }));
  ok(s1.n > 0 && s1.canvas > 0 && !s1.embed, `${sym}: 1s-Chart aus ${s1.n} Sekunden-Kerzen`);
  ok(s1.lines === 3, `Einstieg/Ziel/Stop eingezeichnet (${s1.lines} Linien)`);
  // Jupiter fragt nur offene Positionen + den Coin im Chart ab → erst nach dem Test-Kauf prüfen
  ok(jup.length >= 3 && jup.every((s) => s === 200), `Jupiter-Abrufe: ${jup.length} · ${(await p.textContent('#sub')).trim()}`);

  console.log('   ', (await p.textContent('#live-info')).trim());
  await p.locator('#focus-card').screenshot({ path: process.env.SHOT || 'live-1s.png' });
  await p.click('#chart-mode button[data-m="ds"]'); await p.waitForTimeout(10000);
  ok(/dexscreener\.com\/solana\/.+interval=1S/.test(await p.getAttribute('#tv iframe', 'src') || ''), 'DexScreener 1s eingebettet');
  await p.click('#chart-mode button[data-m="bot"]'); await p.waitForTimeout(8000);
  ok(await p.locator('#tv canvas').count() > 0 && !(await p.locator('#tv iframe').count()), '1-Min-Chart');
  const own = errs.filter((e) => e.own).map((e) => e.msg);
  ok(own.length === 0, 'keine JS-Fehler im Bot ' + own.join(' | '));
  await b.close(); process.exit(fail ? 1 : 0);
})();
