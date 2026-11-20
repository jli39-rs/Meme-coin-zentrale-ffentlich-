// Test des Axiom-Userscripts auf einer NACHGEBAUTEN Axiom-Seite (echtes axiom.trade ist hier nicht erreichbar).
// Preise (Jupiter) und Coin-Daten (DexScreener) sind gemockt. Prüft: Coin aus dem Link erkennen, Kauf, Take-Profit-Auto-Verkauf,
// Teilverkauf, Speichern nach Neuladen, Adresse von Hand einfügen, verkleinern.
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'axiom', 'axiom-paper.user.js'), 'utf8');
const PAIR = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', MINT = 'MoonMint1111111111111111111111111111111pump', MINT2 = 'Frog2Mint111111111111111111111111111111pump';
let price = 0.001;
(async () => {
  const b = await chromium.launch(); let fail = 0;
  const ok = (c, t) => { console.log((c ? '✓ ' : '✗ ') + t); if (!c) fail++; };
  const c = await b.newContext({ ...devices['iPad Pro 11'], hasTouch: true }); const p = await c.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route('https://axiom.trade/**', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body style="background:#000;color:#fff"><h1>Axiom (Attrappe)</h1></body></html>' }));
  await p.route('**/api.dexscreener.com/**', (r) => {
    const u = r.request().url(), pr = (m, s, pa) => ({ chainId: 'solana', pairAddress: pa, baseToken: { address: m, symbol: s, name: s + ' Coin' }, quoteToken: { address: 'So11111111111111111111111111111111111111112' }, priceUsd: String(price), liquidity: { usd: 85000 }, marketCap: 900000, info: { imageUrl: '' } });
    if (u.includes('/pairs/solana/' + PAIR)) return r.fulfill({ json: { pairs: [pr(MINT, 'MOON', PAIR)] } });
    if (u.includes('/tokens/' + MINT2)) return r.fulfill({ json: { pairs: [pr(MINT2, 'FROG', 'FrogPair')] } });
    r.fulfill({ json: { pairs: null } });
  });
  await p.route('**/lite-api.jup.ag/**', (r) => r.fulfill({ json: { So11111111111111111111111111111111111111112: { usdPrice: 150 }, [MINT]: { usdPrice: price, liquidity: 85000 }, [MINT2]: { usdPrice: 0.5 } } }));
  const load = async () => { await p.goto(`https://axiom.trade/meme/${PAIR}?chain=sol`); await p.addScriptTag({ content: SCRIPT }); await p.waitForTimeout(3500); };
  const sh = (sel) => p.evaluate((s) => document.getElementById('axpaper-host').shadowRoot.querySelector(s)?.textContent || '', sel);
  const click = (sel) => p.evaluate((s) => document.getElementById('axpaper-host').shadowRoot.querySelector(s).click(), sel);
  await load();
  const head = await sh('.w');
  ok(/MOON/.test(head) && /\$0\.001/.test(head), 'Coin aus dem Axiom-Link erkannt (MOON, $0.001)');
  let jupN = 0; const onReq = (r) => { if (r.url().includes('lite-api.jup.ag')) jupN++; }; p.on('request', onReq);
  await p.waitForTimeout(5000); p.off('request', onReq);
  ok(jupN >= 4 && jupN <= 7, `Preis-Abfrage etwa jede Sekunde (${jupN} in 5 s)`);
  await click('[data-buy="0.5"]'); await p.waitForTimeout(500);
  let st = await p.evaluate(() => JSON.parse(localStorage.getItem('axpaper-v1')));
  ok(st.pos[MINT] && Math.abs(st.cash - (5 - 0.5 - 0.0005)) < 1e-9, `Paper-Kauf 0.5 SOL · frei ${st.cash.toFixed(4)} SOL`);
  await p.evaluate(() => { const r = document.getElementById('axpaper-host').shadowRoot; const i = r.getElementById('tp'); i.value = '20'; i.dispatchEvent(new Event('change')); });
  price = 0.00115; await p.waitForTimeout(3000);
  ok(/\+/.test(await sh('.w')) && !!(await p.evaluate(() => JSON.parse(localStorage.getItem('axpaper-v1')).pos)), 'Kurs +15 %: Position im Plus, noch offen');
  await p.screenshot({ path: process.env.SHOT || 'axiom-paper.png' });
  price = 0.00125; await p.waitForTimeout(3000);
  st = await p.evaluate(() => JSON.parse(localStorage.getItem('axpaper-v1')));
  ok(!st.pos[MINT] && /Take-Profit/.test(st.closed[0]?.why) && st.closed[0].pnl > 0, `Take-Profit +20 % automatisch verkauft: ${st.closed[0]?.why} · ${st.closed[0]?.pnl.toFixed(4)} SOL`);
  await click('[data-buy="1"]'); await p.waitForTimeout(300); await click('[data-sell="0.5"]'); await p.waitForTimeout(300);
  st = await p.evaluate(() => JSON.parse(localStorage.getItem('axpaper-v1')));
  ok(st.pos[MINT] && st.closed[0].frac === 0.5, 'Teilverkauf 50 %');
  await load();
  ok(/Offene Positionen[\s\S]*MOON/.test(await sh('.w')), 'Depot bleibt nach Neuladen erhalten');
  // Echtes Tippen wie auf dem iPad: Feld antippen, einfügen, 2,5 s warten (Fenster aktualisiert sich), dann OK antippen
  await p.locator('#axpaper-host >> #ca').tap(); await p.keyboard.insertText('https://solscan.io/token/' + MINT2);
  await p.waitForTimeout(2500);
  await p.locator('#axpaper-host >> #go').tap(); await p.waitForTimeout(2500);
  ok(/FROG/.test(await sh('.sec:nth-child(3)')), 'Adresse/Link getippt und OK angetippt → FROG');
  // Axiom-Seite OHNE Adresse im Link, aber mit Solscan-Link auf der Seite → automatisch erkannt
  await p.route('https://axiom.trade/coin-ohne-adresse', (r) => r.fulfill({ contentType: 'text/html', body: `<html><body style="background:#000"><a href="https://solscan.io/token/${MINT2}">Solscan</a></body></html>` }));
  await p.evaluate(() => localStorage.clear());
  await p.goto('https://axiom.trade/coin-ohne-adresse'); await p.addScriptTag({ content: SCRIPT }); await p.waitForTimeout(3500);
  ok(/FROG/.test(await sh('.w')), 'Coin über Link auf der Seite erkannt (ohne Adresse in der URL)');
  // Anfrage-Limit (leere Antwort) → kurze Pause statt Dauerfeuer
  await p.unroute('**/lite-api.jup.ag/**'); let lim = 0;
  await p.route('**/lite-api.jup.ag/**', (r) => { lim++; r.fulfill({ json: {} }); });
  await p.waitForTimeout(5000);
  ok(lim >= 1 && lim <= 3 && /Pause/.test(await sh('.w')), `bei Limit kurze Pause (${lim} Abfragen in 5 s)`);
  await click('#min'); await p.waitForTimeout(200);
  ok(!!(await p.evaluate(() => document.getElementById('axpaper-host').shadowRoot.querySelector('.fab'))), 'verkleinert zur Blase');
  ok(errs.length === 0, 'keine JS-Fehler ' + errs.join(' | '));
  await b.close(); process.exit(fail ? 1 : 0);
})();
