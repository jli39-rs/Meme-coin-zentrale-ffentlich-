// SOL-Kurs-Karte: Preis in EUR, Zeitraum-Buttons, Umrechner, Ersatz-Verlauf über GeckoTerminal wenn CoinGecko blockt.
// Läuft gegen die echten APIs (ohne Mocks), einmal normal und einmal mit gesperrtem CoinGecko.
const { chromium, devices } = require('playwright');
const { openBot } = require('./helpers');
(async () => {
  const b = await chromium.launch(); let fail = 0;
  const ok = (c, t) => { console.log((c ? '✓ ' : '✗ ') + t); if (!c) fail++; };
  for (const blockCG of [false, true]) {
    const c = await b.newContext({ ...devices['iPhone 14'] }); const p = await c.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    if (blockCG) await p.route('**/api.coingecko.com/**', (r) => r.fulfill({ status: 429, body: '' }));
    await openBot(p); await p.waitForTimeout(blockCG ? 25000 : 12000); // ohne CoinGecko wartet der Verlauf in der GeckoTerminal-Warteschlange
    const tag = blockCG ? '[CoinGecko gesperrt] ' : '';
    const price = (await p.textContent('#sol-big')).trim();
    ok(/^\d+,\d\d$/.test(price), `${tag}Preis angezeigt: ${price} ${(await p.textContent('#sol-cur')).trim()} · ${(await p.textContent('#sol-ch')).trim()}`);
    ok(await p.locator('#sol-chart canvas').count() > 0, `${tag}Chart gezeichnet`);
    await p.click('#sol-range button[data-d="365"]'); await p.waitForTimeout(5000);
    ok(/1 Jahr|Tage \(mehr Verlauf/.test(await p.textContent('#sol-ch')), `${tag}1 J.: ${(await p.textContent('#sol-ch')).trim()}`);
    console.log('   ', (await p.textContent('#sol-src')).trim());
    await p.fill('#cv-sol', '2'); await p.waitForTimeout(200);
    const fiat = +(await p.inputValue('#cv-fiat')), pr = +price.replace(',', '.');
    ok(Math.abs(fiat - 2 * pr) < 0.05, `${tag}Umrechner 2 SOL = ${fiat}`);
    await p.selectOption('#cv-cur', 'USD'); await p.waitForTimeout(5000);
    ok((await p.textContent('#sol-cur')).trim() === 'USD', `${tag}Umschalten auf USD: ${(await p.textContent('#sol-big')).trim()}`);
    ok(errs.length === 0, `${tag}keine JS-Fehler ${errs.join(' | ')}`);
    await c.close();
  }
  await b.close(); process.exit(fail ? 1 : 0);
})();
