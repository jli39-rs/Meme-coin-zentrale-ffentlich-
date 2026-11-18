// Claude Bot – reine Paper-Trading-Simulation mit Live-Preisen von CoinGecko.
const API = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=meme-token&order=market_cap_desc&per_page=50&page=1&price_change_percentage=1h,24h";
const START = 100, TICK_MS = 6000, REFRESH_MS = 30000;
const $ = (id) => document.getElementById(id);
const usd = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fresh = () => ({ cash: START, pos: {}, hist: [START], trades: 0, wins: 0, losses: 0, log: [], calls: [0, 0, 0], tr: [], since: Date.now() });
let S = JSON.parse(localStorage.getItem("claudebot") || "null") || fresh();
let coins = [], paused = false;
const save = () => localStorage.setItem("claudebot", JSON.stringify(S));

const SOURCES = [["Multi-Agent-Analyse", "Analyst · Risk"], ["Token-Scanner", "Scanner · Safety"], ["Paper-Executor", "Executor"]];
const price = (id) => (coins.find((c) => c.id === id) || {}).current_price;
const equity = () => S.cash + Object.entries(S.pos).reduce((s, [id, p]) => s + p.qty * (price(id) ?? p.cost / p.qty), 0);

function log(type, sym, text) {
  S.log.unshift({ t: new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }), type, sym, text });
  S.log = S.log.slice(0, 40);
}

function rec(side, sym, p, qty, amt, pnl) {
  S.tr = S.tr || [];
  S.tr.unshift({ ts: Date.now(), side, sym, p, qty, amt, pnl });
  S.tr = S.tr.slice(0, 50);
}
const fmtP = (n) => "$" + (n >= 1 ? n.toFixed(2) : n.toPrecision(3));

// Ein Entscheidungszyklus: Scanner -> Safety -> Analyst -> Risk -> Executor
function tick() {
  if (paused || !coins.length) return;
  const pick = () => coins[Math.floor(Math.random() * coins.length)];

  // Verkaufen: Take-Profit +6 %, Stop-Loss -8 %
  for (const [id, p] of Object.entries(S.pos)) {
    const now = price(id); if (!now) continue;
    const chg = now * p.qty / p.cost - 1;
    if (chg >= 0.06 || chg <= -0.08) {
      const pnl = now * p.qty - p.cost;
      S.cash += now * p.qty; delete S.pos[id]; S.trades++;
      pnl >= 0 ? S.wins++ : S.losses++;
      rec("SELL", p.sym, now, p.qty, now * p.qty, pnl);
      log("SELL", p.sym, `${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)} · ${chg >= 0 ? "Take-Profit" : "Stop -8%"}`);
      S.calls[2]++; return finish();
    }
  }

  const c = pick(); S.calls[0]++;
  const sym = c.symbol.toUpperCase();
  // Safety: Liquidität/Volumen-Heuristik (keine echte Honeypot-Prüfung)
  const liq = c.total_volume / Math.max(c.market_cap, 1);
  const safe = c.market_cap > 5e6 && liq > 0.01;
  if (!safe) { log("SKIP", sym, "Safety: zu wenig Liquidität"); return finish(); }
  // Analyst: einfacher Momentum-Score aus 1h/24h
  const m1 = c.price_change_percentage_1h_in_currency ?? 0, m24 = c.price_change_percentage_24h ?? 0;
  const bull = Math.max(1, Math.min(5, Math.round(3 + m1 / 2 + m24 / 10))), bear = 5 - bull;
  if (bull < 4 || S.pos[c.id] || Object.keys(S.pos).length >= 6) { log("SKIP", sym, `Analyst bull ${bull}/bear ${bear}`); S.calls[1]++; return finish(); }
  // Risk: 5–10 % des Vermögens
  const size = Math.min(S.cash, equity() * (0.05 + Math.random() * 0.05));
  if (size < 1) { log("SKIP", sym, "Risk: kein Cash frei"); return finish(); }
  S.cash -= size; S.pos[c.id] = { sym, name: c.name, img: c.image, qty: size / c.current_price, cost: size, entry: c.current_price, ts: Date.now() };
  S.trades++; S.calls[1]++; S.calls[2]++;
  rec("BUY", sym, c.current_price, S.pos[c.id].qty, size, null);
  log("BUY", sym, `bull ${bull}/bear ${bear} · ${usd(size)}`);
  finish();
}

function finish() { S.hist.push(equity()); S.hist = S.hist.slice(-300); save(); render(); }

function chart() {
  const h = S.hist, min = Math.min(...h), max = Math.max(...h), r = max - min || 1;
  const pts = h.map((v, i) => `${(i / Math.max(h.length - 1, 1)) * 400},${105 - ((v - min) / r) * 90}`);
  const last = pts[pts.length - 1].split(",");
  $("chart").innerHTML = `<polygon points="0,110 ${pts.join(" ")} 400,110" fill="rgba(31,170,89,.12)"/>
    <polyline points="${pts.join(" ")}" fill="none" stroke="#1faa59" stroke-width="2"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="#fff" stroke="#111" stroke-width="2"/>`;
}

function render() {
  const v = equity(), pnl = v - START, el = Math.floor((Date.now() - S.since) / 60000);
  $("val").textContent = usd(v);
  $("delta").textContent = (pnl >= 0 ? "+" : "-") + "$" + Math.abs(pnl).toFixed(0);
  $("delta").className = "delta " + (pnl >= 0 ? "up" : "down");
  $("start").textContent = "$" + START; $("trades").textContent = S.trades;
  $("mult").textContent = (v / START).toFixed(2) + "×";
  $("wl").textContent = `${pnl >= 0 ? "+" : "-"}${usd(Math.abs(pnl))} · ${S.wins}W ${S.losses}L`;
  $("wl").className = pnl >= 0 ? "up" : "down";
  $("clock").textContent = `${Math.floor(el / 60)}h ${el % 60}m aktiv`;
  $("repos").innerHTML = SOURCES.map((s, i) => `<div class="repo"><span>● ${esc(s[0])} <span class="mut">· ${esc(s[1])}</span></span><b class="up">${S.calls[i]} calls</b></div>`).join("");
  const open = Object.values(S.pos);
  $("agents").innerHTML = [
    ["scanner", "SCANNER", `${coins.length} Coins im Blick`],
    ["safety", "SAFETY", "Liquiditäts-Check ✓"],
    ["analyst", "ANALYST", "Momentum 1h/24h"],
    ["risk", "RISK", "Größe 5–10% · Stop -8%"],
    ["executor", "EXECUTOR", `${open.length} offene Positionen`],
  ].map((a) => `<div class="row"><span class="tag a-${a[0]}">${a[1]}</span><span class="txt">${esc(a[2])}</span></div>`).join("");
  $("log").innerHTML = S.log.slice(0, 8).map((l) => `<div class="row"><span class="mut">${l.t}</span><span class="${l.type === "BUY" ? "buy" : l.type === "SELL" ? "sell" : "mut"}">${l.type}</span><span class="txt">${esc(l.sym)} · ${esc(l.text)}</span></div>`).join("") || "<div class='mut'>Warte auf Marktdaten…</div>";
  const pe = Object.entries(S.pos);
  const inv = pe.reduce((s, [id, p]) => s + p.qty * (price(id) ?? p.entry), 0);
  $("invested").textContent = pe.length ? `${usd(inv)} in ${pe.length} Coin${pe.length > 1 ? "s" : ""} · Cash ${usd(S.cash)}` : `Nichts offen · Cash ${usd(S.cash)}`;
  $("positions").innerHTML = pe.map(([id, p]) => {
    const now = price(id) ?? p.entry, val = p.qty * now, pl = val - p.cost, pc = (val / p.cost - 1) * 100;
    const bar = Math.max(0, Math.min(100, ((pc + 8) / 14) * 100)); // -8 % Stop ... +6 % Take-Profit
    const mins = Math.floor((Date.now() - (p.ts || Date.now())) / 60000);
    return `<div class="pos"><div class="row"><b>${p.img ? `<img src="${esc(p.img)}" alt="">` : ""}${esc(p.sym)} <span class="mut">${esc(p.name || "")}</span></b><b class="${pl >= 0 ? "up" : "down"}">${pl >= 0 ? "+" : "-"}$${Math.abs(pl).toFixed(2)} (${pc >= 0 ? "+" : ""}${pc.toFixed(2)}%)</b></div>
      <div class="row mut"><span>Einstieg ${fmtP(p.entry ?? now)} → jetzt ${fmtP(now)}</span><span>${usd(val)} · seit ${mins} Min</span></div>
      <div class="bar"><i style="width:${bar}%" class="${pl >= 0 ? "g" : "r"}"></i></div>
      <div class="row mut small"><span>Stop −8%</span><span>Take-Profit +6%</span></div></div>`;
  }).join("") || "<div class='mut'>Der Bot ist gerade in keinem Coin – er wartet auf ein Signal.</div>";
  $("ticker").innerHTML = coins.slice(0, 15).map((c) => { const d = c.price_change_percentage_24h ?? 0; return `<span>${esc(c.symbol.toUpperCase())} ${fmtP(c.current_price)} <i class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "+" : ""}${d.toFixed(1)}%</i></span>`; }).join("");
  const tr = S.tr || [];
  $("tcount").textContent = tr.length + " Trades";
  $("trades-live").innerHTML = tr.slice(0, 12).map((x, i) => `<div class="row trade${i === 0 && Date.now() - x.ts < 8000 ? " new" : ""}"><span class="mut">${new Date(x.ts).toLocaleTimeString("de-DE")}</span><span class="${x.side === "BUY" ? "buy" : "sell"}">${x.side}</span><span class="txt">${esc(x.sym)} @ ${fmtP(x.p)} · ${usd(x.amt)}${x.pnl == null ? "" : ` · <b class="${x.pnl >= 0 ? "up" : "down"}">${x.pnl >= 0 ? "+" : "-"}$${Math.abs(x.pnl).toFixed(2)}</b>`}</span></div>`).join("") || "<div class='mut'>Noch keine Trades – der Bot sucht Einstiege…</div>";
  $("live").textContent = paused ? "⏸ Pause" : "● Live";
  chart();
}

async function load() {
  try { const r = await fetch(API); if (!r.ok) throw 0; coins = await r.json(); }
  catch { $("sub").textContent = "⚠ CoinGecko nicht erreichbar (Rate-Limit?) – neuer Versuch folgt"; return; }
  $("sub").textContent = `3 Quellen · 5 Agenten · ${coins.length} Meme Coins live`;
  render();
}

$("toggle").onclick = () => { paused = !paused; $("toggle").textContent = paused ? "▶ Weiter" : "⏸ Pause"; render(); };
$("reset").onclick = () => { if (confirm("Simulation zurücksetzen?")) { S = fresh(); save(); render(); } };
load().then(() => tick());
setInterval(load, REFRESH_MS);
setInterval(tick, TICK_MS);
render();
