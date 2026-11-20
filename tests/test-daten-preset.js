// Prüft die datenbasierte Stufe „📊 Daten“ (Backtest 20.11.2026): Standard für neue Nutzer, alte „Normal“-Nutzer werden einmal umgestellt,
// Einstiegsregeln (Liq ≥ 60k, ≥ 55 % Käufe, 5m ≥ +1 %), keine etablierten Coins, Zeit-Exit nach 10 Min auch im Plus, Ziel +8 %.
const { chromium } = require('playwright');
const { openBot } = require('./helpers');
(async () => {
  const b = await chromium.launch(); let fail = 0;
  const ok = (c, t) => { console.log((c ? '✓ ' : '✗ ') + t); if (!c) fail++; };
  const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  // Alle Daten-APIs leer → nur die Logik wird geprüft
  for (const h of ['coingecko', 'geckoterminal', 'dexscreener', 'rugcheck', 'jup.ag']) await p.route(`**/*${h}*/**`, (r) => r.fulfill({ json: h === 'coingecko' ? { solana: { usd: 150, eur: 140 } } : {} }));
  await p.addInitScript(() => { if (!sessionStorage.getItem('x')) { localStorage.setItem('claudebot-cfg', JSON.stringify({ risk: 'normal', neu: true, etabliert: true, rug: true })); sessionStorage.setItem('x', 1); } });
  await openBot(p); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const base = { src: 'gt', key: 'gt:T', sym: 'T', price: 1, liq: 80000, age: 600, fdv: 1e6, buys: 60, sells: 20, buyers: 40, ch5: 3, ch1: 10, vol5: 5000 };
    const sc = (o) => { const x = score({ ...base, ...o }); return x && (x.skip || 'ok'); };
    const out = { risk: CFG.risk, label: document.querySelector('#risk button.on')?.textContent,
      good: sc({}), lowLiq: sc({ liq: 40000 }), lowBp: sc({ buys: 30, sells: 30 }), flat: sc({ ch5: 0.5 }),
      cg: (score({ src: 'cg', key: 'cg:x', sym: 'X', mcap: 1e9, vol24: 1e8, ch1: 2, ch24: 5 }) || {}).skip };
    // Zeit-Exit: Position seit 11 Min im leichten Plus → wird trotzdem verkauft
    solUsd = solUsd || 150; mk['gt:T'] = { ...base, price: 1.03, t: Date.now() };
    S.pos['gt:T'] = { src: 'gt', sym: 'T', qty: 100, cost: 100 / 150, entry: 1, ts: Date.now() - 11 * 60000, peak: 0, tp: P().tp, sl: P().sl, liq0: 80000 };
    checkExits(); out.timeExit = !S.pos['gt:T'] && /Zeit-Exit/.test(S.tr[0]?.why || '');
    out.info = document.getElementById('rinfo').textContent;
    return out;
  });
  ok(r.risk === 'daten' && /Daten/.test(r.label || ''), `alte Einstellung „Normal“ → „${r.label}“`);
  ok(r.good === 'ok', 'guter Kandidat wird zugelassen');
  ok(/Liquidität/.test(r.lowLiq), 'Liquidität unter 60k blockiert: ' + r.lowLiq);
  ok(/Kaufdruck/.test(r.lowBp), '50 % Käufe blockiert: ' + r.lowBp);
  ok(/steigt kaum/.test(r.flat), '5m +0,5 % blockiert: ' + r.flat);
  ok(/nur Solana/.test(r.cg || ''), 'etablierte Coins aus: ' + r.cg);
  ok(r.timeExit, 'Zeit-Exit nach 10 Min auch im Plus');
  ok(/Ziel \+8%/.test(r.info) && /kein Trailing/.test(r.info), 'Anzeige: ' + r.info.slice(0, 90) + '…');
  // Nach dem Neuladen bleibt eine bewusst gewählte Stufe erhalten (keine zweite Umstellung)
  await p.click('#risk button[data-r="normal"]'); await p.reload(); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => CFG.risk) === 'normal', 'später gewähltes „Normal“ bleibt erhalten');
  ok(errs.length === 0, 'keine JS-Fehler ' + errs.join(' | '));
  await b.close(); process.exit(fail ? 1 : 0);
})();
