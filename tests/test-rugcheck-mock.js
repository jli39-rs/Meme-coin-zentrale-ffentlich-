const { chromium } = require('playwright');
const pool = (addr, sym, price, o = {}) => ({ attributes: { address: addr, name: sym + ' / SOL', base_token_price_usd: String(price), fdv_usd: '500000', reserve_in_usd: String(o.liq ?? 80000), pool_created_at: new Date(Date.now() - (o.age ?? 30) * 60000).toISOString(), price_change_percentage: { m5: String(o.m5 ?? 4), h1: String(o.h1 ?? 30), h24: '50' }, transactions: { m5: { buys: 60, sells: 20, buyers: 40 } }, volume_usd: { m5: '20000', h1: '90000' } }, relationships: { base_token: { data: { id: 'solana_MINT' + sym } } } });
const inc = (sym) => ({ id: 'solana_MINT' + sym, attributes: { address: 'MINT' + sym, symbol: sym, name: sym + ' Token', image_url: 'missing.png' } });
const t0 = Date.now();
const holders = (arr) => arr.map((h, i) => ({ address: 'acc' + i, owner: h.o || 'own' + i, pct: h.p, insider: !!h.i }));
const reports = {
  MINTGOOD: { token: { mintAuthority: null, freezeAuthority: null }, markets: [{ pubkey: 'mkt1', lp: { lpLockedPct: 100 }, liquidityAAccount: 'acc0' }], creator: 'devX', score_normalised: 5,
    topHolders: holders([{ p: 22 }, { p: 3.1 }, { p: 2.5 }, { p: 2.2, o: 'devX' }, { p: 2 }, { p: 1.8 }, { p: 1.5 }, { p: 1.2 }, { p: 1.1 }, { p: 1 }, { p: .9 }, { p: .8 }, { p: .7 }, { p: .6 }, { p: .5 }]), risks: [] },
  MINTMINT: { token: { mintAuthority: 'abc', freezeAuthority: null }, markets: [{ lp: { lpLockedPct: 100 } }], topHolders: holders([{ p: 5 }, { p: 3 }]), risks: [{ name: 'Mint Authority still enabled', level: 'danger' }] },
  MINTCLUS: { token: { mintAuthority: null, freezeAuthority: null }, markets: [{ lp: { lpLockedPct: 95 } }], graphInsidersDetected: 3,
    topHolders: holders([{ p: 9, i: 1 }, { p: 8, i: 1 }, { p: 7, i: 1 }, { p: 6, i: 1 }, { p: 4 }, { p: 3 }]), risks: [] },
};
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 430, height: 3600 } });
  p.on('pageerror', e => console.log('ERR:', e.message));
  await p.route('**/api.coingecko.com/**', r => r.fulfill({ json: r.request().url().includes('/ohlc') ? [] : [{ id: 'dogecoin', symbol: 'doge', name: 'Dogecoin', image: '', current_price: 0.2, market_cap: 3e10, total_volume: 2e9, price_change_percentage_24h: 1, price_change_percentage_1h_in_currency: 0.1 }] }));
  await p.route('**/api.rugcheck.xyz/**', r => { const m = r.request().url().match(/tokens\/(\w+)/)[1]; r.fulfill({ json: reports[m] || {} }); });
  await p.route('**/api.geckoterminal.com/**', r => {
    const u = r.request().url(), dt = (Date.now() - t0) / 1000;
    if (u.includes('token_price')) return r.fulfill({ json: { data: { attributes: { token_prices: { x: '150' } } } } });
    if (u.includes('ohlcv')) { const now = Math.floor(Date.now() / 1000 / 60) * 60; return r.fulfill({ json: { data: { attributes: { ohlcv_list: Array.from({ length: 60 }, (_, i) => { const c = 0.001 * (1 + Math.sin(i / 6) * 0.1 + i * 0.004); return [now - i * 60, c * 0.99, c * 1.02, c * 0.97, c, 1000]; }) } } } }); }
    const data = [pool('GOOD', 'GOOD', 0.001 * (1 + dt * 0.02)), pool('MINT', 'MINT', 0.5, { m5: 6 }), pool('CLUS', 'CLUS', 0.2, { m5: 5 })];
    r.fulfill({ json: { data, included: [inc('GOOD'), inc('MINT'), inc('CLUS')] } });
  });
  await p.goto('http://localhost:8080/bot.html'); await p.waitForTimeout(400);
  await p.fill('#gc', process.env.ZENTRALE_CODE); await p.click('#gate button');
  await p.waitForTimeout(40000);
  for (const id of ['sub', 'val', 'usd', 'delta', 'invested', 'rug-verdict']) console.log(id + ':', (await p.textContent('#' + id)).trim());
  console.log('log:\n' + (await p.locator('#log .row').allInnerTexts()).map(s => s.replace(/\n/g, ' ')).join('\n'));
  console.log('trades:\n' + (await p.locator('#trades-live .row').allInnerTexts()).map(s => s.replace(/\n/g, ' ')).join('\n'));
  console.log('tv canvas:', await p.locator('#tv canvas').count(), 'bubbles:', await p.locator('#bubbles circle').count());
  await p.screenshot({ path: process.env.SHOT || 'shot.png', fullPage: true });
  await b.close();
})();
