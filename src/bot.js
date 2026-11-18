// Claude Bot v2 – reine Paper-Trading-Simulation (virtuelles Geld, kein Wallet).
// Quellen: CoinGecko (etablierte Meme Coins) + GeckoTerminal (neue & trendende Solana-Pools).
const CG = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=meme-token&order=volume_desc&per_page=100&page=1&price_change_percentage=1h,24h";
const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
const START = 100, TICK_MS = 5000;
const FEE = { cg: 0.003, gt: 0.01 }; // simulierte Gebühr + Slippage je Kauf/Verkauf
const PRESETS = {
  vorsichtig: { size: 0.06, tp: 12, sl: 6, trailOn: 6, trail: 3, maxPos: 5, minScore: 3.5, minLiq: 60000, timeMin: 120 },
  normal:     { size: 0.10, tp: 25, sl: 10, trailOn: 10, trail: 5, maxPos: 6, minScore: 3, minLiq: 25000, timeMin: 60 },
  aggressiv:  { size: 0.15, tp: 80, sl: 18, trailOn: 20, trail: 10, maxPos: 8, minScore: 2.5, minLiq: 10000, timeMin: 30 },
};
const LABEL = { vorsichtig: "Vorsichtig", normal: "Normal", aggressiv: "Aggressiv" };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const usd = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sgn = (n) => (n >= 0 ? "+" : "-") + "$" + Math.abs(n).toFixed(2);
const fmtP = (n) => !n ? "–" : "$" + (n >= 1 ? n.toFixed(2) : n.toPrecision(3));
const big = (n) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const pct = (n) => (n >= 0 ? "+" : "") + (n ?? 0).toFixed(1) + "%";
const store = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };

const fresh = () => ({ v: 2, cash: START, pos: {}, hist: [START], trades: 0, wins: 0, losses: 0, log: [], tr: [], calls: [0, 0, 0], cool: {}, best: 0, worst: 0, since: Date.now() });
let S = store("claudebot", null) || fresh();
let CFG = store("claudebot-cfg", { risk: "normal", neu: true, etabliert: true });
const mk = {}; // Marktdaten: key -> Coin/Pool
let paused = false, errs = {};

// Migration vom alten Format (Schlüssel ohne Quelle)
if (S.v !== 2) {
  const pos = {};
  for (const [k, p] of Object.entries(S.pos || {})) pos[k.includes(":") ? k : "cg:" + k] = { src: "cg", entry: p.cost / p.qty, ts: Date.now(), tp: 25, sl: 10, ...p, peak: 0 };
  S = { ...fresh(), ...S, v: 2, pos, cool: {}, tr: S.tr || [], best: 0, worst: 0 };
}
const save = () => { try { localStorage.setItem("claudebot", JSON.stringify(S)); localStorage.setItem("claudebot-cfg", JSON.stringify(CFG)); } catch {} };
const P = () => PRESETS[CFG.risk] || PRESETS.normal;

// ---------- Daten laden ----------
async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }

async function loadCG() {
  const d = await getJSON(CG);
  for (const c of d) mk["cg:" + c.id] = {
    key: "cg:" + c.id, src: "cg", sym: c.symbol.toUpperCase(), name: c.name, img: c.image, price: c.current_price,
    mcap: c.market_cap, vol24: c.total_volume, ch1: c.price_change_percentage_1h_in_currency ?? 0, ch24: c.price_change_percentage_24h ?? 0, t: Date.now(),
  };
}
function gtItems(json, extra = {}) {
  const inc = {};
  (json.included || []).forEach((t) => (inc[t.id] = t.attributes));
  return (json.data || []).map((p) => {
    const a = p.attributes, tok = inc[p.relationships?.base_token?.data?.id] || {};
    const pc = a.price_change_percentage || {}, tx = a.transactions || {}, vol = a.volume_usd || {};
    return {
      key: "gt:" + a.address, src: "gt", sym: String(tok.symbol || a.name.split(" / ")[0]).toUpperCase().slice(0, 12), name: tok.name || a.name,
      img: tok.image_url && tok.image_url !== "missing.png" ? tok.image_url : "", price: +a.base_token_price_usd,
      fdv: +(a.fdv_usd || 0), liq: +(a.reserve_in_usd || 0), ch5: +(pc.m5 || 0), ch1: +(pc.h1 || 0), ch24: +(pc.h24 || 0),
      buys: tx.m5?.buys || 0, sells: tx.m5?.sells || 0, vol5: +(vol.m5 || 0), vol1: +(vol.h1 || 0),
      age: a.pool_created_at ? (Date.now() - new Date(a.pool_created_at)) / 60000 : null, t: Date.now(), ...extra,
    };
  });
}
async function loadGT() {
  const [n, t] = await Promise.all([getJSON(GT + "/new_pools?include=base_token"), getJSON(GT + "/trending_pools?include=base_token")]);
  for (const x of [...gtItems(n, { neu: true }), ...gtItems(t, { trend: true })]) mk[x.key] = { ...mk[x.key], ...x };
}
async function loadHeld() {
  const a = Object.keys(S.pos).filter((k) => k.startsWith("gt:")).map((k) => k.slice(3));
  if (!a.length) return;
  const d = await getJSON(GT + "/pools/multi/" + a.slice(0, 30).join(",") + "?include=base_token");
  for (const x of gtItems(d)) mk[x.key] = { ...mk[x.key], ...x };
}
async function safe(name, fn) {
  try { await fn(); delete errs[name]; } catch (e) { errs[name] = e.message; }
  render();
}

// ---------- Strategie ----------
const price = (k) => mk[k]?.price || 0;
const netVal = (k, p) => p.qty * (price(k) || p.entry) * (1 - FEE[p.src]);
const equity = () => S.cash + Object.entries(S.pos).reduce((s, [k, p]) => s + netVal(k, p), 0);

function score(m) {
  const R = P();
  if (m.src === "cg") {
    if (!CFG.etabliert) return null;
    if (m.mcap < 5e6 || m.vol24 / m.mcap < 0.03) return { skip: "Safety: zu wenig Volumen" };
    const s = 2 + m.ch1 / 1.2 + m.ch24 / 20;
    return { s, why: `1h ${pct(m.ch1)} · 24h ${pct(m.ch24)}` };
  }
  if (!CFG.neu || !m.price) return null;
  if (m.liq < R.minLiq) return { skip: `Safety: Liquidität nur $${big(m.liq)}` };
  if (m.age != null && m.age < 3) return { skip: "Safety: Pool jünger als 3 Min" };
  if (m.fdv && m.fdv / Math.max(m.liq, 1) > 80) return { skip: "Safety: FDV/Liquidität verdächtig hoch" };
  const tx = m.buys + m.sells;
  if (tx < 15) return { skip: `Safety: nur ${tx} Trades in 5 Min` };
  if (m.ch1 > 500) return { skip: `Risk: schon ${pct(m.ch1)} in 1h – zu spät` };
  const bp = m.buys / tx;
  if (bp < 0.5) return { skip: `Analyst: Verkaufsdruck (${(bp * 100).toFixed(0)}% Käufe)` };
  if (m.ch5 < -3) return { skip: `Analyst: fällt gerade (${pct(m.ch5)} in 5 Min)` };
  const s = 1.2 + m.ch5 / 4 + Math.min(m.ch1, 150) / 50 + (bp - 0.5) * 6 + Math.min((m.vol5 / Math.max(m.liq, 1)) * 15, 1.5);
  return { s, why: `5m ${pct(m.ch5)} · ${(bp * 100).toFixed(0)}% Käufe · Liq $${big(m.liq)}` };
}

function log(type, sym, text) {
  S.log.unshift({ t: new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }), type, sym, text });
  S.log = S.log.slice(0, 40);
}

function sell(k, reason) {
  const p = S.pos[k], now = price(k) || p.entry, got = netVal(k, p), pnl = got - p.cost;
  S.cash += got; delete S.pos[k]; S.trades++; S.cool[k] = Date.now();
  pnl >= 0 ? S.wins++ : S.losses++;
  S.best = Math.max(S.best, pnl); S.worst = Math.min(S.worst, pnl);
  S.tr.unshift({ ts: Date.now(), side: "SELL", sym: p.sym, p: now, amt: got, pnl, why: reason });
  S.tr = S.tr.slice(0, 60);
  log("SELL", p.sym, `${sgn(pnl)} · ${reason}`);
  S.calls[2]++;
}

function tick() {
  if (paused) return;
  const R = P();
  // 1) Ausstiege prüfen
  for (const [k, p] of Object.entries(S.pos)) {
    const m = mk[k]; if (!m || Date.now() - m.t > 10 * 60000) continue; // keine frischen Daten
    const ch = (netVal(k, p) / p.cost - 1) * 100;
    p.peak = Math.max(p.peak || 0, ch);
    const mins = (Date.now() - p.ts) / 60000;
    if (ch >= p.tp) sell(k, `Take-Profit ${pct(ch)}`);
    else if (ch <= -p.sl) sell(k, `Stop-Loss ${pct(ch)}`);
    else if (p.peak >= R.trailOn && p.peak - ch >= R.trail) sell(k, `Trailing-Stop (Hoch ${pct(p.peak)})`);
    else if (mins > R.timeMin && ch < 2) sell(k, `Zeit-Exit nach ${Math.round(mins)} Min`);
  }
  // 2) Neuen Einstieg suchen
  const cands = Object.values(mk).filter((m) => !S.pos[m.key] && !(Date.now() - (S.cool[m.key] || 0) < 30 * 60000) && Date.now() - m.t < 5 * 60000);
  if (cands.length && Object.keys(S.pos).length < R.maxPos) {
    S.calls[0]++;
    let best = null, lastSkip = null;
    for (const m of cands) {
      const r = score(m); if (!r) continue;
      if (r.skip) { lastSkip = [m, r.skip]; continue; }
      if (!best || r.s > best.r.s) best = { m, r };
    }
    S.calls[1]++;
    if (best && best.r.s >= R.minScore) {
      const { m, r } = best, size = Math.min(S.cash, equity() * R.size);
      if (size >= 1) {
        const qty = (size * (1 - FEE[m.src])) / m.price;
        S.cash -= size;
        S.pos[m.key] = { src: m.src, sym: m.sym, name: m.name, img: m.img, qty, cost: size, entry: m.price, ts: Date.now(), peak: 0, tp: R.tp, sl: R.sl, neu: !!m.neu };
        S.trades++; S.calls[2]++;
        S.tr.unshift({ ts: Date.now(), side: "BUY", sym: m.sym, p: m.price, amt: size, pnl: null, why: (m.neu ? "🆕 " : m.src === "gt" ? "🔥 " : "") + r.why });
        S.tr = S.tr.slice(0, 60);
        log("BUY", m.sym, `Score ${r.s.toFixed(1)} · ${r.why}`);
      } else log("SKIP", m.sym, "Risk: kein Cash frei");
    } else if (best) log("SKIP", best.m.sym, `Score ${best.r.s.toFixed(1)} < ${R.minScore} · ${best.r.why}`);
    else if (lastSkip) log("SKIP", lastSkip[0].sym, lastSkip[1]);
  }
  S.hist.push(equity()); S.hist = S.hist.slice(-400);
  save(); render();
}

// ---------- Anzeige ----------
function chart() {
  const h = S.hist, min = Math.min(...h, START), max = Math.max(...h, START), r = max - min || 1;
  const y = (v) => 105 - ((v - min) / r) * 95;
  const pts = h.map((v, i) => `${(i / Math.max(h.length - 1, 1)) * 400},${y(v)}`);
  const last = pts[pts.length - 1].split(","), up = h[h.length - 1] >= START, col = up ? "#1faa59" : "#e5484d";
  $("chart").innerHTML = `<line x1="0" x2="400" y1="${y(START)}" y2="${y(START)}" stroke="#ccc" stroke-dasharray="4 4"/>
    <polygon points="0,110 ${pts.join(" ")} 400,110" fill="${up ? "rgba(31,170,89,.12)" : "rgba(229,72,77,.10)"}"/>
    <polyline points="${pts.join(" ")}" fill="none" stroke="${col}" stroke-width="2"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="#fff" stroke="#111" stroke-width="2"/>`;
}

function render() {
  const R = P(), v = equity(), pnl = v - START, el = Math.floor((Date.now() - S.since) / 60000);
  const nNew = Object.values(mk).filter((m) => m.neu).length, nCg = Object.values(mk).filter((m) => m.src === "cg").length;
  $("val").textContent = usd(v);
  $("delta").textContent = sgn(pnl); $("delta").className = "delta " + (pnl >= 0 ? "up" : "down");
  $("start").textContent = "$" + START; $("trades").textContent = S.trades;
  $("mult").textContent = (v / START).toFixed(2) + "×";
  $("wl").textContent = `${sgn(pnl)} · ${S.wins}W ${S.losses}L`; $("wl").className = pnl >= 0 ? "up" : "down";
  $("clock").textContent = `${Math.floor(el / 60)}h ${el % 60}m aktiv`;
  const e = Object.entries(errs);
  $("sub").textContent = e.length ? "⚠ " + e.map(([k, m]) => `${k}: ${m}`).join(" · ") + " – neuer Versuch folgt"
    : `${nCg} etablierte · ${nNew} neue Coins live · Modus ${LABEL[CFG.risk]}`;
  const SRC = [["CoinGecko", "etablierte Meme Coins"], ["GeckoTerminal", "neue & trendende Pools"], ["Paper-Executor", "Kauf/Verkauf"]];
  $("repos").innerHTML = SRC.map((s, i) => `<div class="repo"><span>● ${s[0]} <span class="mut">· ${s[1]}</span></span><b class="up">${S.calls[i]} calls</b></div>`).join("");

  // Statistik
  const n = S.wins + S.losses;
  $("stats").innerHTML = `<div><span class="mut">Trefferquote</span><b>${n ? Math.round((S.wins / n) * 100) : 0}%</b></div>
    <div><span class="mut">Bester</span><b class="up">${sgn(S.best || 0)}</b></div>
    <div><span class="mut">Schlechtester</span><b class="down">${sgn(S.worst || 0)}</b></div>
    <div><span class="mut">Cash</span><b>${usd(S.cash)}</b></div>`;

  // Positionen
  const pe = Object.entries(S.pos);
  const inv = pe.reduce((s, [k, p]) => s + netVal(k, p), 0);
  $("invested").textContent = pe.length ? `${usd(inv)} in ${pe.length} Coin${pe.length > 1 ? "s" : ""}` : "nichts offen";
  $("positions").innerHTML = pe.map(([k, p]) => {
    const now = price(k) || p.entry, val = netVal(k, p), pl = val - p.cost, pc = (val / p.cost - 1) * 100;
    const bar = Math.max(0, Math.min(100, ((pc + p.sl) / (p.tp + p.sl)) * 100));
    const mins = Math.floor((Date.now() - p.ts) / 60000);
    const tag = p.neu ? '<span class="chip new">NEU</span>' : p.src === "gt" ? '<span class="chip hot">TREND</span>' : "";
    return `<div class="pos"><div class="row"><b>${p.img ? `<img src="${esc(p.img)}" alt="">` : ""}${esc(p.sym)} ${tag} <span class="mut">${esc(p.name)}</span></b><b class="${pl >= 0 ? "up" : "down"}">${sgn(pl)} (${pct(pc)})</b></div>
      <div class="row mut"><span>Einstieg ${fmtP(p.entry)} → jetzt ${fmtP(now)}</span><span>${usd(val)} · ${mins} Min</span></div>
      <div class="bar"><i style="width:${bar}%" class="${pl >= 0 ? "g" : "r"}"></i></div>
      <div class="row mut small"><span>Stop −${p.sl}%</span><span>Hoch ${pct(p.peak || 0)}</span><span>Ziel +${p.tp}%</span></div></div>`;
  }).join("") || "<div class='mut'>Der Bot ist gerade in keinem Coin – er wartet auf ein gutes Signal.</div>";

  // Agenten
  $("agents").innerHTML = [
    ["scanner", "SCANNER", `${nCg + nNew} Coins im Blick (${nNew} neu)`],
    ["safety", "SAFETY", `Liquidität ≥ $${big(R.minLiq)} · Pool ≥ 3 Min · Kaufdruck`],
    ["analyst", "ANALYST", `Momentum 5m/1h · Score ≥ ${R.minScore}`],
    ["risk", "RISK", `${R.size * 100}% pro Trade · Stop −${R.sl}% · Trailing ${R.trail}%`],
    ["executor", "EXECUTOR", `${pe.length}/${R.maxPos} Positionen · Gebühren eingerechnet`],
  ].map((a) => `<div class="row"><span class="tag a-${a[0]}">${a[1]}</span><span class="txt">${esc(a[2])}</span></div>`).join("");

  // Live-Trades
  $("tcount").textContent = S.tr.length + " Trades";
  $("trades-live").innerHTML = S.tr.slice(0, 12).map((x, i) => `<div class="row trade${i === 0 && Date.now() - x.ts < 8000 ? " new" : ""}"><span class="mut">${new Date(x.ts).toLocaleTimeString("de-DE")}</span><span class="${x.side === "BUY" ? "buy" : "sell"}">${x.side}</span><span class="txt">${esc(x.sym)} @ ${fmtP(x.p)} · ${usd(x.amt)}${x.pnl == null ? "" : ` · <b class="${x.pnl >= 0 ? "up" : "down"}">${sgn(x.pnl)}</b>`}<br><span class="mut small">${esc(x.why || "")}</span></span></div>`).join("") || "<div class='mut'>Noch keine Trades – der Bot sucht Einstiege…</div>";

  // Entscheidungen
  $("log").innerHTML = S.log.slice(0, 8).map((l) => `<div class="row"><span class="mut">${l.t}</span><span class="${l.type === "BUY" ? "buy" : l.type === "SELL" ? "sell" : "mut"}">${l.type}</span><span class="txt">${esc(l.sym)} · ${esc(l.text)}</span></div>`).join("") || "<div class='mut'>Warte auf Marktdaten…</div>";

  // Ticker: stärkste Coins der letzten Stunde
  $("ticker").innerHTML = Object.values(mk).filter((m) => m.price).sort((a, b) => b.ch1 - a.ch1).slice(0, 15)
    .map((m) => `<span>${m.neu ? "🆕" : ""}${esc(m.sym)} ${fmtP(m.price)} <i class="${m.ch1 >= 0 ? "up" : "down"}">${pct(m.ch1)} 1h</i></span>`).join("");

  // Einstellungen
  document.querySelectorAll("#risk button").forEach((b) => b.classList.toggle("on", b.dataset.r === CFG.risk));
  $("c-neu").checked = CFG.neu; $("c-et").checked = CFG.etabliert;
  $("rinfo").textContent = `Ziel +${R.tp}% · Stop −${R.sl}% · Trailing ab +${R.trailOn}% (−${R.trail}%) · max ${R.maxPos} Coins · Zeit-Exit nach ${R.timeMin} Min`;
  $("live").textContent = paused ? "⏸ Pause" : "● Live";
  chart();
}

// ---------- Bedienung ----------
$("toggle").onclick = () => { paused = !paused; $("toggle").textContent = paused ? "▶ Weiter" : "⏸ Pause"; render(); };
$("reset").onclick = () => {
  if ($("reset").dataset.armed) { S = fresh(); save(); delete $("reset").dataset.armed; $("reset").textContent = "Zurücksetzen"; render(); }
  else { $("reset").dataset.armed = 1; $("reset").textContent = "Wirklich? Nochmal tippen"; setTimeout(() => { delete $("reset").dataset.armed; $("reset").textContent = "Zurücksetzen"; }, 4000); }
};
document.querySelectorAll("#risk button").forEach((b) => (b.onclick = () => { CFG.risk = b.dataset.r; save(); render(); }));
$("c-neu").onchange = (e) => { CFG.neu = e.target.checked; save(); render(); };
$("c-et").onchange = (e) => { CFG.etabliert = e.target.checked; save(); render(); };

render();
Promise.all([safe("CoinGecko", loadCG), safe("GeckoTerminal", loadGT)]).then(tick);
setInterval(() => safe("CoinGecko", loadCG), 60000);
setInterval(() => safe("GeckoTerminal", loadGT), 30000);
setInterval(() => safe("Positionen", loadHeld), 15000);
setInterval(tick, TICK_MS);
