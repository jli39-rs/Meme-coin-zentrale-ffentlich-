// Mock-Test im echten RugCheck-Format (Feldnamen geprüft am 18.11.2026):
// GOOD wird gekauft und mit Take-Profit verkauft, MINT (Mint-Authority), CLUS (Cluster 24 %), BUND (Bundle aus 14 Wallets),
// FUND (4 frische Top-Holder von einer Quelle finanziert) und EQUL (6 gleich große Wallets) werden blockiert.
const { chromium } = require('playwright');
const { openBot, mockRpc } = require('./helpers');
const pool = (addr, sym, price, o = {}) => ({ attributes: { address: addr, name: sym + ' / SOL', base_token_price_usd: String(price), fdv_usd: '500000', reserve_in_usd: String(o.liq ?? 80000), pool_created_at: new Date(Date.now() - (o.age ?? 30) * 60000).toISOString(), price_change_percentage: { m5: String(o.m5 ?? 4), h1: String(o.h1 ?? 30), h24: '50' }, transactions: { m5: { buys: 60, sells: 20, buyers: 40 } }, volume_usd: { m5: '20000', h1: '90000' } }, relationships: { base_token: { data: { id: 'solana_MINT' + sym } } } });
const inc = (sym) => ({ id: 'solana_MINT' + sym, attributes: { address: 'MINT' + sym, symbol: sym, name: sym + ' Token', image_url: 'missing.png' } });
const t0 = Date.now();
const SUPPLY = 1e15; // Rohwert wie bei Pump.fun (1 Mrd. Tokens, 6 Dezimalen)
const holders = (arr) => arr.map((h, i) => ({ address: 'acc' + i, owner: h.o || (h.f ? 'fund' + i : 'own' + i), pct: h.p, amount: h.p / 100 * SUPPLY, insider: !!h.i }));
const market = (o = {}) => ({ pubkey: 'mktPool', marketType: o.type || 'pump_fun_amm', liquidityA: 'acc0', liquidityB: 'accB', lp: { lpLockedPct: o.lp ?? 100, baseUSD: 40000, quoteUSD: 40000 } });
const base = (o) => ({ token: { mintAuthority: null, freezeAuthority: null, supply: SUPPLY, decimals: 6 }, markets: [market()], creator: 'devX', score_normalised: 5, totalHolders: 900,
  knownAccounts: { mktPool: { name: 'Pump Fun', type: 'AMM' }, devX: { name: 'Creator', type: 'CREATOR' } }, risks: [], graphInsidersDetected: 0, insiderNetworks: null, ...o });
// Insider-Graph: eine Quelle (hub) verteilt an n Wallets mit je p % → Ring wie bei Bubblemaps
const net = (id, hub, n, p) => ({ net_id: id, network_type: 'transfer',
  nodes: [{ id: hub, participant: true, holdings: 0 }, ...Array.from({ length: n }, (_, i) => ({ id: `${id}w${i}`, participant: true, holdings: p / 100 * SUPPLY }))],
  links: Array.from({ length: n }, (_, i) => ({ source: hub, target: `${id}w${i}` })) });
const summary = (g) => g.map((x) => ({ id: x.net_id, size: x.nodes.length, type: x.network_type, tokenAmount: 0, currentHolding: x.nodes.reduce((s, y) => s + y.holdings, 0), activeAccounts: x.nodes.length }));
const graphs = {
  MINTGOOD: [net('g1', 'hubG', 3, 0.5)],
  MINTCLUS: [net('c1', 'hubC', 15, 1.6), net('c2', 'hubD', 4, 0.5)],
  MINTBUND: [net('b1', 'hubB', 14, 0.4)],
};
const reports = {
  MINTGOOD: base({ topHolders: holders([{ p: 22 }, { p: 3.1 }, { p: 2.5 }, { p: 2.2, o: 'devX' }, { p: 2 }, { p: 1.8 }, { p: 1.5 }, { p: 1.2 }, { p: 1.1 }, { p: 1 }, { p: .9 }, { p: .8 }, { p: .7 }, { p: .6 }, { p: .5 }]),
    graphInsidersDetected: 3, insiderNetworks: summary(graphs.MINTGOOD) }),
  MINTMINT: base({ token: { mintAuthority: 'abc', freezeAuthority: null, supply: SUPPLY }, topHolders: holders([{ p: 5 }, { p: 3 }]), risks: [{ name: 'Mint Authority still enabled', level: 'danger' }] }),
  MINTCLUS: base({ topHolders: holders([{ p: 20 }, { p: 4 }, { p: 3 }]), graphInsidersDetected: 19, insiderNetworks: summary(graphs.MINTCLUS) }),
  MINTBUND: base({ topHolders: holders([{ p: 20 }, { p: 3 }, { p: 2 }]), graphInsidersDetected: 14, insiderNetworks: summary(graphs.MINTBUND) }),
  MINTFUND: base({ topHolders: holders([{ p: 20 }, { p: 2.1, f: 1 }, { p: 1.7, f: 1 }, { p: 1.5, f: 1 }, { p: 1.2, f: 1 }, { p: 0.6 }]) }),
  MINTEQUL: base({ topHolders: holders([{ p: 20 }, { p: 1.9 }, { p: 1.92 }, { p: 1.95 }, { p: 1.93 }, { p: 1.91 }, { p: 1.94 }, { p: 0.5 }]) }),
};
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 430, height: 3600 } });
  const errors = []; p.on('pageerror', e => { errors.push(e.message); console.log('ERR:', e.message); });
  await p.route('**/api.coingecko.com/**', r => r.fulfill({ json: r.request().url().includes('/ohlc') ? [] : [{ id: 'dogecoin', symbol: 'doge', name: 'Dogecoin', image: '', current_price: 0.2, market_cap: 3e10, total_volume: 2e9, price_change_percentage_24h: 1, price_change_percentage_1h_in_currency: 0.1 }] }));
  await p.route('**/api.dexscreener.com/**', r => r.fulfill({ json: [] }));
  await p.route('**/api.rugcheck.xyz/**', r => { const u = r.request().url(), m = u.match(/tokens\/(\w+)/)[1]; r.fulfill({ json: u.includes('/insiders/graph') ? (graphs[m] || []) : (reports[m] || {}) }); });
  await p.route('**/api.geckoterminal.com/**', r => {
    const u = r.request().url(), dt = (Date.now() - t0) / 1000;
    if (u.includes('token_price')) return r.fulfill({ json: { data: { attributes: { token_prices: { x: '150' } } } } });
    if (u.includes('ohlcv')) { const now = Math.floor(Date.now() / 1000 / 60) * 60; return r.fulfill({ json: { data: { attributes: { ohlcv_list: Array.from({ length: 60 }, (_, i) => { const c = 0.001 * (1 + Math.sin(i / 6) * 0.1 + i * 0.004); return [now - i * 60, c * 0.99, c * 1.02, c * 0.97, c, 1000]; }) } } } }); }
    const data = [pool('mktPool', 'GOOD', 0.001 * (1 + dt * 0.02)), pool('MINT', 'MINT', 0.5, { m5: 6 }), pool('CLUS', 'CLUS', 0.2, { m5: 5 }), pool('BUND', 'BUND', 0.3, { m5: 5.5 }), pool('FUND', 'FUND', 0.4, { m5: 5.2 }), pool('EQUL', 'EQUL', 0.6, { m5: 5.1 })];
    r.fulfill({ json: { data, included: [inc('GOOD'), inc('MINT'), inc('CLUS'), inc('BUND'), inc('FUND'), inc('EQUL')] } });
  });
  await mockRpc(p);
  await openBot(p);
  await p.waitForTimeout(70000);
  for (const id of ['sub', 'val', 'usd', 'delta', 'invested', 'rug-verdict']) console.log(id + ':', (await p.textContent('#' + id)).trim());
  // Logs/Trades stehen im localStorage (Anzeige zeigt nur die letzten 10)
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('claudebot')));
  const log = st.log.map((l) => `${l.type} ${l.sym} · ${l.text}`);
  console.log('log:\n' + log.slice(0, 25).join('\n'));
  const trades = st.tr.map((t) => `${t.side} ${t.sym} ${t.why}`);
  console.log('trades:\n' + trades.join('\n'));
  // Bubble-Map des Fokus-Coins (GOOD): Cluster-Ring + Pfeile
  await p.locator('#bubbles circle').first().waitFor();
  const circles = await p.locator('#bubbles circle').count(), arrows = await p.locator('#bubbles line[marker-end]').count();
  console.log('tv canvas:', await p.locator('#tv canvas').count(), 'bubbles:', circles, 'pfeile:', arrows, 'cluster-zeilen:', await p.locator('#clusters .row').count());
  await p.screenshot({ path: process.env.SHOT || 'shot.png', fullPage: true });
  await b.close();
  const has = (re) => log.some((l) => re.test(l));
  const checks = {
    'MINT blockiert (Mint-Authority)': has(/^RUG MINT .*Mint-Authority/),
    'CLUS blockiert (Cluster)': has(/^RUG CLUS .*Cluster aus 16 Wallets hält 24%/),
    'BUND blockiert (Bundle/Sniper)': has(/^RUG BUND .*Bundle\/Sniper: 14 Wallets/),
    'FUND blockiert (Funding-Cluster)': has(/^RUG FUND .*Funding-Cluster: 4 Top-Holder vom selben Wallet/),
    'EQUL blockiert (gleich große Wallets)': has(/^RUG EQUL .*Bundle: 6 Wallets halten je/),
    'GOOD gekauft': trades.some((t) => /^BUY GOOD/.test(t)),
    'GOOD mit Take-Profit verkauft': trades.some((t) => /^SELL GOOD Take-Profit/.test(t)),
    'Pool-Wallet (22 %) nicht als Holder gezählt': !has(/^RUG GOOD/),
    'Bubble-Map mit Pfeilen': arrows >= 3,
    'keine JS-Fehler': errors.length === 0,
  };
  let fail = 0;
  for (const [k, v] of Object.entries(checks)) { console.log((v ? '✓ ' : '✗ ') + k); if (!v) fail++; }
  process.exit(fail ? 1 : 0);
})();
