// Live-Test (echte APIs): schnelle Preise über Jupiter + Chart-Umschalter (Bot-Chart / GeckoTerminal 1s / DexScreener).
const { chromium } = require('playwright');
const { openBot } = require('./helpers');
(async () => {
  const b = await chromium.launch(); let fail = 0;
  const ok = (c, t) => { console.log((c ? '✓ ' : '✗ ') + t); if (!c) fail++; };
  const p = await b.newPage({ viewport: { width: 1180, height: 1400 }, isMobile: true, hasTouch: true });
  const errs = [], jup = []; p.on('pageerror', (e) => errs.push({ msg: e.message, own: /localhost|github\.io/.test(e.stack || '') && !/dexscreener|geckoterminal/.test(e.stack || '') }));
  p.on('response', (r) => { if (r.url().includes('lite-api.jup.ag')) jup.push(r.status()); });
  await openBot(p); await p.waitForTimeout(40000);
  const sub = (await p.textContent('#sub')).trim();
  ok(jup.length >= 5 && jup.every((s) => s === 200), `Jupiter-Abrufe: ${jup.length} (Status ${[...new Set(jup)].join(',')}) · ${sub}`);
  const live = await p.evaluate(() => Object.values(mk).filter((m) => m.live && Date.now() - m.live < 10000).map((m) => m.sym));
  ok(live.length > 0, `Live-Preise für: ${live.join(', ')}`);
  console.log('   ', (await p.textContent('#live-info')).trim());
  // Fokus auf einen Solana-Pool legen (bei etablierten Coins wie DOGE sind die Live-Charts gesperrt)
  await p.evaluate(() => { const m = Object.values(mk).filter((x) => x.pool && x.liq > 50000).sort((a, b) => b.liq - a.liq)[0]; focusSel = m.key; render(); });
  await p.waitForTimeout(3000);
  await p.click('#chart-mode button[data-m="live1s"]'); await p.waitForTimeout(15000);
  ok(/dexscreener\.com\/solana\/.+interval=1S/.test(await p.getAttribute('#tv iframe', 'src') || ''), 'DexScreener 1s eingebettet');
  const f1 = p.frames().find((f) => f.url().includes('dexscreener.com'));
  await p.waitForTimeout(5000);
  let cv = 0; for (const f of p.frames()) if (f !== p.mainFrame()) cv += await f.locator('canvas').count().catch(() => 0); // TradingView steckt in einem verschachtelten Frame
  ok(!!f1 && cv > 0, `DexScreener-Frame zeichnet den Chart (${cv} Canvas)`);
  await p.locator('#focus-card').screenshot({ path: process.env.SHOT || 'live-1s.png' });
  await p.click('#chart-mode button[data-m="gt"]'); await p.waitForTimeout(6000);
  ok(/geckoterminal\.com\/solana\/pools\//.test(await p.getAttribute('#tv iframe', 'src') || ''), 'GeckoTerminal eingebettet');
  await p.click('#chart-mode button[data-m="bot"]'); await p.waitForTimeout(6000);
  ok(await p.locator('#tv canvas').count() > 0, 'zurück zum Bot-Chart');
  // Fehler aus den eingebetteten Fremdseiten (z. B. "Failed to fetch" für Tracking) zählen nicht
  const own = errs.filter((e) => e.own).map((e) => e.msg);
  console.log('    Fehler aus eingebetteten Fremd-Charts (ignoriert):', errs.filter((e) => !e.own).length);
  ok(own.length === 0, 'keine JS-Fehler im Bot ' + own.join(' | '));
  await b.close(); process.exit(fail ? 1 : 0);
})();
