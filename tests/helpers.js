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

// Attrappe für den Solana-RPC (Funding-Check). Wallets, deren Adresse mit "fund" beginnt, wurden vor 1 Std.
// von "HUBFUND" finanziert (frisch, gemeinsame Quelle); alle anderen Wallets haben keine Historie.
async function mockRpc(p) {
  await p.route('**/solana-rpc.publicnode.com/**', (r) => {
    const q = JSON.parse(r.request().postData() || '{}'), [a] = q.params || [];
    const res = (result) => r.fulfill({ json: { jsonrpc: '2.0', id: q.id, result } });
    if (q.method === 'getSignaturesForAddress') return res(String(a).startsWith('fund') ? [{ signature: 'sig-' + a, blockTime: Math.floor(Date.now() / 1000) - 3600 }] : []);
    if (q.method === 'getTransaction') { const w = String(a).slice(4); return res({ transaction: { message: { accountKeys: [{ pubkey: 'HUBFUND' }], instructions: [{ parsed: { type: 'transfer', info: { source: 'HUBFUND', destination: w, lamports: 1e8 } } }] } }, meta: { innerInstructions: [] } }); }
    res(null);
  });
}
module.exports.mockRpc = mockRpc;
