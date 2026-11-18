// Claude Bot v3 – reine Paper-Trading-Simulation mit virtuellen 5 SOL (kein Wallet, kein echter Handel).
// Daten: GeckoTerminal (neue/trendende Solana-Pools, Charts, SOL-Preis), CoinGecko (etablierte Meme Coins),
// RugCheck (Rug-Pull-Prüfung + Holder für die Bubble-Map). Charts: TradingView Lightweight Charts.
const CG = "https://api.coingecko.com/api/v3";
const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
const RC = "https://api.rugcheck.xyz/v1/tokens/";
const WSOL = "So11111111111111111111111111111111111111112";
const START = 5, TICK_MS = 5000, NET_FEE = 0.0005, MIN_TRADE = 0.05; // SOL
const FEE = { cg: 0.003, gt: 0.01 }; // simulierte DEX-Gebühr + Slippage je Seite
const PRESETS = {
  vorsichtig: { size: 0.06, tp: 15, sl: 7,  trailOn: 8,  trail: 4,  maxPos: 4, minScore: 3.5, minLiq: 60000, timeMin: 120, maxRug: 25 },
  normal:     { size: 0.10, tp: 30, sl: 12, trailOn: 12, trail: 6,  maxPos: 6, minScore: 3.0, minLiq: 25000, timeMin: 60,  maxRug: 40 },
  aggressiv:  { size: 0.15, tp: 90, sl: 20, trailOn: 25, trail: 12, maxPos: 8, minScore: 2.5, minLiq: 12000, timeMin: 30,  maxRug: 55 },
};
const LABEL = { vorsichtig: "Vorsichtig", normal: "Normal", aggressiv: "Aggressiv" };

// ---------- Helfer ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sol = (n, d = 3) => (n ?? 0).toFixed(d);
const ssol = (n, d = 3) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(d) + " SOL";
const usd = (n) => "$" + (n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtP = (n) => !n ? "–" : "$" + (n >= 1 ? n.toFixed(2) : n >= 0.0001 ? n.toPrecision(3) : n.toExponential(2));
const big = (n) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const pct = (n, d = 1) => (n >= 0 ? "+" : "") + (n ?? 0).toFixed(d) + "%";
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const now = () => Date.now();

// ---------- Zustand ----------
const fresh = () => ({ v: 3, cash: START, pos: {}, hist: [START], trades: 0, wins: 0, losses: 0, log: [], tr: [], calls: [0, 0, 0, 0], cool: {}, best: 0, worst: 0, fees: 0, rugsAvoided: 0, since: now() });
let S = load("claudebot", null);
if (!S || S.v !== 3) S = fresh(); // Umstellung auf SOL: neuer Start mit 5 SOL
let CFG = { risk: "normal", neu: true, etabliert: true, rug: true, ...load("claudebot-cfg", {}) };
const mk = {};            // Marktdaten: key -> Coin/Pool
const rug = {};           // Rug-Check-Ergebnisse: mint -> Bericht
let solUsd = 0, paused = false, errs = {}, focusKey = null, focusSel = null;
const save = () => { try { localStorage.setItem("claudebot", JSON.stringify(S)); localStorage.setItem("claudebot-cfg", JSON.stringify(CFG)); } catch {} };
const P = () => PRESETS[CFG.risk] || PRESETS.normal;

// ---------- Daten ----------
async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }
async function safe(name, fn) { try { await fn(); delete errs[name]; } catch (e) { errs[name] = e.message || "Fehler"; } render(); }

async function loadSol() {
  try {
    const d = await getJSON(`${GT.replace("/networks/solana", "")}/simple/networks/solana/token_price/${WSOL}`);
    solUsd = +Object.values(d.data.attributes.token_prices)[0];
  } catch {
    const d = await getJSON(`${CG}/simple/price?ids=solana&vs_currencies=usd`);
    solUsd = d.solana.usd;
  }
}
async function loadCG() {
  const d = await getJSON(`${CG}/coins/markets?vs_currency=usd&category=meme-token&order=volume_desc&per_page=100&page=1&price_change_percentage=1h,24h`);
  for (const c of d) mk["cg:" + c.id] = { ...mk["cg:" + c.id],
    key: "cg:" + c.id, src: "cg", sym: c.symbol.toUpperCase(), name: c.name, img: c.image, price: c.current_price,
    mcap: c.market_cap, vol24: c.total_volume, ch1: c.price_change_percentage_1h_in_currency ?? 0, ch24: c.price_change_percentage_24h ?? 0, t: now() };
}
function gtItems(json, extra = {}) {
  const inc = {};
  (json.included || []).forEach((t) => (inc[t.id] = t.attributes));
  return (json.data || []).map((p) => {
    const a = p.attributes, tid = p.relationships?.base_token?.data?.id || "", tok = inc[tid] || {};
    const pc = a.price_change_percentage || {}, tx = a.transactions || {}, vol = a.volume_usd || {};
    return {
      key: "gt:" + a.address, src: "gt", pool: a.address, mint: tok.address || tid.replace(/^solana_/, ""),
      sym: String(tok.symbol || a.name.split(" / ")[0]).toUpperCase().slice(0, 12), name: tok.name || a.name,
      img: tok.image_url && tok.image_url !== "missing.png" ? tok.image_url : "", price: +a.base_token_price_usd,
      fdv: +(a.fdv_usd || 0), liq: +(a.reserve_in_usd || 0), ch5: +(pc.m5 || 0), ch1: +(pc.h1 || 0), ch24: +(pc.h24 || 0),
      buys: tx.m5?.buys || 0, sells: tx.m5?.sells || 0, buyers: tx.m5?.buyers || 0, vol5: +(vol.m5 || 0), vol1: +(vol.h1 || 0),
      age: a.pool_created_at ? (now() - new Date(a.pool_created_at)) / 60000 : null, t: now(), ...extra,
    };
  });
}
async function loadGT() {
  const [n, t] = await Promise.all([getJSON(`${GT}/new_pools?include=base_token`), getJSON(`${GT}/trending_pools?include=base_token`)]);
  for (const x of [...gtItems(n, { neu: true }), ...gtItems(t, { trend: true })]) mk[x.key] = { ...mk[x.key], ...x };
}
async function loadHeld() {
  const a = Object.keys(S.pos).filter((k) => k.startsWith("gt:")).map((k) => k.slice(3));
  if (!a.length) return;
  const d = await getJSON(`${GT}/pools/multi/${a.slice(0, 30).join(",")}?include=base_token`);
  for (const x of gtItems(d)) mk[x.key] = { ...mk[x.key], ...x };
}

// ---------- Rug-Check ----------
// Kriterien nach gängigen Checklisten (RugCheck, Bubblemaps, DEXTools u. a.):
// Mint-/Freeze-Authority aktiv = Ausschluss · LP < 80 % gesperrt/verbrannt = Risiko · Top-10 > 40 % (ohne Pool) = Ausschluss
// einzelner Holder > 15 % = Ausschluss · Insider/Cluster > 20 % = Ausschluss · Dev > 5 % = Risiko · RugCheck-"danger"-Risiken.
function analyseRug(r) {
  const out = { score: 0, reasons: [], ok: [], reject: false, holders: [] };
  const bad = (pts, txt, hard) => { out.score += pts; out.reasons.push(txt); if (hard) out.reject = true; };
  if (r.rugged) bad(100, "Bereits als Rug markiert", true);
  const tok = r.token || {};
  tok.mintAuthority ? bad(40, "Mint-Authority aktiv (unbegrenzt neue Tokens möglich)", true) : out.ok.push("Mint gesperrt");
  tok.freezeAuthority ? bad(40, "Freeze-Authority aktiv (Honeypot-Gefahr)", true) : out.ok.push("Freeze gesperrt");
  const marketStr = JSON.stringify(r.markets || []);
  const lp = Math.max(0, ...(r.markets || []).map((m) => +(m.lp?.lpLockedPct ?? 0)), +(r.lpLockedPct ?? 0));
  out.lp = lp;
  if (lp < 50) bad(30, `Liquidität nur ${lp.toFixed(0)}% gesperrt – kann abgezogen werden`, true);
  else if (lp < 80) bad(15, `Liquidität nur ${lp.toFixed(0)}% gesperrt`);
  else out.ok.push(`LP ${lp.toFixed(0)}% gesperrt/verbrannt`);
  const creator = r.creator || "";
  out.holders = (r.topHolders || []).map((h) => {
    const isLp = !!(h.address && marketStr.includes(h.address)) || !!(h.owner && marketStr.includes(h.owner));
    return { addr: h.owner || h.address || "?", pct: +h.pct || 0, insider: !!h.insider, dev: !!creator && (h.owner === creator || h.address === creator), lp: isLp };
  });
  const real = out.holders.filter((h) => !h.lp);
  const top10 = real.slice(0, 10).reduce((s, h) => s + h.pct, 0), top1 = real[0]?.pct || 0;
  const ins = real.filter((h) => h.insider).reduce((s, h) => s + h.pct, 0), dev = real.filter((h) => h.dev).reduce((s, h) => s + h.pct, 0);
  Object.assign(out, { top10, top1, ins, dev });
  if (top10 > 40) bad(25, `Top-10 halten ${top10.toFixed(0)}%`, true); else if (top10 > 25) bad(10, `Top-10 halten ${top10.toFixed(0)}%`); else out.ok.push(`Top-10 nur ${top10.toFixed(0)}%`);
  if (top1 > 15) bad(20, `Ein Wallet hält ${top1.toFixed(1)}%`, true); else if (top1 > 8) bad(8, `Größter Holder ${top1.toFixed(1)}%`);
  if (ins > 20) bad(25, `Insider-Cluster halten ${ins.toFixed(0)}%`, true); else if (ins > 8 || (r.graphInsidersDetected || 0) > 0) bad(12, `Insider erkannt (${ins.toFixed(0)}%)`);
  if (dev > 5) bad(10, `Dev hält ${dev.toFixed(1)}%`);
  if (r.tokenMeta?.mutable) bad(5, "Metadaten änderbar");
  const danger = (r.risks || []).filter((x) => x.level === "danger");
  if (danger.length) bad(8 * danger.length, "RugCheck: " + danger.map((x) => x.name).join(", "));
  out.score = Math.min(100, out.score);
  out.rc = r.score_normalised;
  return out;
}
let rugBusy = 0;
function requestRug(mint) {
  if (!mint || rug[mint] || now() - rugBusy < 2500) return;
  rugBusy = now(); rug[mint] = { pending: true, t: now() };
  S.calls[2]++;
  getJSON(RC + mint + "/report").then((r) => { rug[mint] = { ...analyseRug(r), t: now() }; delete errs.RugCheck; })
    .catch((e) => { rug[mint] = { fail: true, t: now() }; errs.RugCheck = e.message || "nicht erreichbar"; })
    .finally(render);
}
// Fallback, wenn RugCheck nicht erreichbar ist: nur ältere Pools mit viel Liquidität
const fallbackOk = (m) => m.age != null && m.age > 60 && m.liq >= 50000;

// ---------- Strategie ----------
const price = (k) => mk[k]?.price || 0;
const valSol = (k, p) => solUsd ? (p.qty * (price(k) || p.entry) * (1 - FEE[p.src])) / solUsd : p.cost;
const equity = () => S.cash + Object.entries(S.pos).reduce((s, [k, p]) => s + valSol(k, p), 0);

function score(m) {
  const R = P();
  if (m.src === "cg") {
    if (!CFG.etabliert) return null;
    if (m.mcap < 5e6 || m.vol24 / m.mcap < 0.03) return { skip: "Safety: zu wenig Volumen" };
    return { s: 2 + m.ch1 / 1.2 + m.ch24 / 20, why: `1h ${pct(m.ch1)} · 24h ${pct(m.ch24)}` };
  }
  if (!CFG.neu || !m.price) return null;
  if (m.liq < R.minLiq) return { skip: `Safety: Liquidität nur $${big(m.liq)}` };
  if (m.age != null && m.age < 3) return { skip: "Safety: Pool jünger als 3 Min" };
  if (m.fdv && m.fdv / Math.max(m.liq, 1) > 80) return { skip: "Safety: FDV/Liquidität verdächtig hoch" };
  const tx = m.buys + m.sells;
  if (tx < 15) return { skip: `Safety: nur ${tx} Trades in 5 Min` };
  if (m.ch1 > 500) return { skip: `Risk: schon ${pct(m.ch1, 0)} in 1h – zu spät` };
  const bp = m.buys / tx;
  if (bp < 0.5) return { skip: `Analyst: Verkaufsdruck (${(bp * 100).toFixed(0)}% Käufe)` };
  if (m.ch5 < -3) return { skip: `Analyst: fällt gerade (${pct(m.ch5)} in 5 Min)` };
  if (m.buyers && m.buys / m.buyers > 4) return { skip: "Safety: wenige Wallets kaufen sehr oft (Bot-Volumen)" };
  const s = 1.2 + m.ch5 / 4 + Math.min(m.ch1, 150) / 50 + (bp - 0.5) * 6 + Math.min((m.vol5 / Math.max(m.liq, 1)) * 15, 1.5);
  return { s, why: `5m ${pct(m.ch5)} · ${(bp * 100).toFixed(0)}% Käufe · Liq $${big(m.liq)}` };
}

function log(type, sym, text) {
  S.log.unshift({ t: new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }), type, sym, text });
  S.log = S.log.slice(0, 50);
}
function sell(k, reason) {
  const p = S.pos[k], got = valSol(k, p) - NET_FEE, pnl = got - p.cost;
  S.cash += got; S.fees += NET_FEE + p.qty * (price(k) || p.entry) * FEE[p.src] / (solUsd || 1);
  delete S.pos[k]; S.trades++; S.cool[k] = now();
  pnl >= 0 ? S.wins++ : S.losses++;
  S.best = Math.max(S.best, pnl); S.worst = Math.min(S.worst, pnl);
  S.tr.unshift({ ts: now(), side: "SELL", sym: p.sym, img: p.img, p: price(k) || p.entry, amt: got, pnl, why: reason });
  S.tr = S.tr.slice(0, 80);
  log("SELL", p.sym, `${ssol(pnl)} · ${reason}`);
  S.calls[3]++;
}
function buy(m, why, rc) {
  const R = P(), size = Math.min(S.cash - NET_FEE, equity() * R.size);
  if (size < MIN_TRADE) { log("SKIP", m.sym, "Risk: kein SOL frei"); return; }
  const qty = (size * solUsd * (1 - FEE[m.src])) / m.price;
  S.cash -= size + NET_FEE; S.fees += NET_FEE + size * FEE[m.src];
  S.pos[m.key] = { src: m.src, sym: m.sym, name: m.name, img: m.img, mint: m.mint, pool: m.pool, qty, cost: size + NET_FEE, entry: m.price,
    ts: now(), peak: 0, tp: R.tp, sl: R.sl, liq0: m.liq || 0, neu: !!m.neu, rug: rc ? rc.score : null };
  S.trades++; S.calls[3]++;
  S.tr.unshift({ ts: now(), side: "BUY", sym: m.sym, img: m.img, p: m.price, amt: size, pnl: null, why: (m.neu ? "🆕 " : m.src === "gt" ? "🔥 " : "") + why + (rc ? ` · Rug ${rc.score}/100` : "") });
  S.tr = S.tr.slice(0, 80);
  log("BUY", m.sym, `${sol(size)} SOL · ${why}`);
}

function tick() {
  if (paused || !solUsd) return;
  const R = P();
  // 1) Ausstiege
  for (const [k, p] of Object.entries(S.pos)) {
    const m = mk[k]; if (!m || now() - m.t > 10 * 60000) continue;
    const ch = (valSol(k, p) / p.cost - 1) * 100;
    p.peak = Math.max(p.peak || 0, ch);
    const mins = (now() - p.ts) / 60000;
    if (p.liq0 && m.liq && m.liq < p.liq0 * 0.6) sell(k, `🚨 Liquidität −${((1 - m.liq / p.liq0) * 100).toFixed(0)}% – Rug-Verdacht, Notverkauf`);
    else if (ch >= p.tp) sell(k, `Take-Profit ${pct(ch)}`);
    else if (ch <= -p.sl) sell(k, `Stop-Loss ${pct(ch)}`);
    else if (p.peak >= R.trailOn && p.peak - ch >= R.trail) sell(k, `Trailing-Stop (Hoch ${pct(p.peak)})`);
    else if (mins > R.timeMin && ch < 2) sell(k, `Zeit-Exit nach ${Math.round(mins)} Min`);
  }
  // 2) Einstieg
  if (Object.keys(S.pos).length < R.maxPos) {
    S.calls[0]++;
    const list = [];
    let lastSkip = null;
    for (const m of Object.values(mk)) {
      if (S.pos[m.key] || now() - (S.cool[m.key] || 0) < 30 * 60000 || now() - m.t > 5 * 60000) continue;
      const r = score(m); if (!r) continue;
      if (r.skip) lastSkip = [m, r.skip]; else list.push({ m, r });
    }
    list.sort((a, b) => b.r.s - a.r.s);
    let acted = false;
    for (const { m, r } of list.slice(0, 5)) {
      if (r.s < R.minScore) { log("SKIP", m.sym, `Score ${r.s.toFixed(1)} < ${R.minScore} · ${r.why}`); acted = true; break; }
      if (m.src === "gt") {
        const rc = rug[m.mint];
        if (!rc) { requestRug(m.mint); log("CHECK", m.sym, "Rug-Check läuft…"); acted = true; break; }
        if (rc.pending) { acted = true; break; }
        if (rc.fail) {
          if (CFG.rug && !fallbackOk(m)) { S.cool[m.key] = now(); log("SKIP", m.sym, "Rug-Check nicht erreichbar – zu neu/zu wenig Liquidität"); continue; }
        } else if (rc.reject || rc.score > R.maxRug) {
          S.cool[m.key] = now(); S.rugsAvoided++;
          log("RUG", m.sym, `🛡️ blockiert (${rc.score}/100): ${rc.reasons[0] || "zu riskant"}`); acted = true; continue;
        }
        buy(m, `Score ${r.s.toFixed(1)} · ${r.why}`, rc.fail ? null : rc); acted = true; break;
      }
      buy(m, `Score ${r.s.toFixed(1)} · ${r.why}`, null); acted = true; break;
    }
    S.calls[1]++;
    if (!acted && lastSkip) log("SKIP", lastSkip[0].sym, lastSkip[1]);
  }
  S.hist.push(equity()); S.hist = S.hist.slice(-500);
  save(); render();
}

// ---------- Fokus: Top-Trade-Chart (TradingView Lightweight Charts) ----------
let tv = null, series = null, lines = [], chartKey = null, lastOhlc = 0;
function pickFocus() {
  if (focusSel && (S.pos[focusSel] || mk[focusSel])) return focusSel;
  const pe = Object.entries(S.pos);
  if (pe.length) return pe.map(([k, p]) => [k, valSol(k, p) / p.cost]).sort((a, b) => b[1] - a[1])[0][0];
  const top = Object.values(mk).filter((m) => m.src === "gt" && m.price).sort((a, b) => (b.ch1 || 0) - (a.ch1 || 0))[0];
  return top?.key || null;
}
async function loadOhlc(force) {
  const k = focusKey; if (!k) return;
  if (!force && k === chartKey && now() - lastOhlc < 20000) return;
  lastOhlc = now();
  let bars = [];
  if (k.startsWith("gt:")) {
    const d = await getJSON(`${GT}/pools/${k.slice(3)}/ohlcv/minute?aggregate=1&limit=150&currency=usd`);
    bars = (d.data?.attributes?.ohlcv_list || []).map((x) => ({ time: x[0], open: +x[1], high: +x[2], low: +x[3], close: +x[4] }));
  } else {
    const d = await getJSON(`${CG}/coins/${k.slice(3)}/ohlc?vs_currency=usd&days=1`);
    bars = d.map((x) => ({ time: Math.floor(x[0] / 1000), open: x[1], high: x[2], low: x[3], close: x[4] }));
  }
  const seen = new Set();
  bars = bars.filter((b) => !seen.has(b.time) && seen.add(b.time)).sort((a, b) => a.time - b.time);
  drawChart(k, bars);
}
function drawChart(k, bars) {
  const el = $("tv");
  if (!bars.length) { el.innerHTML = "<div class='mut tiny' style='padding:20px'>Noch keine Chartdaten.</div>"; tv = null; return; }
  const p = S.pos[k], last = bars[bars.length - 1].close;
  const dec = Math.min(12, Math.max(2, Math.ceil(-Math.log10(last)) + 3));
  if (!window.LightweightCharts) { // Ersatz: einfache Linie
    const min = Math.min(...bars.map((b) => b.low)), max = Math.max(...bars.map((b) => b.high)), r = max - min || 1;
    el.innerHTML = `<svg viewBox="0 0 400 200" preserveAspectRatio="none"><polyline fill="none" stroke="#14f195" stroke-width="2" points="${bars.map((b, i) => `${(i / (bars.length - 1 || 1)) * 400},${190 - ((b.close - min) / r) * 180}`).join(" ")}"/></svg>`;
    chartKey = k; return;
  }
  if (!tv || chartKey !== k) {
    el.innerHTML = "";
    tv = LightweightCharts.createChart(el, {
      autoSize: true, layout: { background: { color: "transparent" }, textColor: "#7d869b", fontSize: 11 },
      grid: { vertLines: { color: "rgba(255,255,255,.04)" }, horzLines: { color: "rgba(255,255,255,.04)" } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    series = tv.addCandlestickSeries({ upColor: "#14f195", downColor: "#ff4d6d", wickUpColor: "#14f195", wickDownColor: "#ff4d6d", borderVisible: false });
    lines = [];
  }
  series.applyOptions({ priceFormat: { type: "price", precision: dec, minMove: Math.pow(10, -dec) } });
  series.setData(bars);
  lines.forEach((l) => series.removePriceLine(l)); lines = [];
  if (p) {
    const add = (price, color, title) => lines.push(series.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title }));
    add(p.entry, "#4da3ff", "Einstieg");
    add(p.entry * (1 + p.tp / 100), "#14f195", `Ziel +${p.tp}%`);
    add(p.entry * (1 - p.sl / 100), "#ff4d6d", `Stop −${p.sl}%`);
    const t = Math.floor(p.ts / 1000), bar = bars.reduce((a, b) => (Math.abs(b.time - t) < Math.abs(a.time - t) ? b : a));
    if (Math.abs(bar.time - t) < 3600) series.setMarkers([{ time: bar.time, position: "belowBar", color: "#4da3ff", shape: "arrowUp", text: "BUY" }]);
    else series.setMarkers([]);
  } else series.setMarkers([]);
  if (chartKey !== k) tv.timeScale().fitContent();
  chartKey = k;
}

// ---------- Bubble-Map ----------
function bubbles(rc) {
  const svg = $("bubbles");
  if (!rc || !rc.holders?.length) { svg.innerHTML = `<text x="200" y="130" text-anchor="middle" fill="#7d869b" font-size="12">${rc?.pending ? "Holder werden geladen…" : rc?.fail ? "RugCheck nicht erreichbar – keine Holder-Daten" : "Keine Holder-Daten (nur bei neuen Solana-Coins)"}</text>`; return; }
  const hs = rc.holders.slice(0, 30).map((h) => ({ ...h, r: Math.max(5, Math.sqrt(h.pct) * 13) }));
  const placed = [];
  for (const h of hs.sort((a, b) => b.r - a.r)) { // Spirale mit Kollisionsprüfung
    for (let i = 0; i < 2000; i++) {
      const a = i * 0.35, d = i * 0.9, x = 200 + Math.cos(a) * d, y = 130 + Math.sin(a) * d * 0.62;
      if (x - h.r < 2 || x + h.r > 398 || y - h.r < 2 || y + h.r > 258) continue;
      if (placed.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + h.r + 2)) { h.x = x; h.y = y; placed.push(h); break; }
    }
  }
  const col = (h) => (h.lp ? "#4da3ff" : h.insider ? "#ff4d6d" : h.dev ? "#ffa23e" : "#9945ff");
  const ins = placed.filter((h) => h.insider);
  const links = ins.flatMap((a, i) => ins.slice(i + 1).map((b) => `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#ff4d6d" stroke-opacity=".35"/>`)).join("");
  svg.innerHTML = links + placed.map((h) => `<g><title>${esc(h.addr)} · ${h.pct.toFixed(2)}%${h.lp ? " (Pool/LP)" : h.insider ? " (Insider)" : h.dev ? " (Dev)" : ""}</title>
    <circle cx="${h.x}" cy="${h.y}" r="${h.r}" fill="${col(h)}" fill-opacity=".28" stroke="${col(h)}" stroke-width="1.5"/>
    ${h.r > 13 ? `<text x="${h.x}" y="${h.y + 4}" text-anchor="middle" fill="#eef1f7" font-size="${Math.min(13, h.r / 2.2)}" font-weight="600">${h.pct.toFixed(1)}%</text>` : ""}</g>`).join("");
}

// ---------- Anzeige ----------
function equityChart() {
  const h = S.hist, min = Math.min(...h, START), max = Math.max(...h, START), r = max - min || 1;
  const y = (v) => 112 - ((v - min) / r) * 102;
  const pts = h.map((v, i) => `${(i / Math.max(h.length - 1, 1)) * 400},${y(v)}`);
  const last = pts[pts.length - 1].split(","), up = h[h.length - 1] >= START, c = up ? "#14f195" : "#ff4d6d";
  $("chart").innerHTML = `<defs><linearGradient id="eg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".35"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>
    <line x1="0" x2="400" y1="${y(START)}" y2="${y(START)}" stroke="#7d869b" stroke-opacity=".4" stroke-dasharray="3 5"/>
    <polygon points="0,120 ${pts.join(" ")} 400,120" fill="url(#eg)"/>
    <polyline points="${pts.join(" ")}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="4.5" fill="${c}" stroke="#0b0d12" stroke-width="2"/>`;
}

function render() {
  const R = P(), v = equity(), pnl = v - START, el = Math.floor((now() - S.since) / 60000);
  const all = Object.values(mk), nNew = all.filter((m) => m.neu).length, nGt = all.filter((m) => m.src === "gt").length, nCg = all.filter((m) => m.src === "cg").length;
  $("val").textContent = sol(v);
  $("usd").textContent = solUsd ? `≈ ${usd(v * solUsd)} · 1 SOL = ${usd(solUsd)}` : "SOL-Preis lädt…";
  $("delta").textContent = `${ssol(pnl)} (${pct((v / START - 1) * 100)})`; $("delta").className = pnl >= 0 ? "up" : "down";
  $("mult").textContent = (v / START).toFixed(2) + "×";
  $("trades").textContent = S.trades; $("wl").textContent = `${S.wins}W ${S.losses}L`;
  $("clock").textContent = `${Math.floor(el / 60)}h ${el % 60}m aktiv`;
  const e = Object.entries(errs);
  $("sub").textContent = e.length ? "⚠ " + e.map(([k, m]) => `${k}: ${m}`).join(" · ") : `${nCg + nGt} Coins live · ${nNew} neu · ${LABEL[CFG.risk]}`;
  $("live").className = "live" + (paused ? " off" : ""); $("live").innerHTML = `<i></i> ${paused ? "Pause" : "Live"}`;

  const n = S.wins + S.losses;
  $("stats").innerHTML = `<div>Trefferquote<b>${n ? Math.round((S.wins / n) * 100) : 0}%</b></div>
    <div>Bester<b class="up">${ssol(S.best || 0, 2).replace(" SOL", "")}</b></div>
    <div>Rugs geblockt<b>${S.rugsAvoided || 0}</b></div>
    <div>Frei<b>${sol(S.cash, 2)}</b></div>`;

  // Positionen
  const pe = Object.entries(S.pos);
  const inv = pe.reduce((s, [k, p]) => s + valSol(k, p), 0);
  $("invested").textContent = pe.length ? `${sol(inv)} SOL in ${pe.length} Coin${pe.length > 1 ? "s" : ""}` : "nichts offen";
  focusKey = pickFocus();
  $("positions").innerHTML = pe.map(([k, p]) => {
    const cur = price(k) || p.entry, val = valSol(k, p), pl = val - p.cost, pc = (val / p.cost - 1) * 100;
    const w = Math.max(0, Math.min(100, ((pc + p.sl) / (p.tp + p.sl)) * 100)), zero = (p.sl / (p.tp + p.sl)) * 100;
    const tag = p.neu ? '<span class="chip new">NEU</span>' : p.src === "gt" ? '<span class="chip hot">TREND</span>' : "";
    const rg = p.rug == null ? "" : `<span class="chip ${p.rug <= 20 ? "ok" : p.rug <= 40 ? "warn" : "bad"}">RUG ${p.rug}</span>`;
    return `<div class="pos${k === focusKey ? " sel" : ""}" data-k="${esc(k)}"><div class="row"><b>${p.img ? `<img src="${esc(p.img)}" alt="">` : '<span class="coinimg" style="display:inline-block"></span>'}${esc(p.sym)} ${tag} ${rg}</b><b class="${pl >= 0 ? "up" : "down"}">${ssol(pl)} <span class="tiny">${pct(pc)}</span></b></div>
      <div class="row mut tiny"><span>${fmtP(p.entry)} → ${fmtP(cur)}</span><span>${sol(val)} SOL · ${Math.floor((now() - p.ts) / 60000)} Min</span></div>
      <div class="bar"><i style="width:${w}%" class="${pl >= 0 ? "g" : "r"}"></i><s style="left:${zero}%"></s></div>
      <div class="row mut tiny"><span>Stop −${p.sl}%</span><span>Hoch ${pct(p.peak || 0)}</span><span>Ziel +${p.tp}%</span></div></div>`;
  }).join("") || "<div class='mut'>Der Bot ist gerade in keinem Coin – er wartet auf ein gutes Signal.</div>";
  document.querySelectorAll(".pos").forEach((d) => (d.onclick = () => { focusSel = d.dataset.k; render(); safe("Chart", () => loadOhlc(true)); }));

  // Fokus-Karte
  const fk = focusKey, fp = S.pos[fk], fm = mk[fk];
  if (fk && (fp || fm)) {
    const sym = fp?.sym || fm?.sym, img = fp?.img || fm?.img, cur = price(fk) || fp?.entry;
    $("focus-title").textContent = fp ? (focusSel === fk ? "📈 Position live" : "🏆 Top-Trade live") : "👀 Im Visier";
    $("focus-hint").textContent = fp ? "tippe eine Position zum Wechseln" : "noch keine Position offen";
    const pl = fp ? valSol(fk, fp) - fp.cost : 0, pc = fp ? (valSol(fk, fp) / fp.cost - 1) * 100 : fm?.ch1 || 0;
    $("focus-info").innerHTML = `<div class="focus-row"><div>${img ? `<img class="coinimg" src="${esc(img)}" alt="">` : ""}<b>${esc(sym)}</b> <span class="mut tiny">${esc(fp?.name || fm?.name || "")}</span><div class="mut tiny">${fmtP(cur)}${fm?.liq ? ` · Liq $${big(fm.liq)}` : ""}${fm?.age != null ? ` · ${fm.age < 120 ? Math.round(fm.age) + " Min" : Math.round(fm.age / 60) + " Std"} alt` : ""}</div></div>
      <div style="text-align:right"><div class="big ${pc >= 0 ? "up" : "down"}">${pct(pc)}</div><div class="tiny ${pl >= 0 ? "up" : "down"}">${fp ? ssol(pl) : "1h"}</div></div></div>`;
    const pool = fp?.pool || fm?.pool, mint = fp?.mint || fm?.mint;
    $("focus-links").innerHTML = pool ? `<a href="https://www.geckoterminal.com/solana/pools/${esc(pool)}" target="_blank" rel="noopener">📊 GeckoTerminal</a><a href="https://dexscreener.com/solana/${esc(pool)}" target="_blank" rel="noopener">📈 DexScreener</a>`
      : `<a href="https://www.coingecko.com/en/coins/${esc(fk.slice(3))}" target="_blank" rel="noopener">📊 CoinGecko</a><a href="https://www.tradingview.com/symbols/${esc(sym)}USD/" target="_blank" rel="noopener">📈 TradingView</a>`;
    if (fk !== chartKey) safe("Chart", () => loadOhlc(true));
    // Rug-Panel für den Fokus-Coin
    if (mint && !rug[mint]) requestRug(mint);
    renderRug(mint, sym);
  } else {
    $("focus-info").innerHTML = "<div class='mut'>Warte auf Marktdaten…</div>"; renderRug(null);
  }

  // Agenten
  $("agents").innerHTML = [
    ["scanner", "SCANNER", `${nCg + nGt} Coins im Blick · ${nNew} neue Pools`],
    ["safety", "SAFETY", `Liq ≥ $${big(R.minLiq)} · Pool ≥ 3 Min · Kaufdruck · Bot-Volumen`],
    ["rug", "RUG-CHECK", CFG.rug ? `Mint/Freeze · LP · Top-10 · Insider · max ${R.maxRug}/100` : "aus – nur Basis-Checks"],
    ["analyst", "ANALYST", `Momentum 5m/1h · Score ≥ ${R.minScore}`],
    ["risk", "RISK", `${R.size * 100}% pro Trade · Stop −${R.sl}% · Trailing ${R.trail}%`],
    ["executor", "EXECUTOR", `${pe.length}/${R.maxPos} Positionen · Gebühren ${sol(S.fees || 0, 3)} SOL`],
  ].map((a) => `<div class="row"><span class="tag a-${a[0]}">${a[1]}</span><span class="txt">${esc(a[2])}</span></div>`).join("");

  // Live-Trades
  $("tcount").textContent = S.tr.length + " Trades";
  $("trades-live").innerHTML = S.tr.slice(0, 14).map((x, i) => `<div class="row trade${i === 0 && now() - x.ts < 8000 ? " new" : ""}"><span class="mut tiny">${new Date(x.ts).toLocaleTimeString("de-DE")}</span><span class="${x.side === "BUY" ? "buy" : "sell"}">${x.side}</span><span class="txt">${x.img ? `<img class="coinimg" src="${esc(x.img)}" alt="">` : ""}<b>${esc(x.sym)}</b> ${sol(x.amt)} SOL${x.pnl == null ? "" : ` · <b class="${x.pnl >= 0 ? "up" : "down"}">${ssol(x.pnl)}</b>`}<br><span class="mut tiny">${esc(x.why || "")}</span></span></div>`).join("") || "<div class='mut'>Noch keine Trades – der Bot sucht Einstiege…</div>";

  // Entscheidungen
  const cls = { BUY: "buy", SELL: "sell", RUG: "down", CHECK: "a-rug" };
  $("log").innerHTML = S.log.slice(0, 10).map((l) => `<div class="row"><span class="mut tiny">${l.t}</span><span class="${cls[l.type] || "skip"}" style="width:46px;font-size:12px">${l.type}</span><span class="txt">${esc(l.sym)} · ${esc(l.text)}</span></div>`).join("") || "<div class='mut'>Warte auf Marktdaten…</div>";

  // Quellen
  const SRC = [["Scanner", "GeckoTerminal + CoinGecko"], ["Analyse", "Safety · Analyst · Risk"], ["RugCheck", "Holder · LP · Authorities"], ["Executor", "Paper-Trades"]];
  $("repos").innerHTML = SRC.map((s, i) => `<div class="repo"><span>● ${s[0]} <span class="mut">· ${s[1]}</span></span><b class="up">${S.calls[i] || 0}</b></div>`).join("");

  // Ticker
  const tk = all.filter((m) => m.price).sort((a, b) => b.ch1 - a.ch1).slice(0, 14)
    .map((m) => `<span>${m.neu ? "🆕" : ""}<b>${esc(m.sym)}</b>${fmtP(m.price)}<i class="${m.ch1 >= 0 ? "up" : "down"}">${pct(m.ch1)}</i></span>`).join("");
  if ($("ticker").dataset.v !== tk) { $("ticker").innerHTML = tk + tk; $("ticker").dataset.v = tk; }

  // Einstellungen
  document.querySelectorAll("#risk button").forEach((b) => b.classList.toggle("on", b.dataset.r === CFG.risk));
  $("c-neu").checked = CFG.neu; $("c-et").checked = CFG.etabliert; $("c-rug").checked = CFG.rug;
  $("rinfo").textContent = `${R.size * 100}% pro Trade · Ziel +${R.tp}% · Stop −${R.sl}% · Trailing ab +${R.trailOn}% (−${R.trail}%) · max ${R.maxPos} Coins · Zeit-Exit ${R.timeMin} Min · Rug-Score ≤ ${R.maxRug}`;
  equityChart();
}

function renderRug(mint, sym) {
  const rc = mint ? rug[mint] : null;
  const links = $("rug-links"), v = $("rug-verdict");
  links.innerHTML = mint ? `<a href="https://rugcheck.xyz/tokens/${esc(mint)}" target="_blank" rel="noopener">🛡️ RugCheck</a><a href="https://app.bubblemaps.io/sol/token/${esc(mint)}" target="_blank" rel="noopener">🫧 Bubblemaps</a><a href="https://solscan.io/token/${esc(mint)}" target="_blank" rel="noopener">🔍 Solscan</a>` : "";
  if (!mint) { v.innerHTML = ""; $("rug").innerHTML = "<div class='mut tiny'>Rug-Check gibt es nur für Solana-Coins. Etablierte Coins (z. B. DOGE) werden nicht geprüft.</div>"; bubbles(null); return; }
  if (!rc || rc.pending) { v.innerHTML = '<span class="chip warn">PRÜFE…</span>'; $("rug").innerHTML = `<div class='mut tiny'>${esc(sym)} wird geprüft…</div>`; bubbles(rc || { pending: true }); return; }
  if (rc.fail) { v.innerHTML = '<span class="chip warn">N/A</span>'; $("rug").innerHTML = "<div class='mut tiny'>RugCheck nicht erreichbar. Der Bot kauft dann nur Pools, die älter als 60 Min sind und ≥ $50K Liquidität haben.</div>"; bubbles(rc); return; }
  const ok = !rc.reject && rc.score <= P().maxRug;
  v.innerHTML = `<span class="chip ${ok ? (rc.score <= 20 ? "ok" : "warn") : "bad"}">${ok ? "BESTANDEN" : "BLOCKIERT"} · ${rc.score}/100</span>`;
  const c = (good, txt) => `<span class="${good ? "up" : "down"}">${txt}</span>`;
  $("rug").innerHTML = `<div class="mut tiny" style="margin-bottom:4px">${esc(sym)} · Risiko-Score ${rc.score}/100 (0 = sicher)${rc.rc != null ? ` · RugCheck ${rc.rc}` : ""}</div>
    <div class="checks">
      <div><span class="mut">Mint</span>${c(!rc.reasons.some((x) => x.startsWith("Mint")), rc.reasons.some((x) => x.startsWith("Mint")) ? "aktiv ✗" : "gesperrt ✓")}</div>
      <div><span class="mut">Freeze</span>${c(!rc.reasons.some((x) => x.startsWith("Freeze")), rc.reasons.some((x) => x.startsWith("Freeze")) ? "aktiv ✗" : "gesperrt ✓")}</div>
      <div><span class="mut">LP gesperrt</span>${c(rc.lp >= 80, rc.lp.toFixed(0) + "%")}</div>
      <div><span class="mut">Top-10</span>${c(rc.top10 <= 25, rc.top10.toFixed(1) + "%")}</div>
      <div><span class="mut">Größter Holder</span>${c(rc.top1 <= 8, rc.top1.toFixed(1) + "%")}</div>
      <div><span class="mut">Insider</span>${c(rc.ins <= 8, rc.ins.toFixed(1) + "%")}</div>
    </div>
    ${rc.reasons.length ? `<div class="tiny down">⚠ ${rc.reasons.map(esc).join(" · ")}</div>` : `<div class="tiny up">✓ ${rc.ok.map(esc).join(" · ")}</div>`}`;
  bubbles(rc);
}

// ---------- Bedienung ----------
$("toggle").onclick = () => { paused = !paused; $("toggle").textContent = paused ? "▶ Weiter" : "⏸ Pause"; render(); };
$("reset").onclick = () => {
  const b = $("reset");
  if (b.dataset.armed) { S = fresh(); focusSel = null; save(); delete b.dataset.armed; b.textContent = "Zurücksetzen"; render(); }
  else { b.dataset.armed = 1; b.textContent = "Sicher? Nochmal tippen"; setTimeout(() => { delete b.dataset.armed; b.textContent = "Zurücksetzen"; }, 4000); }
};
document.querySelectorAll("#risk button").forEach((b) => (b.onclick = () => { CFG.risk = b.dataset.r; save(); render(); }));
$("c-neu").onchange = (e) => { CFG.neu = e.target.checked; save(); render(); };
$("c-et").onchange = (e) => { CFG.etabliert = e.target.checked; save(); render(); };
$("c-rug").onchange = (e) => { CFG.rug = e.target.checked; save(); render(); };

render();
Promise.all([safe("SOL-Preis", loadSol), safe("CoinGecko", loadCG), safe("GeckoTerminal", loadGT)]).then(tick);
setInterval(() => safe("SOL-Preis", loadSol), 60000);
setInterval(() => safe("CoinGecko", loadCG), 60000);
setInterval(() => safe("GeckoTerminal", loadGT), 30000);
setInterval(() => safe("Positionen", loadHeld), 15000);
setInterval(() => safe("Chart", () => loadOhlc(false)), 20000);
setInterval(tick, TICK_MS);
