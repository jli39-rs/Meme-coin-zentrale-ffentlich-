// Benachrichtigung bei Kauf: Hinweis-Karte in der Seite + System-Mitteilung (Service Worker), mit gemockten Marktdaten.
const { chromium } = require('playwright');
const { openBot, mockRpc } = require('./helpers');
const t0 = Date.now();
const pair = (sym, price) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'PAIR' + sym, baseToken: { address: 'MINT' + sym, name: sym + ' Coin', symbol: sym }, quoteToken: { symbol: 'SOL' },
  priceUsd: String(price), txns: { m5: { buys: 70, sells: 25 } }, volume: { m5: 25000, h1: 120000 }, priceChange: { m5: 5, h1: 40, h24: 80 }, liquidity: { usd: 90000 }, fdv: 900000, pairCreatedAt: Date.now() - 45 * 60000, info: { imageUrl: '' } });
(async () => {
  const b = await chromium.launch({ channel: 'chromium' }); let fail = 0; // volles Headless: alte Headless-Shell meldet Mitteilungen immer als blockiert
  const ok = (c, t) => { console.log((c ? '✓ ' : '✗ ') + t); if (!c) fail++; };
  const c = await b.newContext({ viewport: { width: 1180, height: 1000 } });
  await c.grantPermissions(['notifications'], { origin: process.env.BASE_URL || 'http://localhost:8080' });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/api.geckoterminal.com/**', (r) => r.abort('failed'));
  await p.route('**/lite-api.jup.ag/**', (r) => r.fulfill({ json: {} }));
  await p.route('**/api.coingecko.com/**', (r) => r.fulfill({ json: r.request().url().includes('simple/price') ? { solana: { usd: 140, eur: 128 } } : [] }));
  await p.route('**/api.rugcheck.xyz/**', (r) => r.fulfill({ json: r.request().url().includes('insiders') ? [] : { token: { mintAuthority: null, freezeAuthority: null, supply: 1e15 }, markets: [{ pubkey: 'PAIRMOON', lp: { lpLockedPct: 100 } }], topHolders: [{ address: 'a', owner: 'o', pct: 4 }], risks: [], totalHolders: 900 } }));
  await p.route('**/api.dexscreener.com/**', (r) => { const u = r.request().url(); if (u.includes('token-profiles') || u.includes('token-boosts')) return r.fulfill({ json: [{ chainId: 'solana', tokenAddress: 'MINTMOON' }] }); r.fulfill({ json: { pairs: [pair('MOON', 0.002 * (1 + (Date.now() - t0) / 1e5))] } }); });
  await mockRpc(p);
  await openBot(p); await p.waitForTimeout(3000);
  await p.click('#n-btn'); await p.waitForTimeout(1500);
  console.log('   ', (await p.textContent('#n-btn')).trim(), '·', (await p.textContent('#n-info')).trim());
  ok(await p.evaluate(() => CFG.notify === true), 'Mitteilungen eingeschaltet');
  const toasts = [];
  await p.exposeFunction('__t', (x) => toasts.push(x));
  await p.evaluate(() => new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => window.__t(n.textContent)))).observe(document.getElementById('toasts'), { childList: true }));
  await p.waitForTimeout(25000);
  ok(toasts.some((t) => /Kauf: MOON/.test(t)), 'Hinweis in der Seite: ' + toasts.filter((t) => /Kauf/.test(t)).join(' | '));
  const sys = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? (await r.getNotifications()).map((n) => n.title + ' – ' + n.body) : ['kein Service Worker']; });
  ok(sys.some((t) => /Kauf: MOON/.test(t)), 'System-Mitteilung: ' + sys.join(' | '));
  ok(errs.length === 0, 'keine JS-Fehler ' + errs.join(' | '));
  await b.close(); process.exit(fail ? 1 : 0);
})();
