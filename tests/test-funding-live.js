// Live-Test (echte APIs): Bubblemaps-Logik für einen bestimmten Coin – RugCheck + Funding-Check über Solana-RPC.
// Standard: GTA "Grand Theft Alleycat" (8Cnv…pump, 11 Wallets mit je ~2,3 %) – muss BLOCKIERT werden.
// Andere Coins: MINT=<mint> POOL=<pool> node tests/test-funding-live.js
const { chromium } = require('playwright');
const { openBot } = require('./helpers');
const MINT = process.env.MINT || '8CnvwZJLRpQazvn6LszkzmXJxkmMY2bTQ4Q3NN4fpump';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1180, height: 1600 } });
  const errs = [], rpcSt = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('response', (r) => { if (r.url().includes('publicnode.com')) rpcSt.push(r.status()); });
  await openBot(p); await p.waitForTimeout(2000);
  await p.evaluate(([m, pool]) => { paused = true; upsert({ key: 'gt:test-' + m, src: 'gt', mint: m, pool, sym: 'TEST', name: m.slice(0, 6), price: 1, t: now() }); focusSel = 'gt:test-' + m; requestRug(m, pool); render(); }, [MINT, process.env.POOL || '']);
  const t0 = Date.now();
  await p.waitForFunction((m) => fund[m] && !fund[m].pending, MINT, { timeout: 120000 }).catch(() => {});
  await p.evaluate(() => render()); await p.waitForTimeout(1500);
  const r = await p.evaluate((m) => ({ fd: fund[m], rc: { score: rug[m]?.score, reject: rug[m]?.reject, hard: rug[m]?.hard, reasons: rug[m]?.reasons, equal: rug[m]?.equal, clusters: (rug[m]?.clusters || []).map((c) => `${c.type} ${c.size} W. ${c.pct.toFixed(1)}%`) } }), MINT);
  console.log('Funding-Check nach', ((Date.now() - t0) / 1000).toFixed(0), 's · RPC-Antworten:', rpcSt.length, 'Status', [...new Set(rpcSt)].join(','));
  console.log('Funding:', r.fd?.fail ? 'FEHLER ' + r.fd.fail : `${r.fd?.checked} Wallets geprüft · frisch ${r.fd?.fresh?.n} (${r.fd?.fresh?.pct?.toFixed(1)}%) · Quellen mit ≥2 Wallets: ${Object.entries(r.fd?.by || {}).filter(([, w]) => w.length >= 2).map(([s, w]) => s.slice(0, 6) + '×' + w.length).join(', ') || 'keine'}`);
  console.log('Ergebnis:', r.rc.reject ? 'BLOCKIERT' : 'bestanden', r.rc.score + '/100');
  console.log('Gründe:', r.rc.reasons.join(' | '));
  console.log('Cluster:', r.rc.clusters.join(' | ') || 'keine');
  await p.locator('#bubbles').evaluate((el) => el.closest('.card').scrollIntoView());
  await (await p.locator('#bubbles').evaluateHandle((el) => el.closest('.card'))).asElement().screenshot({ path: process.env.SHOT || 'funding.png' });
  console.log('JS-Fehler:', errs.length ? errs.join(' | ') : 'keine');
  await b.close();
  process.exit(!process.env.MINT && !r.rc.reject ? 1 : 0);
})();
