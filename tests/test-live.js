// Live-Test OHNE Mocks: echte APIs (GeckoTerminal, DexScreener, CoinGecko, RugCheck) im Browser.
// Prüft CORS/Erreichbarkeit, ob Rug-Checks durchlaufen und zeigt die Bubble-Map eines Coins mit Insider-Netzwerk.
// Optional: MINT=<solana-mint> für die Bubble-Map, DAUER=<Sekunden> (Standard 90).
const { chromium } = require('playwright');
const { openBot } = require('./helpers');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 430, height: 1200 } });
  const errors = [], failed = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('requestfailed', (r) => failed.push(`${new URL(r.url()).host} ${r.failure()?.errorText}`));
  p.on('response', (r) => { if (r.status() >= 400 && /api\./.test(r.url())) failed.push(`${new URL(r.url()).host} HTTP ${r.status()}`); });
  await openBot(p);
  await p.waitForTimeout((+process.env.DAUER || 90) * 1000);
  console.log('sub:', (await p.textContent('#sub')).trim());
  const st = await p.evaluate(() => ({ log: JSON.parse(localStorage.getItem('claudebot')).log, rug: Object.entries(rug).map(([m, r]) => [m, r.fail ? 'FAIL' : r.pending ? '…' : `${r.score}/100 ${r.reject ? 'BLOCK' : 'ok'} cl=${(r.clusters || []).length} ${r.hard?.[0] || ''}`]) }));
  console.log('Rug-Checks:'); st.rug.forEach(([m, t]) => console.log('  ' + m.slice(0, 8), t));
  console.log('Log:'); st.log.slice(0, 15).forEach((l) => console.log(`  ${l.type} ${l.sym} · ${l.text}`));
  // Bubble-Map für einen Coin mit Netzwerken
  const mint = process.env.MINT || await p.evaluate(() => Object.keys(rug).find((m) => rug[m].clusters?.some((c) => c.members.length)));
  if (mint) {
    await p.evaluate((m) => { upsert({ key: 'gt:live-test', src: 'gt', mint: m, pool: '', sym: 'TEST', name: m.slice(0, 6), price: 1, t: now() }); focusSel = 'gt:live-test'; requestRug(m); render(); }, mint);
    await p.waitForTimeout(6000); await p.evaluate(() => render());
    console.log('Bubble-Map', mint.slice(0, 8), 'Bubbles:', await p.locator('#bubbles circle').count(), 'Pfeile:', await p.locator('#bubbles line').count());
    console.log((await p.textContent('#rug')).replace(/\s+/g, ' ').slice(0, 400));
    await p.locator('#bubbles').scrollIntoViewIfNeeded();
    await p.locator('#bubbles').evaluate((el) => el.closest('.card').scrollIntoView());
    await p.locator('#bubbles').evaluate(() => 0);
    await (await p.locator('#bubbles').evaluateHandle((el) => el.closest('.card'))).asElement().screenshot({ path: process.env.SHOT || 'live-bubbles.png' });
  } else console.log('Kein Coin mit Insider-Netzwerk gefunden – MINT=<mint> setzen.');
  console.log('Fehlgeschlagene Requests:', failed.length ? [...new Set(failed)].join(' | ') : 'keine');
  console.log('JS-Fehler:', errors.length ? errors.join(' | ') : 'keine');
  await b.close();
  process.exit(errors.length ? 1 : 0);
})();
