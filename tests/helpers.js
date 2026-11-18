// Gemeinsame Test-Helfer. Entsperren ohne Zugangscode: Der Gate prüft nur, ob im localStorage der Hash steht
// (der Hash ist ohnehin öffentlich in src/gate-config.js). Mit ZENTRALE_CODE wird stattdessen der echte Code eingegeben.
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8080';
async function openBot(p, file = 'bot.html') {
  if (!process.env.ZENTRALE_CODE) {
    const cfg = fs.readFileSync(path.join(__dirname, '..', 'src', 'gate-config.js'), 'utf8');
    const hash = cfg.match(/hash:"([0-9a-f]+)"/)[1];
    await p.addInitScript((h) => localStorage.setItem('zentrale-unlock', h), hash);
    await p.goto(`${BASE}/${file}`);
    return;
  }
  await p.goto(`${BASE}/${file}`); await p.waitForTimeout(400);
  await p.fill('#gc', process.env.ZENTRALE_CODE); await p.click('#gate button');
}
module.exports = { openBot };
