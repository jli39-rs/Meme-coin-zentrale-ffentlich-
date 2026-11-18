const { chromium } = require('playwright');
const t0 = Date.now();
const pair = (sym, price, o = {}) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'PAIR' + sym, baseToken: { address: 'MINT' + sym, name: sym + ' Coin', symbol: sym }, quoteToken: { symbol: 'SOL' },
  priceUsd: String(price), txns: { m5: { buys: 70, sells: 25 } }, volume: { m5: 25000, h1: 120000 }, priceChange: { m5: o.m5 ?? 5, h1: 40, h24: 80 }, liquidity: { usd: o.liq ?? 90000 }, fdv: 900000, pairCreatedAt: Date.now() - 45 * 60000, info: { imageUrl: '' } });
const good = { token: { mintAuthority: null, freezeAuthority: null }, markets: [{ lp: { lpLockedPct: 100 } }], topHolders: [{ address: 'a', owner: 'o', pct: 4 }, { address: 'b', owner: 'p', pct: 3 }], risks: [] };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 430, height: 1600 } });
  p.on('pageerror', e => console.log('ERR:', e.message));
  await p.route('**/api.geckoterminal.com/**', r => r.abort('failed'));   // wie Safari "Load failed"
  await p.route('**/api.coingecko.com/**', r => { const u = r.request().url(); if (u.includes('simple/price')) return r.fulfill({ json: { solana: { usd: 140 } } }); r.fulfill({ json: [] }); });
  await p.route('**/api.rugcheck.xyz/**', r => r.fulfill({ json: good }));
  await p.route('**/api.dexscreener.com/**', r => {
    const u = r.request().url(), dt = (Date.now() - t0) / 1000;
    if (u.includes('token-profiles') || u.includes('token-boosts')) return r.fulfill({ json: [{ chainId: 'solana', tokenAddress: 'MINTMOON' }, { chainId: 'ethereum', tokenAddress: '0x1' }] });
    r.fulfill({ json: { pairs: [pair('MOON', 0.002 * (1 + dt * 0.01)), { ...pair('MOON', 0.002, { liq: 500 }), pairAddress: 'SMALLPAIR' }] } });
  });
  await p.goto('http://localhost:8080/bot.html'); await p.waitForTimeout(400);
  await p.fill('#gc', process.env.ZENTRALE_CODE); await p.click('#gate button');
  await p.waitForTimeout(30000);
  for (const id of ['sub', 'val', 'usd', 'invested', 'rug-verdict']) console.log(id + ':', (await p.textContent('#' + id)).trim());
  console.log('trades:', (await p.locator('#trades-live .row').allInnerTexts()).map(s => s.replace(/\n/g, ' ')).join(' | '));
  console.log('chart canvas:', await p.locator('#tv canvas').count());
  await p.screenshot({ path: process.env.SHOT || 'shot.png' });
  await b.close();
})();
