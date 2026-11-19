// Claude Bot v3 – reine Paper-Trading-Simulation mit virtuellen 5 SOL (kein Wallet, kein echter Handel).
// Daten: GeckoTerminal (neue/trendende Solana-Pools, Charts, SOL-Preis), CoinGecko (etablierte Meme Coins),
// RugCheck (Rug-Pull-Prüfung, Holder + Insider-Netzwerke für die Cluster-Bubble-Map). Charts: TradingView Lightweight Charts,
// Bubble-Map: d3-force. Feldnamen am 18.11.2026 gegen die echten API-Antworten geprüft.
const CG = "https://api.coingecko.com/api/v3";
const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
const RC = "https://api.rugcheck.xyz/v1/tokens/";
const DS = "https://api.dexscreener.com";
const WSOL = "So11111111111111111111111111111111111111112";
// Basis-Token, die kein Meme Coin sind (GeckoTerminal listet auch Pools wie "SOL / XYZ" oder "USDC / XYZ")
const NOT_MEME = new Set([WSOL, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
const START = 5, TICK_MS = 5000, NET_FEE = 0.0005, MIN_TRADE = 0.05; // SOL
const FEE = { cg: 0.003, gt: 0.01 }; // simulierte DEX-Gebühr + Slippage je Seite
const PRESETS = {
  // clMax = größter Cluster (gemeinsame Funding-Quelle) in % · bundleN/bundlePct = ab so vielen Wallets aus einer Quelle mit so viel % → Bundle/Sniper
  vorsichtig: { size: 0.06, tp: 15, sl: 7,  trailOn: 8,  trail: 4,  maxPos: 4, minScore: 3.5, minLiq: 60000, timeMin: 120, maxRug: 25, maxCg: 1, clMax: 12, bundleN: 8,  bundlePct: 2 },
  normal:     { size: 0.10, tp: 30, sl: 12, trailOn: 12, trail: 6,  maxPos: 6, minScore: 3.0, minLiq: 25000, timeMin: 60,  maxRug: 40, maxCg: 1, clMax: 18, bundleN: 12, bundlePct: 4 },
  aggressiv:  { size: 0.15, tp: 90, sl: 20, trailOn: 25, trail: 12, maxPos: 8, minScore: 2.5, minLiq: 12000, timeMin: 30,  maxRug: 55, maxCg: 2, clMax: 25, bundleN: 20, bundlePct: 6 },
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
const fresh = () => ({ v: 3, cash: START, pos: {}, hist: [START], trades: 0, wins: 0, losses: 0, log: [], tr: [], closed: [], calls: [0, 0, 0, 0], cool: {}, best: 0, worst: 0, fees: 0, rugsAvoided: 0, since: now() });
let S = load("claudebot", null);
if (!S || S.v !== 3) S = fresh(); // Umstellung auf SOL: neuer Start mit 5 SOL
// Trade-Verlauf: ältere Stände haben noch keine Liste abgeschlossener Trades → aus dem Live-Trade-Log rekonstruieren
if (!Array.isArray(S.closed)) {
  S.closed = []; const open = {};
  for (const t of [...(S.tr || [])].reverse()) {
    if (t.side === "BUY") open[t.sym] = t;
    else if (t.side === "SELL" && open[t.sym]) {
      const b = open[t.sym]; delete open[t.sym];
      S.closed.unshift({ k: b.k || t.k || null, sym: t.sym, img: t.img || b.img, src: b.src || null, pool: b.pool || null, mint: b.mint || null, entry: b.p, exit: t.p,
        buyTs: b.ts, sellTs: t.ts, cost: b.amt, got: t.amt, pnl: t.pnl, pct: (t.pnl / (b.amt || 1)) * 100, why: t.why, approx: true });
    }
  }
}
let CFG = { risk: "normal", neu: true, etabliert: true, rug: true, ...load("claudebot-cfg", {}) };
const mk = {};            // Marktdaten: key -> Coin/Pool
const rug = {};           // Rug-Check-Ergebnisse: mint -> Bericht
const rugRaw = {};        // Rohdaten (Report + Insider-Graph) je mint – für Neuberechnung bei anderer Risikostufe
let solUsd = 0, paused = false, errs = {}, focusKey = null, focusSel = null;
const save = () => { try { localStorage.setItem("claudebot", JSON.stringify(S)); localStorage.setItem("claudebot-cfg", JSON.stringify(CFG)); } catch {} };
const P = () => PRESETS[CFG.risk] || PRESETS.normal;

// ---------- Daten ----------
// GeckoTerminal erlaubt ~30 Anfragen/Min. Bei Überschreitung kommt 429 OHNE CORS-Header – der Browser meldet das als
// Netzwerkfehler (Safari: "Load failed"). Deshalb alle GT-Anfragen hintereinander mit Mindestabstand.
const GT_GAP = 2500;
let gtNext = 0;
async function getJSON(u) {
  if (u.startsWith(GT.replace("/networks/solana", ""))) { const t = Math.max(now(), gtNext); gtNext = t + GT_GAP; if (t > now()) await sleep(t - now()); }
  let r;
  try { r = await fetch(u); } catch { throw new Error("blockiert/Limit"); } // Safari: "Load failed" (meist 429 ohne CORS-Header)
  if (r.status === 429) throw new Error("Rate-Limit");
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
async function safe(name, fn) { try { await fn(); delete errs[name]; } catch (e) { errs[name] = e.message || "Fehler"; } render(); }
// Quellen-Status mit Wartezeit bei Fehlern (exponentielles Backoff)
const src = { GeckoTerminal: { ok: null, fails: 0, until: 0 }, DexScreener: { ok: null, fails: 0, until: 0 }, Jupiter: { ok: null, fails: 0, until: 0 } };
const SRC_TAG = { GeckoTerminal: "GT", DexScreener: "DS", Jupiter: "⚡JUP" };
async function guarded(name, fn) {
  const s = src[name]; if (now() < s.until) return;
  try { await fn(); s.ok = true; s.fails = 0; }
  catch (e) { s.ok = false; s.fails++; s.err = e.message; s.until = now() + Math.min(300000, 15000 * 2 ** (s.fails - 1)); }
  render();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Preisverlauf pro Coin (für Ersatz-Chart, falls keine Kerzen verfügbar)
const ph = {};
function upsert(x) {
  mk[x.key] = { ...mk[x.key], ...x };
  if (x.price) { const a = (ph[x.key] ||= []); if (!a.length || now() - a[a.length - 1].t > 5000) a.push({ t: now(), p: x.price }); if (a.length > 600) a.shift(); }
}

// ---------- SOL-Kurs (EUR/USD) wie bei Google: Preis, Änderung, Verlauf 1 T. – 1 J., Umrechner ----------
const SOL_POOL = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2"; // Raydium SOL/USDC – Ersatzquelle für den Verlauf
let solEur = 0, solCh = {}, solT = 0, solDays = 1, solCur = load("claudebot-cur", "EUR");
let fx = load("claudebot-fx", 0.91); // EUR je USD (aus dem letzten CoinGecko-Kurs), nur für Ersatzquellen
const solHist = {}; // "EUR:1" -> { t, pts: [[ms, preis]], src }
const eurF = (n, d = 2) => (n ?? 0).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = (n) => eurF(n) + " €";
const solPrice = (cur = solCur) => (cur === "EUR" ? solEur || solUsd * fx : solUsd);
const money = (n, cur = solCur) => (cur === "EUR" ? eur(n) : "$" + eurF(n));
async function loadSol() {
  try {
    const d = (await getJSON(`${CG}/simple/price?ids=solana&vs_currencies=usd,eur&include_24hr_change=true`)).solana;
    if (d?.usd > 0) {
      solUsd = +d.usd; solEur = +d.eur || 0; solT = now();
      solCh = { USD: d.usd_24h_change, EUR: d.eur_24h_change };
      if (solEur) { fx = solEur / solUsd; try { localStorage.setItem("claudebot-fx", JSON.stringify(fx)); } catch {} }
      return;
    }
  } catch {}
  const tries = [ // Ersatz: nur USD, EUR über den zuletzt bekannten Wechselkurs
    async () => { const d = await getJSON(`${DS}/latest/dex/tokens/${WSOL}`); return +((d.pairs || []).filter((x) => x.baseToken?.address === WSOL).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0]?.priceUsd); },
    async () => +Object.values((await getJSON(`${GT.replace("/networks/solana", "")}/simple/networks/solana/token_price/${WSOL}`)).data.attributes.token_prices)[0],
  ];
  let last;
  for (const t of tries) { try { const v = await t(); if (v > 0) { solUsd = v; solEur = 0; solT = now(); solCh = {}; return; } } catch (e) { last = e; } }
  throw last || new Error("kein SOL-Preis");
}
async function loadSolChart(force) {
  const days = solDays, cur = solCur, key = cur + ":" + days, c = solHist[key];
  if (c && !force && now() - c.t < (days === 1 ? 300000 : 1800000)) return drawSol();
  try {
    const d = await getJSON(`${CG}/coins/solana/market_chart?vs_currency=${cur.toLowerCase()}&days=${days}`);
    if (!d.prices?.length) throw new Error("leer");
    solHist[key] = { t: now(), pts: d.prices, src: "CoinGecko" };
  } catch {
    const [tf, agg, lim] = days === 1 ? ["minute", 15, 96] : days === 5 ? ["hour", 1, 120] : days === 30 ? ["hour", 4, 180] : ["day", 1, days];
    const d = await getJSON(`${GT}/pools/${SOL_POOL}/ohlcv/${tf}?aggregate=${agg}&limit=${lim}&currency=usd`);
    const k = cur === "EUR" ? fx : 1;
    solHist[key] = { t: now(), pts: (d.data?.attributes?.ohlcv_list || []).map((x) => [x[0] * 1000, x[4] * k]).reverse(), src: "GeckoTerminal (Raydium SOL/USDC)" + (cur === "EUR" ? ", in EUR umgerechnet" : "") };
  }
  drawSol();
}
// Fehler beim Verlauf nur in der SOL-Karte anzeigen, nicht oben in der Statuszeile
let solErr = "";
const solChart = (force) => loadSolChart(force).then(() => (solErr = ""), (e) => (solErr = e.message || "Fehler")).finally(renderSol);
let solTv = null, solSeries = null, solTvKey = "";
function drawSol() {
  const h = solHist[solCur + ":" + solDays], el = $("sol-chart");
  if (!h?.pts?.length) return;
  const tz = new Date().getTimezoneOffset() * 60, seen = new Set();
  const data = h.pts.map(([t, v]) => ({ time: Math.floor(t / 1000) - tz, value: +v })).filter((x) => x.value > 0 && !seen.has(x.time) && seen.add(x.time)).sort((a, b) => a.time - b.time);
  if (!data.length) return;
  const up = data[data.length - 1].value >= data[0].value, col = up ? "#14f195" : "#ff4d6d";
  if (!window.LightweightCharts) return;
  if (!solTv) {
    el.innerHTML = "";
    solTv = LightweightCharts.createChart(el, {
      autoSize: true, layout: { background: { color: "transparent" }, textColor: "#7d869b", fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,.05)" } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      localization: { locale: "de-DE", priceFormatter: (p) => eurF(p) }, handleScroll: false, handleScale: false, crosshair: { mode: 1 },
    });
    solSeries = solTv.addAreaSeries({ lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
  }
  solSeries.applyOptions({ lineColor: col, topColor: up ? "rgba(20,241,149,.25)" : "rgba(255,77,109,.25)", bottomColor: "rgba(0,0,0,0)" });
  solTv.applyOptions({ timeScale: { timeVisible: solDays <= 5 } });
  solSeries.setData(data);
  const k = solCur + ":" + solDays;
  if (solTvKey !== k) { solTv.timeScale().fitContent(); solTvKey = k; }
  renderSol();
}
const RANGE_TXT = { 1: "24 Std.", 5: "5 Tage", 30: "1 Monat", 180: "6 Monate", 365: "1 Jahr" };
function renderSol() {
  const p = solPrice();
  document.querySelectorAll("#sol-range button").forEach((b) => b.classList.toggle("on", +b.dataset.d === solDays));
  $("cv-cur").value = solCur;
  if (!p) return;
  $("sol-big").textContent = eurF(p); $("sol-cur").textContent = solCur;
  // Änderung: 24 Std. direkt von CoinGecko, sonst aus dem Verlauf des gewählten Zeitraums
  let chp = null;
  const h = solHist[solCur + ":" + solDays];
  if (solDays === 1 && solCh[solCur] != null) chp = solCh[solCur];
  else if (h?.pts?.length) chp = (p / h.pts[0][1] - 1) * 100;
  if (chp != null) {
    const abs = p - p / (1 + chp / 100);
    $("sol-ch").className = chp >= 0 ? "up" : "down";
    // Ersatzquelle hat evtl. weniger Verlauf (GeckoTerminal: ~6 Monate) → tatsächlichen Zeitraum nennen
    const span = h?.pts?.length && solDays > 1 ? (h.pts[h.pts.length - 1][0] - h.pts[0][0]) / 86400000 : solDays;
    const rt = span < solDays * 0.8 ? `${Math.round(span)} Tage (mehr Verlauf gerade nicht verfügbar)` : RANGE_TXT[solDays];
    $("sol-ch").textContent = `${abs >= 0 ? "+" : "−"}${eurF(Math.abs(abs))} (${eurF(Math.abs(chp))} %) ${chp >= 0 ? "↑" : "↓"} ${rt}`;
  } else { $("sol-ch").className = "mut"; $("sol-ch").textContent = RANGE_TXT[solDays]; }
  $("sol-time").textContent = solT ? new Date(solT).toLocaleString("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  $("sol-src").textContent = `Kurs: ${solEur || solCur === "USD" ? "CoinGecko" : "DexScreener/GeckoTerminal (EUR geschätzt)"} · Verlauf: ${h?.src || (solErr ? "gerade nicht erreichbar (" + solErr + ")" : "lädt…")}`;
  // Umrechner (nicht überschreiben, während man tippt)
  const a = document.activeElement;
  if (a !== $("cv-fiat")) { const v = parseFloat($("cv-sol").value.replace(",", ".")); $("cv-fiat").value = isFinite(v) ? (v * p).toFixed(2) : ""; }
  else { const v = parseFloat($("cv-fiat").value.replace(",", ".")); if (a !== $("cv-sol")) $("cv-sol").value = isFinite(v) ? +(v / p).toFixed(6) : ""; }
}
async function loadCG() {
  const d = await getJSON(`${CG}/coins/markets?vs_currency=usd&category=meme-token&order=volume_desc&per_page=100&page=1&price_change_percentage=1h,24h`);
  for (const c of d) upsert({
    key: "cg:" + c.id, src: "cg", sym: c.symbol.toUpperCase(), name: c.name, img: c.image, price: c.current_price,
    mcap: c.market_cap, vol24: c.total_volume, ch1: c.price_change_percentage_1h_in_currency ?? 0, ch24: c.price_change_percentage_24h ?? 0, t: now() });
}
function gtItems(json, extra = {}) {
  const inc = {};
  (json.included || []).forEach((t) => (inc[t.id] = t.attributes));
  return (json.data || []).map((p) => {
    if (NOT_MEME.has((p.relationships?.base_token?.data?.id || "").replace(/^solana_/, ""))) return null;
    const a = p.attributes, tid = p.relationships?.base_token?.data?.id || "", tok = inc[tid] || {};
    const pc = a.price_change_percentage || {}, tx = a.transactions || {}, vol = a.volume_usd || {};
    return {
      key: "gt:" + a.address, src: "gt", ds: false, pool: a.address, mint: tok.address || tid.replace(/^solana_/, ""),
      sym: String(tok.symbol || a.name.split(" / ")[0]).toUpperCase().slice(0, 12), name: tok.name || a.name,
      img: tok.image_url && tok.image_url !== "missing.png" ? tok.image_url : "", price: +a.base_token_price_usd,
      fdv: +(a.fdv_usd || 0), liq: +(a.reserve_in_usd || 0), ch5: +(pc.m5 || 0), ch1: +(pc.h1 || 0), ch24: +(pc.h24 || 0),
      buys: tx.m5?.buys || 0, sells: tx.m5?.sells || 0, buyers: tx.m5?.buyers || 0, vol5: +(vol.m5 || 0), vol1: +(vol.h1 || 0),
      age: a.pool_created_at ? (now() - new Date(a.pool_created_at)) / 60000 : null, t: now(), ...extra,
    };
  }).filter(Boolean);
}
async function loadGT() { // nacheinander statt parallel, schont das Rate-Limit
  const n = await getJSON(`${GT}/new_pools?include=base_token`);
  gtItems(n, { neu: true }).forEach(upsert);
  await sleep(1500);
  const t = await getJSON(`${GT}/trending_pools?include=base_token`);
  gtItems(t, { trend: true }).forEach(upsert);
}
// DexScreener als zweite Quelle (neue Token-Profile + Boosts → beste Solana-Pools)
function dsItem(x, extra = {}) {
  const age = x.pairCreatedAt ? (now() - x.pairCreatedAt) / 60000 : null;
  return {
    key: "gt:" + x.pairAddress, src: "gt", pool: x.pairAddress, mint: x.baseToken?.address, ds: true,
    sym: String(x.baseToken?.symbol || "?").toUpperCase().slice(0, 12), name: x.baseToken?.name || "", img: x.info?.imageUrl || "",
    price: +x.priceUsd || 0, fdv: +(x.fdv || x.marketCap || 0), liq: +(x.liquidity?.usd || 0),
    ch5: +(x.priceChange?.m5 || 0), ch1: +(x.priceChange?.h1 || 0), ch24: +(x.priceChange?.h24 || 0),
    buys: x.txns?.m5?.buys || 0, sells: x.txns?.m5?.sells || 0, vol5: +(x.volume?.m5 || 0), vol1: +(x.volume?.h1 || 0),
    age, neu: age != null && age < 24 * 60, t: now(), ...extra,
  };
}
async function loadDS() {
  const [prof, boost] = await Promise.all([getJSON(`${DS}/token-profiles/latest/v1`), getJSON(`${DS}/token-boosts/latest/v1`)]);
  const mints = [...new Set([...(prof || []), ...(boost || [])].filter((x) => x.chainId === "solana").map((x) => x.tokenAddress))].slice(0, 30);
  if (!mints.length) return;
  const d = await getJSON(`${DS}/latest/dex/tokens/${mints.join(",")}`);
  const best = {};
  for (const x of d.pairs || []) {
    if (x.chainId !== "solana" || !mints.includes(x.baseToken?.address) || NOT_MEME.has(x.baseToken.address)) continue;
    const m = x.baseToken.address;
    if (!best[m] || (x.liquidity?.usd || 0) > (best[m].liquidity?.usd || 0)) best[m] = x;
  }
  Object.values(best).forEach((x) => upsert(dsItem(x)));
}
async function loadHeld() {
  const a = Object.keys(S.pos).filter((k) => k.startsWith("gt:")).map((k) => k.slice(3));
  if (!a.length) return;
  try {
    if (now() < src.GeckoTerminal.until) throw new Error("pausiert");
    const d = await getJSON(`${GT}/pools/multi/${a.slice(0, 30).join(",")}?include=base_token`);
    gtItems(d).forEach(upsert);
  } catch {
    const d = await getJSON(`${DS}/latest/dex/pairs/solana/${a.slice(0, 30).join(",")}`);
    [...(d.pairs || []), ...(d.pair ? [d.pair] : [])].forEach((x) => upsert(dsItem(x, { neu: mk["gt:" + x.pairAddress]?.neu })));
  }
}

// ---------- Schnelle Preise (Jupiter) ----------
// Jupiter Price API v3 (gratis, ohne Key, CORS ok): bis 50 Mints pro Anfrage, Preis ändert sich etwa alle 10 s.
// Gilt für alle offenen Solana-Positionen + den Coin im Chart; danach werden Stop/Ziel sofort geprüft.
const JUP = "https://lite-api.jup.ag/price/v3?ids=", JUP_MS = 3000;
let lastLive = 0;
async function loadLive() {
  const keys = new Set(Object.keys(S.pos).filter((k) => k.startsWith("gt:")));
  if (focusKey?.startsWith("gt:")) keys.add(focusKey);
  const byMint = {};
  for (const k of keys) { const mint = S.pos[k]?.mint || mk[k]?.mint; if (mint && !NOT_MEME.has(mint)) (byMint[mint] ||= []).push(k); }
  const mints = Object.keys(byMint).slice(0, 50);
  if (!mints.length) return;
  const d = await getJSON(JUP + mints.join(","));
  for (const [mint, x] of Object.entries(d || {})) {
    const pr = +x?.usdPrice; if (!(pr > 0)) continue;
    for (const k of byMint[mint] || []) { upsert({ key: k, price: pr, t: now(), live: now() }); liveCandle(k, pr); }
  }
  lastLive = now();
  if (!paused && solUsd) { checkExits(); save(); }
}

// ---------- Rug-Check ----------
// Kriterien nach gängigen Checklisten (RugCheck, Bubblemaps, DEXTools u. a.):
// Mint-/Freeze-Authority aktiv = Ausschluss · LP des Haupt-Pools < 50 % gesperrt = Ausschluss · Top-10 > 40 % (ohne Pool) = Ausschluss
// einzelner Holder > 15 % = Ausschluss · Insider > 20 % = Ausschluss · Cluster (gemeinsame Funding-Quelle) > clMax = Ausschluss
// Bundle/Sniper (viele Wallets aus einer Quelle) = Ausschluss · Dev > 5 % = Risiko · RugCheck-"danger"-Risiken.
// Echte RugCheck-Felder (geprüft 18.11.2026): token.{mintAuthority,freezeAuthority,supply}, markets[].{pubkey,marketType,liquidityA,liquidityB,
// lp.{lpLockedPct,baseUSD,quoteUSD}}, topHolders[].{address,owner,pct,insider}, knownAccounts{addr:{name,type:AMM|LOCKER|CREATOR}},
// insiderNetworks[].{id,size,type:transfer|trade,currentHolding}, graphInsidersDetected, risks[].{name,level}, score_normalised, rugged, totalHolders.
// Insider-Graph: GET /v1/tokens/<mint>/insiders/graph → [{net_id, network_type, nodes:[{id,participant,holdings}], links:[{source,target}]}]
const CL_POOL = /clmm|dlmm|whirlpool|orca|concentrated/i; // konzentrierte Liquidität: LP-Lock nicht anwendbar
const MASS_NET = 1000; // Netzwerke mit > 1000 Wallets sind meist Börsen/Airdrops, keine Rug-Cluster
function analyseRug(r, g, pool, fd) {
  const R = P();
  const out = { score: 0, reasons: [], hard: [], ok: [], notes: [], reject: false, holders: [], clusters: [] };
  const bad = (pts, txt, hard) => { out.score += pts; out.reasons.push(txt); if (hard) { out.reject = true; out.hard.push(txt); } };
  if (r.rugged) bad(100, "Bereits als Rug markiert", true);
  const tok = r.token || {};
  (tok.mintAuthority ?? r.mintAuthority) ? bad(40, "Mint-Authority aktiv (unbegrenzt neue Tokens möglich)", true) : out.ok.push("Mint gesperrt");
  (tok.freezeAuthority ?? r.freezeAuthority) ? bad(40, "Freeze-Authority aktiv (Honeypot-Gefahr)", true) : out.ok.push("Freeze gesperrt");
  // LP: zählt der gehandelte Pool (bzw. der größte), nicht irgendein Mini-Pool mit 100 % Lock
  const ms = r.markets || [], liqOf = (m) => (+m.lp?.baseUSD || 0) + (+m.lp?.quoteUSD || 0);
  const main = ms.find((m) => pool && m.pubkey === pool) || [...ms].sort((a, b) => liqOf(b) - liqOf(a))[0];
  const lp = main ? +(main.lp?.lpLockedPct ?? 0) : +(r.lpLockedPct ?? 0);
  Object.assign(out, { lp, lpType: main?.marketType || "", clmm: CL_POOL.test(main?.marketType || "") });
  if (out.clmm) bad(6, `Haupt-Pool ${main.marketType}: konzentrierte Liquidität, kein LP-Lock möglich`);
  else if (lp < 50) bad(30, `Liquidität nur ${lp.toFixed(0)}% gesperrt – kann abgezogen werden`, true);
  else if (lp < 80) bad(15, `Liquidität nur ${lp.toFixed(0)}% gesperrt`);
  else out.ok.push(`LP ${lp.toFixed(0)}% gesperrt/verbrannt`);
  // Pool-/Locker-Wallets erkennen (zählen nicht als Holder)
  const known = r.knownAccounts || {}, poolSet = new Set();
  for (const m of ms) [m.pubkey, m.liquidityA, m.liquidityB, m.liquidityAAccount?.owner, m.liquidityBAccount?.owner].forEach((a) => a && poolSet.add(a));
  for (const [a, k] of Object.entries(known)) if (/AMM|LOCKER|POOL/i.test(k?.type || "")) poolSet.add(a);
  const isPool = (a) => !!a && poolSet.has(a);
  const creator = r.creator || "", isDev = (a) => !!a && (a === creator || known[a]?.type === "CREATOR");
  out.holders = (r.topHolders || []).map((h) => ({ addr: h.owner || h.address || "?", acct: h.address, pct: +h.pct || 0, insider: !!h.insider,
    dev: isDev(h.owner) || isDev(h.address), lp: isPool(h.address) || isPool(h.owner) }));
  const real = out.holders.filter((h) => !h.lp);
  const top10 = real.slice(0, 10).reduce((s, h) => s + h.pct, 0), top1 = real[0]?.pct || 0;
  const ins = real.filter((h) => h.insider).reduce((s, h) => s + h.pct, 0), dev = real.filter((h) => h.dev).reduce((s, h) => s + h.pct, 0);
  Object.assign(out, { top10, top1, ins, dev, holderCount: r.totalHolders ?? null });
  if (top10 > 40) bad(25, `Top-10 halten ${top10.toFixed(0)}%`, true); else if (top10 > 25) bad(10, `Top-10 halten ${top10.toFixed(0)}%`); else out.ok.push(`Top-10 nur ${top10.toFixed(0)}%`);
  if (top1 > 15) bad(20, `Ein Wallet hält ${top1.toFixed(1)}%`, true); else if (top1 > 8) bad(8, `Größter Holder ${top1.toFixed(1)}%`);
  if (ins > 20) bad(25, `Insider halten ${ins.toFixed(0)}%`, true); else if (ins > 8) bad(12, `Insider halten ${ins.toFixed(0)}%`);
  if (dev > 5) bad(10, `Dev hält ${dev.toFixed(1)}%`);
  if (r.totalHolders != null && r.totalHolders < 30) bad(8, `Nur ${r.totalHolders} Holder`);
  if (r.tokenMeta?.mutable) bad(5, "Metadaten änderbar");

  // Cluster = Wallets mit gemeinsamer Funding-Quelle (RugCheck-Insider-Netzwerke)
  const supply = +tok.supply || 0, nets = [];
  const pctOf = (raw) => (supply ? Math.min(100, (100 * (+raw || 0)) / supply) : 0);
  if (Array.isArray(g) && g.length) {
    for (const n of g) {
      const nodes = n.nodes || [], links = n.links || [], fan = {};
      links.forEach((l) => (fan[l.source] = (fan[l.source] || 0) + 1));
      const hub = Object.entries(fan).sort((a, b) => b[1] - a[1])[0];
      const members = nodes.filter((x) => !isPool(x.id)).map((x) => ({ id: x.id, pct: pctOf(x.holdings), part: x.participant !== false }));
      nets.push({ id: n.net_id, type: n.network_type || "transfer", size: nodes.length, pct: Math.min(100, members.reduce((s, x) => s + x.pct, 0)),
        hub: hub?.[0] || null, fan: hub?.[1] || 0, members, links: links.filter((l) => !isPool(l.source) && !isPool(l.target)) });
    }
  }
  // Zusammenfassung aus dem Report (enthält auch Riesen-Netzwerke, die der Graph weglässt)
  for (const n of r.insiderNetworks || []) {
    if (nets.length && (n.size || 0) <= MASS_NET) continue; // schon aus dem Graph
    nets.push({ id: n.id, type: n.type || "transfer", size: n.size || n.activeAccounts || 0, pct: pctOf(n.currentHolding), hub: null, fan: Math.max(0, (n.size || 1) - 1), members: [], links: [] });
  }
  // ---- Eigene Bubblemaps-Logik (unabhängig von RugCheck) ----
  // a) Gleich große Wallets: Dev kauft beim Start mit vielen Wallets gleich viel (Bundle). Beispiel GTA: 11 × ~2,3 %.
  const bigH = real.filter((h) => h.pct >= 0.8).map((h) => h.pct).sort((a, b) => b - a);
  let eq = null;
  for (const c of bigH) { const grp = bigH.filter((x) => Math.abs(x - c) / c <= 0.06); if (grp.length >= 4 && (!eq || grp.length > eq.n)) eq = { n: grp.length, each: c, sum: grp.reduce((s, x) => s + x, 0) }; }
  out.equal = eq;
  if (eq) real.forEach((h) => { if (h.pct >= 0.8 && Math.abs(h.pct - eq.each) / eq.each <= 0.06) h.eq = true; });
  if (eq && eq.sum >= 6) bad(40, `Bundle: ${eq.n} Wallets halten je ~${eq.each.toFixed(1)}% (zusammen ${eq.sum.toFixed(0)}%)`, true);
  // b) Funding: welche Wallet hat den Top-Holdern ihr erstes SOL geschickt (Solana-RPC, siehe analyseFunding)
  out.fund = fd ? { checked: fd.checked, fresh: fd.fresh, fail: fd.fail || null } : null;
  if (fd && !fd.fail) {
    const pctBy = {}; real.forEach((h) => (pctBy[h.addr] = h.pct));
    const groups = Object.entries(fd.by || {}).map(([src, ws]) => ({ src, ws, pct: ws.reduce((s, w) => s + (pctBy[w] || 0), 0), ex: !!fd.busy?.[src] }))
      .filter((x) => x.ws.length >= 2 && !isPool(x.src)).sort((a, b) => b.ws.length - a.ws.length || b.pct - a.pct);
    for (const x of groups) nets.push({ id: "fund:" + x.src, type: "funding", size: x.ws.length + 1, pct: Math.min(100, x.pct), hub: x.src, fan: x.ws.length,
      members: [{ id: x.src, pct: pctBy[x.src] || 0 }, ...x.ws.map((w) => ({ id: w, pct: pctBy[w] || 0 }))], links: x.ws.map((w) => ({ source: x.src, target: w })), ex: x.ex });
    const worst = groups.find((x) => (x.ws.length >= 3 && x.pct >= 5 && !x.ex) || (x.ws.length >= 5 && x.pct >= 10));
    out.fundTop = groups[0] || null;
    if (worst) bad(45, `Funding-Cluster: ${worst.ws.length} Top-Holder vom selben Wallet ${worst.src.slice(0, 4)}…${worst.src.slice(-4)} finanziert, halten ${worst.pct.toFixed(1)}%${worst.ex ? " (Quelle sehr aktiv, evtl. Börse)" : ""}`, true);
    else if (groups[0]?.ws.length >= 3) bad(10, `${groups[0].ws.length} Top-Holder mit gemeinsamer Quelle (${groups[0].pct.toFixed(1)}%)`);
    if (fd.fresh.n >= 5 && fd.fresh.pct >= 10) bad(35, `Frische Wallets: ${fd.fresh.n} Top-Holder jünger als 3 Tage halten ${fd.fresh.pct.toFixed(0)}%`, true);
    else if (fd.fresh.n >= 3 && fd.fresh.pct >= 5) bad(10, `${fd.fresh.n} frische Wallets halten ${fd.fresh.pct.toFixed(1)}%`);
  }
  const cl = nets.filter((n) => n.size <= MASS_NET && n.size >= 2).sort((a, b) => b.pct - a.pct), mass = nets.filter((n) => n.size > MASS_NET);
  out.clusters = cl; out.mass = mass;
  const top = cl[0], sumCl = cl.reduce((s, n) => s + n.pct, 0);
  out.clTop = top?.pct || 0; out.clSum = sumCl;
  if (top && top.pct >= R.clMax) bad(30, `Cluster aus ${top.size} Wallets hält ${top.pct.toFixed(0)}%`, true);
  else if (sumCl >= R.clMax * 1.5) bad(25, `${cl.length} Cluster halten zusammen ${sumCl.toFixed(0)}%`, true);
  else if (top && top.pct >= R.clMax / 2) bad(12, `Cluster aus ${top.size} Wallets hält ${top.pct.toFixed(1)}%`);
  else if (cl.length) out.ok.push(`größter Cluster ${out.clTop.toFixed(1)}%`);
  const bundle = cl.filter((n) => n.type !== "trade" && n.fan >= R.bundleN && n.pct >= R.bundlePct).sort((a, b) => b.fan - a.fan)[0];
  out.bundle = bundle || null;
  if (bundle) bad(25, `Bundle/Sniper: ${bundle.fan} Wallets aus einer Quelle halten ${bundle.pct.toFixed(1)}%`, true);
  const coord = cl.filter((n) => n.type === "trade" && n.size >= 20).sort((a, b) => b.size - a.size)[0];
  if (coord) bad(8, `${coord.size} Wallets handeln koordiniert`);
  if (mass.length) out.notes.push(`Großes Verteilungs-Netzwerk (${big(mass[0].size)} Wallets, ${mass[0].pct.toFixed(0)}%) – meist Börse/Airdrop, nicht gewertet`);

  const danger = (r.risks || []).filter((x) => x.level === "danger");
  const serial = danger.find((x) => /rugged/i.test(x.name || ""));
  if (serial) bad(35, "Dev hat schon Rugs gemacht (RugCheck)", true);
  const rest = danger.filter((x) => x !== serial && !/mint authority|freeze authority/i.test(x.name || ""));
  if (rest.length) bad(8 * rest.length, "RugCheck: " + rest.map((x) => x.name).join(", "));
  out.score = Math.min(100, out.score);
  out.rc = r.score_normalised;
  return out;
}
let rugBusy = 0;
function requestRug(mint, pool) {
  if (!mint || rug[mint] || now() - rugBusy < 2500) return;
  rugBusy = now(); rug[mint] = { pending: true, t: now() };
  S.calls[2]++;
  (async () => {
    try {
      const r = await getJSON(RC + mint + "/report");
      let g = null;
      if ((r.graphInsidersDetected || 0) > 0 || (r.insiderNetworks || []).length) {
        try { await sleep(400); g = await getJSON(RC + mint + "/insiders/graph"); } catch { g = null; } // Graph ist nur ein Zusatz
      }
      rugRaw[mint] = { r, g, pool };
      rug[mint] = { ...analyseRug(r, g, pool, fund[mint]), t: now(), graph: !!g };
      delete errs.RugCheck;
    } catch (e) { rug[mint] = { fail: true, t: now() }; errs.RugCheck = e.message || "nicht erreichbar"; }
    render();
  })();
}
const reanalyse = (only) => { for (const [m, x] of Object.entries(rugRaw)) if (!only || only === m) rug[m] = { ...analyseRug(x.r, x.g, x.pool, fund[m]), t: now(), graph: !!x.g }; };

// ---------- Funding-Check über Solana-RPC (wie Bubblemaps) ----------
// Für die 20 größten echten Holder: erste Transaktion der Wallet → wer hat sie finanziert (erste SOL-/Token-Überweisung)
// und wie alt ist sie. Wallets mit ≥ 1000 Transaktionen gelten als alt/aktiv (keine frische Sybil-Wallet).
// api.mainnet-beta.solana.com lehnt Anfragen aus dem Browser ab (403 bei Origin-Header) → PublicNode (gratis, ohne Key, CORS *)
const SOL_RPC = "https://solana-rpc.publicnode.com", RPC_GAP = 130;
let rpcNext = 0;
async function rpc(method, params) {
  const t = Math.max(now(), rpcNext); rpcNext = t + RPC_GAP; if (t > now()) await sleep(t - now());
  let r;
  try { r = await fetch(SOL_RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); }
  catch { throw new Error("Solana-RPC blockiert/Limit"); }
  if (r.status === 429) throw new Error("Solana-RPC-Limit");
  if (!r.ok) throw new Error("Solana-RPC HTTP " + r.status);
  const j = await r.json(); if (j.error) throw new Error("Solana-RPC: " + (j.error.message || "Fehler"));
  return j.result;
}
const walletInfo = {}; // wallet -> { src, ageH, txs, old }
async function fundingOf(w) {
  if (walletInfo[w]) return walletInfo[w];
  const sigs = (await rpc("getSignaturesForAddress", [w, { limit: 1000 }])) || [];
  if (sigs.length >= 1000) return (walletInfo[w] = { old: true, txs: sigs.length });
  const first = sigs[sigs.length - 1];
  if (!first) return (walletInfo[w] = { txs: 0 });
  const ageH = first.blockTime ? (now() / 1000 - first.blockTime) / 3600 : null;
  const tx = await rpc("getTransaction", [first.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }]);
  const msg = tx?.transaction?.message || {}, ixs = [...(msg.instructions || []), ...((tx?.meta?.innerInstructions || []).flatMap((x) => x.instructions || []))];
  let src = null;
  for (const ix of ixs) {
    const p = ix?.parsed; if (!p || typeof p !== "object") continue;
    const i = p.info || {};
    if (/^transfer/.test(p.type) && i.destination === w && i.source && i.source !== w) { src = i.source; break; }
    if (p.type === "createAccount" && i.newAccount === w && i.source !== w) { src = i.source; break; }
  }
  if (!src) { const k = (msg.accountKeys || [])[0]; const fee = typeof k === "string" ? k : k?.pubkey; if (fee && fee !== w) src = fee; } // sonst: wer die Gebühr bezahlt hat
  return (walletInfo[w] = { src, ageH, txs: sigs.length });
}
const fund = {}; // mint -> Ergebnis
async function analyseFunding(mint) {
  const rc = rug[mint];
  const hs = (rc?.holders || []).filter((h) => !h.lp && h.addr && h.addr !== "?").sort((a, b) => b.pct - a.pct).slice(0, 20);
  const by = {}, fresh = { n: 0, pct: 0 };
  let checked = 0;
  let errors = 0, lastErr = "";
  for (const h of hs) {
    let f;
    try { f = await fundingOf(h.addr); } catch (e) { errors++; lastErr = e.message; if (/Limit|blockiert|HTTP/.test(e.message) && errors >= 3) throw e; continue; } // einzelne Wallet überspringen
    checked++;
    if (f.src) (by[f.src] ||= []).push(h.addr);
    if (!f.old && f.ageH != null && f.ageH < 72) { fresh.n++; fresh.pct += h.pct; }
  }
  // Quellen mit vielen Wallets: ist das eine sehr aktive Wallet (Börse)? Dann nur bei sehr großem Cluster blockieren.
  const busy = {};
  for (const [src, ws] of Object.entries(by)) if (ws.length >= 3) { const sigs = (await rpc("getSignaturesForAddress", [src, { limit: 1000 }])) || []; busy[src] = sigs.length >= 1000; }
  if (hs.length && checked < hs.length / 2) throw new Error(lastErr || "zu wenige Wallets prüfbar");
  return { by, fresh, busy, checked, errors, t: now() };
}
let fundBusy = false;
function requestFunding(mint) {
  if (!mint || fund[mint] || fundBusy) return;
  fundBusy = true; fund[mint] = { pending: true, t: now() };
  analyseFunding(mint).then((x) => { fund[mint] = x; }, (e) => { fund[mint] = { fail: e.message || "Fehler", t: now() }; })
    .finally(() => { fundBusy = false; if (rugRaw[mint]) reanalyse(mint); render(); });
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
    // Solana-Fokus: etablierte Coins nur als Beimischung → gedämpfter, begrenzter Score
    const nCg = Object.values(S.pos).filter((p) => p.src === "cg").length;
    if (nCg >= P().maxCg) return { skip: `Fokus Solana: schon ${nCg} etablierte${nCg > 1 ? "" : "r"} Coin` };
    const cl = (v, a, b) => Math.max(a, Math.min(b, v || 0));
    return { s: 1.5 + cl(m.ch1, -5, 6) / 1.5 + cl(m.ch24, -20, 60) / 30, why: `1h ${pct(m.ch1)} · 24h ${pct(m.ch24)}` };
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
  const t = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }), l0 = S.log[0];
  if (l0 && l0.type === type && l0.sym === sym && l0.text === text) { l0.t = t; l0.n = (l0.n || 1) + 1; return; } // keine Wiederholungen
  S.log.unshift({ t: new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }), type, sym, text });
  S.log = S.log.slice(0, 50);
}
function sell(k, reason) {
  const p = S.pos[k], got = valSol(k, p) - NET_FEE, pnl = got - p.cost;
  (S.closed ||= []).unshift({ k, sym: p.sym, name: p.name, img: p.img, src: p.src, pool: p.pool || null, mint: p.mint || null, entry: p.entry, exit: price(k) || p.entry,
    buyTs: p.ts, sellTs: now(), cost: p.cost, got, pnl, pct: (pnl / p.cost) * 100, why: reason, tp: p.tp, sl: p.sl, peak: p.peak || 0 });
  S.closed = S.closed.slice(0, 100);
  S.cash += got; S.fees += NET_FEE + p.qty * (price(k) || p.entry) * FEE[p.src] / (solUsd || 1);
  delete S.pos[k]; S.trades++; S.cool[k] = now();
  pnl >= 0 ? S.wins++ : S.losses++;
  S.best = Math.max(S.best, pnl); S.worst = Math.min(S.worst, pnl);
  S.tr.unshift({ ts: now(), side: "SELL", k, sym: p.sym, img: p.img, p: price(k) || p.entry, amt: got, pnl, why: reason });
  S.tr = S.tr.slice(0, 80);
  log("SELL", p.sym, `${ssol(pnl)} · ${reason}`);
  if (CFG.notifySell) notify(`${pnl >= 0 ? "💰" : "🔻"} Verkauf: ${p.sym} ${ssol(pnl)}`, reason, p.img);
  S.calls[3]++;
}
function buy(m, why, rc) {
  const R = P(), size = Math.min(S.cash - NET_FEE, equity() * R.size);
  if (size < MIN_TRADE) { log("SKIP", m.sym, "Risk: kein SOL frei"); return; }
  const qty = (size * solUsd * (1 - FEE[m.src])) / m.price;
  S.cash -= size + NET_FEE; S.fees += NET_FEE + size * FEE[m.src];
  S.pos[m.key] = { src: m.src, sym: m.sym, name: m.name, img: m.img, mint: m.mint, pool: m.pool, qty, cost: size + NET_FEE, entry: m.price,
    ts: now(), peak: 0, tp: R.tp, sl: R.sl, liq0: m.liq || 0, liqDs: !!m.ds, neu: !!m.neu, rug: rc ? rc.score : null };
  S.trades++; S.calls[3]++;
  S.tr.unshift({ ts: now(), side: "BUY", k: m.key, src: m.src, pool: m.pool || null, mint: m.mint || null, sym: m.sym, img: m.img, p: m.price, amt: size, pnl: null, why: (m.neu ? "🆕 " : m.src === "gt" ? "🔥 " : "") + why + (rc ? ` · Rug ${rc.score}/100` : "") });
  S.tr = S.tr.slice(0, 80);
  log("BUY", m.sym, `${sol(size)} SOL · ${why}`);
  notify(`🟢 Kauf: ${m.sym}`, `${sol(size)} SOL zu ${fmtP(m.price)} · Ziel +${R.tp}% · Stop −${R.sl}%`, m.img);
}

function checkExits() {
  const R = P();
  for (const [k, p] of Object.entries(S.pos)) {
    const m = mk[k]; if (!m || now() - m.t > 10 * 60000) continue;
    // GeckoTerminal und DexScreener messen Liquidität unterschiedlich → bei Quellenwechsel neue Basis statt falschem Rug-Alarm
    if (!!m.ds !== !!p.liqDs && m.liq) { p.liq0 = m.liq; p.liqDs = !!m.ds; }
    const ch = (valSol(k, p) / p.cost - 1) * 100;
    p.peak = Math.max(p.peak || 0, ch);
    const mins = (now() - p.ts) / 60000;
    if (p.liq0 && m.liq && m.liq < p.liq0 * 0.6) sell(k, `🚨 Liquidität −${((1 - m.liq / p.liq0) * 100).toFixed(0)}% – Rug-Verdacht, Notverkauf`);
    else if (ch >= p.tp) sell(k, `Take-Profit ${pct(ch)}`);
    else if (ch <= -p.sl) sell(k, `Stop-Loss ${pct(ch)}`);
    else if (p.peak >= R.trailOn && p.peak - ch >= R.trail) sell(k, `Trailing-Stop (Hoch ${pct(p.peak)})`);
    else if (mins > R.timeMin && ch < 2) sell(k, `Zeit-Exit nach ${Math.round(mins)} Min`);
  }
}
function tick() {
  if (paused || !solUsd) return;
  const R = P();
  // 1) Ausstiege
  checkExits();
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
        if (!rc) { requestRug(m.mint, m.pool); log("CHECK", m.sym, "Rug-Check läuft…"); acted = true; break; }
        if (rc.pending) { acted = true; break; }
        // Strenger Funding-Check (Bubblemaps-Logik) vor jedem Kauf eines Solana-Coins
        if (!rc.fail && !rc.reject && CFG.rug) {
          const fd = fund[m.mint];
          if (!fd) { requestFunding(m.mint); log("CHECK", m.sym, "Funding-Check: wer hat die Top-Holder finanziert…"); acted = true; break; }
          if (fd.pending) { acted = true; break; }
          if (fd.fail) {
            if (now() - fd.t > 3 * 60000) delete fund[m.mint]; // später neu versuchen
            if (m.age == null || m.age < 24 * 60) { S.cool[m.key] = now() - 25 * 60000; log("SKIP", m.sym, `🛡️ Funding-Check nicht möglich (${fd.fail}) – neuer Coin wird nicht gekauft`); acted = true; continue; }
          }
        }
        if (rc.fail) {
          if (CFG.rug && !fallbackOk(m)) { S.cool[m.key] = now(); log("SKIP", m.sym, "Rug-Check nicht erreichbar – zu neu/zu wenig Liquidität"); continue; }
        } else if (rc.reject || rc.score > R.maxRug) {
          S.cool[m.key] = now(); S.rugsAvoided++;
          log("RUG", m.sym, `🛡️ blockiert (${rc.score}/100): ${rc.hard[0] || rc.reasons[0] || "zu riskant"}`); acted = true; continue;
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
// Drei Ansichten: "bot" = eigener Kerzenchart mit 1-Min-Kerzen + Live-Preis,
// "s1" = eigener Chart mit 1-SEKUNDEN-Kerzen aus den Einzel-Trades (GeckoTerminal /pools/<pool>/trades, gratis, letzte 300 Trades)
//        → hier sind Einstieg/Ziel/Stop eingezeichnet,
// "ds" = eingebetteter DexScreener-Chart mit 1-Sekunden-Kerzen (interval=1S, live; Linien dort nicht möglich).
let chartMode = load("claudebot-chart", "s1"), embedKey = "";
if (chartMode === "live1s" || chartMode === "gt") chartMode = "ds";
if (!["bot", "s1", "ds"].includes(chartMode)) chartMode = "s1";
const poolOf = (k) => S.pos[k]?.pool || mk[k]?.pool || "";
const secBars = {}; // key -> { sekunde: {time,open,high,low,close} }
let tradesBusy = false, tradesAt = 0, tradesErr = "";
async function loadTrades(k) {
  const pool = poolOf(k), mint = S.pos[k]?.mint || mk[k]?.mint;
  if (!pool || tradesBusy) return;
  tradesBusy = true;
  try {
    let d;
    try {
      if (now() < src.GeckoTerminal.until) throw new Error("pausiert");
      d = await getJSON(`${GT}/pools/${pool}/trades`); tradesErr = "";
    } catch (e) { // Ersatz: Kerzen aus den selbst gesammelten Preisen (Jupiter/DexScreener), keine Fehlermeldung oben
      tradesErr = e.message || "Fehler";
      if (chartMode === "s1" && focusKey === k) drawChart(k, localBars(k));
      return;
    }
    const by = (secBars[k] ||= {});
    const tr = (d.data || []).map((x) => x.attributes).filter((a) => a && !a.is_anomalous)
      .map((a) => ({ t: Math.floor(new Date(a.block_timestamp) / 1000), p: +(a.from_token_address === mint ? a.price_from_in_usd : a.to_token_address === mint ? a.price_to_in_usd : a.kind === "sell" ? a.price_from_in_usd : a.price_to_in_usd) }))
      .filter((x) => x.p > 0 && x.t > 0).sort((a, b) => a.t - b.t);
    // Trades einer Sekunde zu einer Kerze; GT liefert neueste zuerst – bereits gezeichnete Sekunden werden neu berechnet
    const fresh = {};
    for (const x of tr) { const b = fresh[x.t]; fresh[x.t] = b ? { ...b, high: Math.max(b.high, x.p), low: Math.min(b.low, x.p), close: x.p } : { time: x.t, open: x.p, high: x.p, low: x.p, close: x.p }; }
    Object.assign(by, fresh);
    const keys = Object.keys(by).map(Number).sort((a, b) => a - b);
    for (const t of keys.slice(0, Math.max(0, keys.length - 3600))) delete by[t]; // max. 1 Std. Sekunden-Kerzen
    tradesAt = now();
    if (chartMode === "s1" && focusKey === k) drawChart(k, Object.values(by).sort((a, b) => a.time - b.time), true);
  } finally { tradesBusy = false; }
}
function setChartMode(m) { chartMode = m; try { localStorage.setItem("claudebot-chart", JSON.stringify(m)); } catch {} embedKey = ""; tv = null; chartKey = null; series = null; if (!$("tv").classList.contains("embed")) $("tv").innerHTML = ""; render(); }
function showEmbed(pool) {
  const el = $("tv"), k = chartMode + ":" + pool;
  el.classList.add("embed");
  if (embedKey === k) return;
  embedKey = k; tv = null; series = null; chartKey = null;
  const url = `https://dexscreener.com/solana/${encodeURIComponent(pool)}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=1S`;
  el.innerHTML = `<iframe src="${url}" title="Live-Chart" loading="lazy" allow="clipboard-write" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
}
let tv = null, series = null, lines = [], chartKey = null, lastOhlc = 0, ohlcBusy = null, lastBar = null;
// Live-Preis in die aktuelle 1-Minuten-Kerze schreiben (ohne neuen Abruf)
function liveCandle(k, pr) {
  if (!series || k !== chartKey || !lastBar || chartMode !== "bot") return;
  const t = Math.floor(now() / 60000) * 60;
  if (t < lastBar.time) return;
  lastBar = t === lastBar.time ? { ...lastBar, high: Math.max(lastBar.high, pr), low: Math.min(lastBar.low, pr), close: pr } : { time: t, open: lastBar.close, high: Math.max(lastBar.close, pr), low: Math.min(lastBar.close, pr), close: pr };
  try { series.update(lastBar); } catch {}
}
function pickFocus() {
  if (focusSel && (S.pos[focusSel] || mk[focusSel])) return focusSel;
  const pe = Object.entries(S.pos);
  // Solana-Positionen zuerst (dort gibt es den 1s-Chart), dann nach Gewinn
  if (pe.length) return pe.map(([k, p]) => [k, valSol(k, p) / p.cost + (p.pool ? 100 : 0)]).sort((a, b) => b[1] - a[1])[0][0];
  const top = Object.values(mk).filter((m) => m.src === "gt" && m.price).sort((a, b) => (b.ch1 || 0) - (a.ch1 || 0))[0];
  return top?.key || null;
}
function localBars(k) {
  const by = {};
  for (const s of ph[k] || []) {
    const t = Math.floor(s.t / 60000) * 60, b = by[t];
    if (!b) by[t] = { time: t, open: s.p, high: s.p, low: s.p, close: s.p };
    else { b.high = Math.max(b.high, s.p); b.low = Math.min(b.low, s.p); b.close = s.p; }
  }
  return Object.values(by);
}
async function loadOhlc(force) {
  const k = focusKey; if (!k || ohlcBusy || $("tv").classList.contains("embed") || (chartMode === "s1" && poolOf(k))) return; // nie mehrere Chart-Abrufe gleichzeitig
  if (k === chartKey && now() - lastOhlc < (force ? 5000 : 20000)) return;
  ohlcBusy = k; lastOhlc = now();
  try { await loadOhlcFor(k); } finally { ohlcBusy = null; chartKey ||= k; }
}
async function loadOhlcFor(k) {
  let bars = [];
  if (k.startsWith("gt:")) {
    try {
      if (now() < src.GeckoTerminal.until) throw new Error("pausiert");
      const d = await getJSON(`${GT}/pools/${k.slice(3)}/ohlcv/minute?aggregate=1&limit=150&currency=usd`);
      bars = (d.data?.attributes?.ohlcv_list || []).map((x) => ({ time: x[0], open: +x[1], high: +x[2], low: +x[3], close: +x[4] }));
    } catch { bars = localBars(k); } // Ersatz: Kerzen aus selbst gesammelten Preisen
  } else {
    let d = [];
    try { d = await getJSON(`${CG}/coins/${k.slice(3)}/ohlc?vs_currency=usd&days=1`); } catch { d = []; }
    bars = d.map((x) => ({ time: Math.floor(x[0] / 1000), open: x[1], high: x[2], low: x[3], close: x[4] }));
  }
  const seen = new Set();
  bars = bars.filter((b) => !seen.has(b.time) && seen.add(b.time)).sort((a, b) => a.time - b.time);
  drawChart(k, bars);
}
function drawChart(k, bars, secs = false) {
  const el = $("tv");
  if (!bars.length) { el.innerHTML = "<div class='mut tiny' style='padding:20px'>Noch keine Chartdaten.</div>"; tv = null; chartKey = k; return; }
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
  tv.applyOptions({ timeScale: { secondsVisible: secs } });
  // Preis-Skala so erweitern, dass Stop-Loss und Take-Profit immer sichtbar sind
  const pp = S.pos[k], lo = pp ? pp.entry * (1 - pp.sl / 100) : 0, hi = pp ? pp.entry * (1 + pp.tp / 100) : 0;
  series.applyOptions({ autoscaleInfoProvider: (orig) => { const r = orig(); if (!r || !pp) return r; return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, lo * 0.99), maxValue: Math.max(r.priceRange.maxValue, hi * 1.01) } }; } });
  series.setData(bars); lastBar = { ...bars[bars.length - 1] };
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

// ---------- Trade-Verlauf (abgeschlossene Trades + Chart mit Kauf/Verkauf) ----------
let histSel = null, histKey = "", histTv = null, histSeries = null;
const dur = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? m + " Min" : Math.floor(m / 60) + " Std " + (m % 60) + " Min"; };
const tStr = (ts) => new Date(ts).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
function renderHistory() {
  const c = S.closed || [], n = c.length, w = c.filter((x) => x.pnl >= 0).length, sum = c.reduce((s, x) => s + x.pnl, 0);
  const key = n + ":" + histSel + ":" + (c[0]?.sellTs || 0), selI = c.findIndex((x) => x.sellTs === histSel);
  $("hcount").textContent = n ? `${n} abgeschlossen` : "";
  if (histKey === key) return; histKey = key;
  $("hist-sum").innerHTML = n ? `<div>Ergebnis<b class="${sum >= 0 ? "up" : "down"}">${ssol(sum)}</b></div><div>Treffer<b>${Math.round((w / n) * 100)}% <span class="mut tiny">${w}/${n}</span></b></div>
    <div>Ø Trade<b class="${sum >= 0 ? "up" : "down"}">${pct(c.reduce((s, x) => s + x.pct, 0) / n)}</b></div><div>Gebühren<b>${sol(S.fees || 0, 3)}</b></div>` : "";
  $("hist").innerHTML = c.map((x, i) => `<div class="hrow${selI === i ? " sel" : ""}" data-i="${i}">
      <div class="row"><b>${x.img ? `<img class="coinimg" src="${esc(x.img)}" alt="">` : '<span class="coinimg" style="display:inline-block"></span>'}${esc(x.sym)}</b><b class="${x.pnl >= 0 ? "up" : "down"}">${ssol(x.pnl)} <span class="tiny">${pct(x.pct)}</span></b></div>
      <div class="row mut tiny"><span>▲ ${tStr(x.buyTs)} · ${fmtP(x.entry)}</span><span>▼ ${fmtP(x.exit)} · ${dur(x.sellTs - x.buyTs)}</span></div>
      <div class="mut tiny">${esc(x.why || "")}${x.approx ? " · (aus altem Log rekonstruiert)" : ""}</div>
      ${selI === i ? `<div id="hist-chart" class="tv"></div><div class="mut tiny" id="hist-info">Chart lädt…</div>` : ""}</div>`).join("")
    || "<div class='mut'>Noch keine abgeschlossenen Trades. Sobald der Bot einen Coin verkauft, erscheint er hier – mit Chart.</div>";
  document.querySelectorAll("#hist .hrow").forEach((d) => (d.onclick = (e) => { if (e.target.closest("#hist-chart")) return; const id = c[+d.dataset.i].sellTs; histSel = histSel === id ? null : id; renderHistory(); }));
  if (selI >= 0) loadHistChart(histSel); // auch nach neuem Trade wieder am richtigen Trade
}
async function loadHistChart(id) {
  const x = (S.closed || []).find((y) => y.sellTs === id); if (!x) return;
  const tz = new Date().getTimezoneOffset() * 60, info = (t) => { const el = $("hist-info"); if (el) el.textContent = t; };
  // Pool/Mint fehlen bei rekonstruierten Trades → über das Symbol in den Marktdaten suchen
  const m = x.k ? mk[x.k] : Object.values(mk).find((y) => y.sym === x.sym && y.pool);
  const pool = x.pool || m?.pool, key = x.k || m?.key || "";
  const from = Math.floor(x.buyTs / 1000), to = Math.floor(x.sellTs / 1000), span = Math.max(1, (to - from) / 60);
  let bars = [], src = "";
  try {
    if (pool) {
      const agg = span <= 240 ? 1 : span <= 1200 ? 5 : 15, pad = Math.max(10, span * 0.25);
      const lim = Math.min(1000, Math.ceil((span + 2 * pad) / agg));
      const d = await getJSON(`${GT}/pools/${pool}/ohlcv/minute?aggregate=${agg}&limit=${lim}&before_timestamp=${Math.floor(to + pad * 60)}&currency=usd`);
      bars = (d.data?.attributes?.ohlcv_list || []).map((b) => ({ time: b[0], open: +b[1], high: +b[2], low: +b[3], close: +b[4] }));
      src = `GeckoTerminal · ${agg}-Min-Kerzen`;
    } else if (key.startsWith("cg:")) {
      const d = await getJSON(`${CG}/coins/${key.slice(3)}/market_chart/range?vs_currency=usd&from=${from - 1800}&to=${to + 1800}`);
      bars = (d.prices || []).map(([t, v]) => ({ time: Math.floor(t / 1000), value: +v }));
      src = "CoinGecko · Linie (5 Min)";
    }
  } catch (e) { src = "Chartdaten gerade nicht erreichbar (" + e.message + ")"; }
  if (!bars.length && key) { bars = localBars(key).filter((b) => b.time >= from - 3600 && b.time <= to + 3600); if (bars.length) src = "gesammelte Preise (1 Min)"; }
  if (histSel !== id || !$("hist-chart")) return;
  if (!bars.length || !window.LightweightCharts) return info(src || "Keine Chartdaten für diesen Trade.");
  const seen = new Set();
  bars = bars.map((b) => ({ ...b, time: b.time - tz })).filter((b) => !seen.has(b.time) && seen.add(b.time)).sort((a, b) => a.time - b.time);
  const el = $("hist-chart"); el.innerHTML = "";
  histTv = LightweightCharts.createChart(el, { autoSize: true, layout: { background: { color: "transparent" }, textColor: "#7d869b", fontSize: 11 },
    grid: { vertLines: { color: "rgba(255,255,255,.04)" }, horzLines: { color: "rgba(255,255,255,.04)" } }, rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6 }, crosshair: { mode: 0 } });
  const last = bars[bars.length - 1], ref = last.close ?? last.value, dec = Math.min(12, Math.max(2, Math.ceil(-Math.log10(ref)) + 3));
  histSeries = "value" in bars[0] ? histTv.addLineSeries({ color: "#9945ff", lineWidth: 2 }) : histTv.addCandlestickSeries({ upColor: "#14f195", downColor: "#ff4d6d", wickUpColor: "#14f195", wickDownColor: "#ff4d6d", borderVisible: false });
  histSeries.applyOptions({ priceFormat: { type: "price", precision: dec, minMove: Math.pow(10, -dec) } });
  histSeries.setData(bars);
  const near = (t) => bars.reduce((a, b) => (Math.abs(b.time - t) < Math.abs(a.time - t) ? b : a)).time;
  const win = x.pnl >= 0;
  histSeries.setMarkers([
    { time: near(from - tz), position: "belowBar", color: "#4da3ff", shape: "arrowUp", text: "KAUF" },
    { time: near(to - tz), position: "aboveBar", color: win ? "#14f195" : "#ff4d6d", shape: "arrowDown", text: `VERKAUF ${pct(x.pct, 0)}` },
  ].sort((a, b) => a.time - b.time));
  histSeries.createPriceLine({ price: x.entry, color: "#4da3ff", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "Kauf" });
  histSeries.createPriceLine({ price: x.exit, color: win ? "#14f195" : "#ff4d6d", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "Verkauf" });
  histTv.timeScale().fitContent();
  info(`${src} · gekauft ${tStr(x.buyTs)}, verkauft ${tStr(x.sellTs)} (${dur(x.sellTs - x.buyTs)}) · ${sol(x.cost)} SOL → ${sol(x.got)} SOL${x.peak ? ` · Hoch ${pct(x.peak)}` : ""}`);
}

// ---------- Bubble-Map (wie Bubblemaps: Cluster-Ringe um die gemeinsame Funding-Quelle) ----------
const CL_COL = ["#ff4d6d", "#ffa23e", "#ffd43b", "#14f195", "#4dd4ff", "#e64dff", "#ff8fab", "#a3e635"];
const short = (a) => (a && a.length > 10 ? a.slice(0, 4) + "…" + a.slice(-4) : a || "?");
let bubbleNodes = [];
function bubbleMsg(svg, txt) { svg.classList.add("empty"); svg.setAttribute("viewBox", "0 0 400 90"); svg.setAttribute("preserveAspectRatio", "xMidYMid meet"); svg.innerHTML = `<text x="200" y="50" text-anchor="middle" fill="#7d869b" font-size="12">${esc(txt)}</text>`; svg.dataset.k = ""; $("bubble-info").textContent = ""; $("clusters").innerHTML = ""; }
function bubbles(rc, mint) {
  const svg = $("bubbles");
  if (!rc || !rc.holders?.length) return bubbleMsg(svg, rc?.pending ? "Holder werden geladen…" : rc?.fail ? "RugCheck nicht erreichbar – keine Holder-Daten" : "Keine Holder-Daten (nur bei neuen Solana-Coins)");
  const key = mint + ":" + rc.t + ":" + CFG.risk;
  if (svg.dataset.k === key) return; // Layout nur neu rechnen, wenn sich die Daten ändern
  svg.dataset.k = key; svg.classList.remove("empty");
  // Knoten: Cluster-Wallets (aus dem Insider-Graph) + lose Top-Holder
  const nodes = [], byId = {}, links = [];
  const add = (n) => { if (byId[n.id]) return byId[n.id]; byId[n.id] = n; nodes.push(n); return n; };
  const hold = {}; rc.holders.forEach((h) => (hold[h.addr] = h));
  const shown = rc.clusters.filter((c) => c.members.length).slice(0, CL_COL.length);
  shown.forEach((c, ci) => {
    const keep = new Set([...c.members].sort((a, b) => b.pct - a.pct).slice(0, 45).map((m) => m.id));
    if (c.hub) keep.add(c.hub);
    for (const m of c.members) if (keep.has(m.id)) add({ id: m.id, pct: m.pct, cl: ci, hub: m.id === c.hub, h: hold[m.id] });
    if (c.hub && !byId[c.hub]) add({ id: c.hub, pct: 0, cl: ci, hub: true });
    for (const l of c.links) if (keep.has(l.source) && keep.has(l.target) && byId[l.source]?.cl === ci && byId[l.target]?.cl === ci) links.push({ source: l.source, target: l.target, cl: ci });
  });
  for (const h of rc.holders.slice(0, 30)) { const n = byId[h.addr]; if (n) { n.h = h; n.pct = Math.max(n.pct, h.pct); } else add({ id: h.addr, pct: h.pct, cl: null, h }); }
  nodes.forEach((n) => (n.r = n.hub && n.pct < 0.05 ? 4.5 : Math.max(n.cl != null ? 3 : 4, Math.sqrt(n.pct) * 9)));
  const col = (n) => (n.h?.lp ? "#4da3ff" : n.h?.eq ? "#ff2a55" : n.cl != null ? CL_COL[n.cl] : n.h?.dev ? "#ffa23e" : n.h?.insider ? "#ff4d6d" : "#9945ff");
  // Layout
  if (window.d3?.forceSimulation) {
    const sizeOf = shown.map((c) => Math.min(c.members.length, 45));
    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d) => d.id).distance((l) => 14 + Math.sqrt(sizeOf[l.cl] || 1) * 6).strength(0.8))
      .force("charge", d3.forceManyBody().strength((d) => (d.cl != null ? -14 : -40)))
      .force("collide", d3.forceCollide((d) => d.r + 1.5).iterations(2))
      .force("x", d3.forceX(0).strength(0.05)).force("y", d3.forceY(0).strength(0.08)).stop();
    for (let i = 0; i < 320; i++) sim.tick();
  } else { // Ersatz ohne d3: Spirale
    let i = 0;
    for (const n of [...nodes].sort((a, b) => b.r - a.r)) {
      for (; i < 4000; i++) { const a = i * 0.35, d = i * 0.5, x = Math.cos(a) * d, y = Math.sin(a) * d; if (nodes.every((o) => o === n || o.x == null || Math.hypot(o.x - x, o.y - y) > o.r + n.r + 2)) { n.x = x; n.y = y; break; } }
    }
  }
  const x0 = Math.min(...nodes.map((n) => n.x - n.r)) - 8, x1 = Math.max(...nodes.map((n) => n.x + n.r)) + 8;
  const y0 = Math.min(...nodes.map((n) => n.y - n.r)) - 8, y1 = Math.max(...nodes.map((n) => n.y + n.r)) + 8;
  svg.setAttribute("viewBox", `${x0.toFixed(1)} ${y0.toFixed(1)} ${(x1 - x0).toFixed(1)} ${(y1 - y0).toFixed(1)}`);
  const sc = (x1 - x0) / 400; // Linien/Schrift mit dem Zoom skalieren
  const defs = CL_COL.map((c, i) => `<marker id="ar${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" fill="${c}"/></marker>`).join("");
  const lines = links.map((l) => {
    const a = l.source, b = l.target, d = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
    return `<line x1="${(a.x + ux * a.r).toFixed(1)}" y1="${(a.y + uy * a.r).toFixed(1)}" x2="${(b.x - ux * (b.r + 1)).toFixed(1)}" y2="${(b.y - uy * (b.r + 1)).toFixed(1)}" stroke="${CL_COL[l.cl]}" stroke-opacity=".55" stroke-width="${(0.9 * sc).toFixed(2)}" marker-end="url(#ar${l.cl})"/>`;
  }).join("");
  bubbleNodes = nodes;
  svg.innerHTML = `<defs>${defs}</defs>${lines}` + nodes.map((n, i) => `<g data-i="${i}" style="cursor:pointer"><title>${esc(short(n.id))} · ${n.pct.toFixed(2)}%${n.hub ? " · Funding-Quelle" : ""}</title>
    <circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}" fill="${col(n)}" fill-opacity="${n.hub ? 0.9 : 0.3}" stroke="${n.hub ? "#eef1f7" : col(n)}" stroke-width="${((n.hub ? 1.6 : 1.2) * sc).toFixed(2)}"/>
    ${n.r > 13 * sc ? `<text x="${n.x.toFixed(1)}" y="${(n.y + n.r * 0.3).toFixed(1)}" text-anchor="middle" fill="#eef1f7" font-size="${Math.min(13 * sc, n.r / 2.2).toFixed(1)}" font-weight="600" pointer-events="none">${n.pct.toFixed(1)}%</text>` : ""}</g>`).join("");
  $("bubble-info").textContent = shown.length ? "Tippe eine Bubble an. Pfeile = Token-Überweisungen von der Quelle an die Wallets." : rc.clusters.length ? "Cluster laut RugCheck – Graph-Details nicht verfügbar." : "Keine Cluster erkannt – nur lose Holder.";
  $("clusters").innerHTML = rc.clusters.slice(0, 6).map((c, i) => `<div class="row"><span><i class="dot" style="background:${i < shown.length ? CL_COL[i] : "#7d869b"}"></i>${c.type === "trade" ? "Handels-Netzwerk" : c.type === "funding" ? "Funding-Cluster" : "Cluster"} · ${c.size} Wallets${c.hub ? ` · Quelle ${esc(short(c.hub))}` : ""}</span><b class="${c.pct >= P().clMax ? "down" : c.pct >= P().clMax / 2 ? "warn-t" : "mut"}">${c.pct.toFixed(1)}%</b></div>`).join("")
    + (rc.notes || []).map((t) => `<div class="mut tiny">ℹ️ ${esc(t)}</div>`).join("");
}
$("bubbles").onclick = (e) => {
  const g = e.target.closest("g[data-i]"); if (!g) return;
  const n = bubbleNodes[+g.dataset.i]; if (!n) return;
  const role = n.h?.lp ? "Pool/LP" : n.h?.eq ? "Bundle-Wallet (gleich groß wie andere)" : n.hub ? `Funding-Quelle von Cluster ${n.cl + 1}` : n.cl != null ? `Cluster ${n.cl + 1}` : n.h?.dev ? "Dev" : n.h?.insider ? "Insider" : "Holder";
  $("bubble-info").innerHTML = `<b>${esc(short(n.id))}</b> · ${role} · ${n.pct.toFixed(2)}% · <a href="https://solscan.io/account/${esc(n.id)}" target="_blank" rel="noopener">Solscan</a>`;
};

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
  $("usd").textContent = solUsd ? `≈ ${solCur === "EUR" ? eur(v * solPrice("EUR")) : usd(v * solUsd)} · 1 SOL = ${money(solPrice())}` : "SOL-Preis lädt…";
  renderSol();
  $("delta").textContent = `${ssol(pnl)} (${pct((v / START - 1) * 100)})`; $("delta").className = pnl >= 0 ? "up" : "down";
  $("mult").textContent = (v / START).toFixed(2) + "×";
  $("trades").textContent = S.trades; $("wl").textContent = `${S.wins}W ${S.losses}L`;
  $("clock").textContent = `${Math.floor(el / 60)}h ${el % 60}m aktiv`;
  const e = Object.entries(errs);
  const st = Object.entries(src).map(([k, s]) => `${SRC_TAG[k]} ${s.ok === null ? "…" : s.ok ? "✓" : "✗"}`).join(" ");
  const solDown = src.GeckoTerminal.ok === false && src.DexScreener.ok === false;
  $("sub").textContent = (solDown ? "⚠ Solana-Daten gerade nicht erreichbar – neuer Versuch folgt · " : e.length ? "⚠ " + e.map(([k, m]) => `${k}: ${m}`).join(" · ") + " · " : "")
    + `${nCg + nGt} Coins · ${nNew} neu · ${st}`;
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
    const fpool = fp?.pool || fm?.pool;
    document.querySelectorAll("#chart-mode button").forEach((b) => { b.classList.toggle("on", b.dataset.m === (fpool ? chartMode : "bot")); b.disabled = !fpool && b.dataset.m !== "bot"; });
    $("live-info").textContent = !fk.startsWith("gt:") && !fpool ? "Etablierter Coin: nur 1-Min-Chart (Live 1s gibt es bei Solana-Coins)"
      : chartMode === "s1" && tradesErr ? "GeckoTerminal-Trades gerade nicht erreichbar – Ersatz: 1-Min-Kerzen aus gesammelten Preisen · Einstieg/Ziel/Stop eingezeichnet"
      : chartMode === "s1" ? `⚡ 1-Sekunden-Kerzen aus den echten Trades (GeckoTerminal, alle 6 s) · Einstieg/Ziel/Stop eingezeichnet${tradesAt ? ` · aktualisiert vor ${Math.max(0, Math.round((now() - tradesAt) / 1000))} s` : ""}`
      : chartMode === "ds" ? "DexScreener-Chart mit 1-Sekunden-Kerzen, live (Einstieg/Ziel/Stop nur in „⚡ 1 s“)"
      : `1-Min-Kerzen · Preis alle ${JUP_MS / 1000} s über Jupiter${mk[fk]?.live ? ` · zuletzt vor ${Math.max(0, Math.round((now() - mk[fk].live) / 1000))} s` : ""}`;
    if (fpool && chartMode === "ds") showEmbed(fpool);
    else { if ($("tv").classList.contains("embed")) { $("tv").classList.remove("embed"); $("tv").innerHTML = ""; embedKey = ""; tv = null; chartKey = null; } if (fk !== chartKey && !ohlcBusy && !tradesBusy) safe("Chart", () => (chartMode === "s1" && fpool ? loadTrades(fk) : loadOhlc(true))); }
    // Rug-Panel für den Fokus-Coin
    if (mint && !rug[mint]) requestRug(mint, pool);
    else if (mint && CFG.rug && rug[mint] && !rug[mint].pending && !rug[mint].fail && !fund[mint]) requestFunding(mint);
    renderRug(mint, sym);
  } else {
    $("focus-info").innerHTML = "<div class='mut'>Warte auf Marktdaten…</div>"; renderRug(null);
  }

  // Agenten
  $("agents").innerHTML = [
    ["scanner", "SCANNER", `Fokus Solana · ${nGt} Solana-Pools (${nNew} neu) · ${nCg} etablierte`],
    ["safety", "SAFETY", `Liq ≥ $${big(R.minLiq)} · Pool ≥ 3 Min · Kaufdruck · Bot-Volumen`],
    ["rug", "RUG-CHECK", CFG.rug ? `Mint/Freeze · LP · Top-10 · Cluster ≤ ${R.clMax}% · Funding-Quelle · frische & gleich große Wallets · max ${R.maxRug}/100` : "aus – nur Basis-Checks"],
    ["analyst", "ANALYST", `Momentum 5m/1h · Score ≥ ${R.minScore}`],
    ["risk", "RISK", `${R.size * 100}% pro Trade · Stop −${R.sl}% · Trailing ${R.trail}%`],
    ["executor", "EXECUTOR", `${pe.length}/${R.maxPos} Positionen · Gebühren ${sol(S.fees || 0, 3)} SOL`],
  ].map((a) => `<div class="row"><span class="tag a-${a[0]}">${a[1]}</span><span class="txt">${esc(a[2])}</span></div>`).join("");

  // Live-Trades
  $("tcount").textContent = S.tr.length + " Trades";
  $("trades-live").innerHTML = S.tr.slice(0, 14).map((x, i) => `<div class="row trade${i === 0 && now() - x.ts < 8000 ? " new" : ""}"><span class="mut tiny">${new Date(x.ts).toLocaleTimeString("de-DE")}</span><span class="${x.side === "BUY" ? "buy" : "sell"}">${x.side}</span><span class="txt">${x.img ? `<img class="coinimg" src="${esc(x.img)}" alt="">` : ""}<b>${esc(x.sym)}</b> ${sol(x.amt)} SOL${x.pnl == null ? "" : ` · <b class="${x.pnl >= 0 ? "up" : "down"}">${ssol(x.pnl)}</b>`}<br><span class="mut tiny">${esc(x.why || "")}</span></span></div>`).join("") || "<div class='mut'>Noch keine Trades – der Bot sucht Einstiege…</div>";

  renderHistory();

  // Entscheidungen
  const cls = { BUY: "buy", SELL: "sell", RUG: "down", CHECK: "a-rug" };
  $("log").innerHTML = S.log.slice(0, 10).map((l) => `<div class="row"><span class="mut tiny">${l.t}</span><span class="${cls[l.type] || "skip"}" style="width:46px;font-size:12px">${l.type}</span><span class="txt">${esc(l.sym)} · ${esc(l.text)}${l.n > 1 ? ` <span class="mut tiny">×${l.n}</span>` : ""}</span></div>`).join("") || "<div class='mut'>Warte auf Marktdaten…</div>";

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
  $("rinfo").textContent = `${R.size * 100}% pro Trade · Ziel +${R.tp}% · Stop −${R.sl}% · Trailing ab +${R.trailOn}% (−${R.trail}%) · max ${R.maxPos} Coins (davon max ${R.maxCg} etablierte) · Zeit-Exit ${R.timeMin} Min · Rug-Score ≤ ${R.maxRug}`;
  equityChart();
}

function renderRug(mint, sym) {
  const rc = mint ? rug[mint] : null;
  const links = $("rug-links"), v = $("rug-verdict");
  links.innerHTML = mint ? `<a href="https://rugcheck.xyz/tokens/${esc(mint)}" target="_blank" rel="noopener">🛡️ RugCheck</a><a href="https://app.bubblemaps.io/sol/token/${esc(mint)}" target="_blank" rel="noopener">🫧 Bubblemaps</a><a href="https://solscan.io/token/${esc(mint)}" target="_blank" rel="noopener">🔍 Solscan</a>` : "";
  if (!mint) { v.innerHTML = ""; $("rug").innerHTML = "<div class='mut tiny'>Rug-Check gibt es nur für Solana-Coins. Etablierte Coins (z. B. DOGE) werden nicht geprüft.</div>"; bubbles(null); return; }
  if (!rc || rc.pending) { v.innerHTML = '<span class="chip warn">PRÜFE…</span>'; $("rug").innerHTML = `<div class='mut tiny'>${esc(sym)} wird geprüft…</div>`; bubbles(rc || { pending: true }, mint); return; }
  if (rc.fail) { v.innerHTML = '<span class="chip warn">N/A</span>'; $("rug").innerHTML = "<div class='mut tiny'>RugCheck nicht erreichbar. Der Bot kauft dann nur Pools, die älter als 60 Min sind und ≥ $50K Liquidität haben.</div>"; bubbles(rc, mint); return; }
  const ok = !rc.reject && rc.score <= P().maxRug;
  v.innerHTML = `<span class="chip ${ok ? (rc.score <= 20 ? "ok" : "warn") : "bad"}">${ok ? "BESTANDEN" : "BLOCKIERT"} · ${rc.score}/100</span>`;
  const c = (good, txt) => `<span class="${good ? "up" : "down"}">${txt}</span>`;
  $("rug").innerHTML = `<div class="mut tiny" style="margin-bottom:4px">${esc(sym)} · Risiko-Score ${rc.score}/100 (0 = sicher)${rc.rc != null ? ` · RugCheck ${rc.rc}` : ""}</div>
    <div class="checks">
      <div><span class="mut">Mint</span>${c(!rc.reasons.some((x) => x.startsWith("Mint")), rc.reasons.some((x) => x.startsWith("Mint")) ? "aktiv ✗" : "gesperrt ✓")}</div>
      <div><span class="mut">Freeze</span>${c(!rc.reasons.some((x) => x.startsWith("Freeze")), rc.reasons.some((x) => x.startsWith("Freeze")) ? "aktiv ✗" : "gesperrt ✓")}</div>
      <div><span class="mut">LP gesperrt</span>${rc.clmm ? `<span class="mut">n/a (${esc(rc.lpType)})</span>` : c(rc.lp >= 80, rc.lp.toFixed(0) + "%")}</div>
      <div><span class="mut">Top-10</span>${c(rc.top10 <= 25, rc.top10.toFixed(1) + "%")}</div>
      <div><span class="mut">Größter Holder</span>${c(rc.top1 <= 8, rc.top1.toFixed(1) + "%")}</div>
      <div><span class="mut">Insider</span>${c(rc.ins <= 8, rc.ins.toFixed(1) + "%")}</div>
      <div><span class="mut">Größter Cluster</span>${c(rc.clTop < P().clMax / 2, rc.clusters.length ? `${rc.clTop.toFixed(1)}% (${rc.clusters[0].size} W.)` : "keiner")}</div>
      <div><span class="mut">Bundle/Sniper</span>${c(!rc.bundle, rc.bundle ? `${rc.bundle.fan} Wallets ✗` : "nein ✓")}</div>
      <div><span class="mut">Gleich große Wallets</span>${c(!rc.equal, rc.equal ? `${rc.equal.n} × ${rc.equal.each.toFixed(1)}% ✗` : "nein ✓")}</div>
      <div><span class="mut">Funding-Check</span>${!rc.fund ? `<span class="mut">${fund[mint]?.pending ? "läuft…" : "–"}</span>` : rc.fund.fail ? `<span class="warn-t">n/a</span>` : c(!(rc.fundTop?.ws.length >= 3), rc.fundTop ? `${rc.fundTop.ws.length} gleiche Quelle` : `${rc.fund.checked} geprüft ✓`)}</div>
      <div><span class="mut">Frische Wallets</span>${rc.fund && !rc.fund.fail ? c(rc.fund.fresh.n < 3, `${rc.fund.fresh.n} (${rc.fund.fresh.pct.toFixed(1)}%)`) : '<span class="mut">–</span>'}</div>
    </div>
    ${rc.reasons.length ? `<div class="tiny down">⚠ ${rc.reasons.map(esc).join(" · ")}</div>` : `<div class="tiny up">✓ ${rc.ok.map(esc).join(" · ")}</div>`}`;
  bubbles(rc, mint);
}

// ---------- Benachrichtigungen ----------
// 1) Immer: Hinweis-Karte oben in der Seite. 2) Wenn erlaubt: Mitteilung des Systems (iPad/iPhone nur als Home-Bildschirm-App, ab iOS 16.4).
// Der Bot läuft nur, solange die Seite offen ist – im Hintergrund pausiert iOS die Seite, dann kommen auch keine Mitteilungen.
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
let swReg = null;
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then((r) => (swReg = r)).catch(() => {});
function toast(title, body, img) {
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `${img ? `<img src="${esc(img)}" alt="">` : ""}<div><b>${esc(title)}</b><div class="tiny">${esc(body)}</div></div>`;
  t.onclick = () => t.remove();
  $("toasts").appendChild(t);
  setTimeout(() => t.classList.add("out"), 6000); setTimeout(() => t.remove(), 6600);
}
function notify(title, body, img) {
  toast(title, body, img);
  if (!CFG.notify || !("Notification" in window) || Notification.permission !== "granted") return;
  const opt = { body, icon: "icon-192.png", badge: "icon-192.png", tag: "claudebot-" + now(), silent: false };
  if (swReg?.showNotification) swReg.showNotification(title, opt).catch(() => {});
  else try { new Notification(title, opt); } catch {}
}
function notifyInfo() {
  const el = $("n-info"); if (!el) return;
  const can = "Notification" in window, perm = can ? Notification.permission : "nicht verfügbar";
  $("n-btn").textContent = CFG.notify && perm === "granted" ? "🔔 Mitteilungen an – ausschalten" : "🔔 Mitteilungen bei Käufen einschalten";
  el.textContent = !can ? (isIOS && !standalone() ? "Auf iPad/iPhone: unten/oben auf Teilen (□↑) → „Zum Home-Bildschirm“, dann die Seite über das neue Symbol öffnen und hier einschalten. Bis dahin gibt es die Hinweise nur in der Seite." : "Dieser Browser unterstützt keine Mitteilungen – Hinweise kommen nur in der Seite.")
    : perm === "denied" ? "Mitteilungen sind blockiert – in den Einstellungen des Geräts für diese App/Seite erlauben."
    : CFG.notify && perm === "granted" ? "Mitteilungen aktiv. Hinweis: nur solange die App/Seite geöffnet ist." : "Hinweise in der Seite kommen immer.";
}
$("n-btn").onclick = async () => {
  if (CFG.notify && "Notification" in window && Notification.permission === "granted") { CFG.notify = false; save(); return notifyInfo(); }
  if (!("Notification" in window)) return notifyInfo();
  const r = await Notification.requestPermission(); // muss direkt nach dem Antippen passieren
  CFG.notify = r === "granted"; save(); notifyInfo();
  if (CFG.notify) notify("🔔 Mitteilungen aktiv", "Du bekommst jetzt bei jedem Kauf eine Mitteilung.");
};
$("c-sell").onchange = (e) => { CFG.notifySell = e.target.checked; save(); };
$("c-sell").checked = !!CFG.notifySell;
notifyInfo();

// ---------- Bedienung ----------
// Neu laden: In der Home-Bildschirm-App gibt es keinen Reload-Knopf. Erst alle Dateien am Browser-Cache vorbei neu holen
// (GitHub Pages lässt sie sonst bis zu 10 Min im Cache), dann die Seite neu laden. Depot & Einstellungen bleiben erhalten.
$("reload").onclick = async () => {
  const b = $("reload"); b.classList.add("spin"); b.disabled = true; save();
  const files = ["bot.html", "src/bot.js", "src/bot.css", "src/gate.js", "src/gate-config.js", "src/vendor/d3-force.js", "src/vendor/lightweight-charts.js", "sw.js", "manifest.webmanifest"];
  await Promise.race([Promise.all(files.map((f) => fetch(f, { cache: "reload" }).catch(() => {}))), sleep(8000)]);
  try { await swReg?.update(); } catch {}
  location.reload();
};
$("toggle").onclick = () => { paused = !paused; $("toggle").textContent = paused ? "▶ Weiter" : "⏸ Pause"; render(); };
$("reset").onclick = () => {
  const b = $("reset");
  if (b.dataset.armed) { S = fresh(); focusSel = null; save(); delete b.dataset.armed; b.textContent = "Zurücksetzen"; render(); }
  else { b.dataset.armed = 1; b.textContent = "Sicher? Nochmal tippen"; setTimeout(() => { delete b.dataset.armed; b.textContent = "Zurücksetzen"; }, 4000); }
};
document.querySelectorAll("#risk button").forEach((b) => (b.onclick = () => { CFG.risk = b.dataset.r; reanalyse(); save(); render(); }));
$("c-neu").onchange = (e) => { CFG.neu = e.target.checked; save(); render(); };
$("c-et").onchange = (e) => { CFG.etabliert = e.target.checked; save(); render(); };
$("c-rug").onchange = (e) => { CFG.rug = e.target.checked; save(); render(); };

document.querySelectorAll("#sol-range button").forEach((b) => (b.onclick = () => { solDays = +b.dataset.d; renderSol(); solChart(false); }));
$("cv-sol").oninput = () => renderSol();
$("cv-fiat").oninput = () => renderSol();
$("cv-cur").onchange = (e) => { solCur = e.target.value; try { localStorage.setItem("claudebot-cur", JSON.stringify(solCur)); } catch {} render(); solChart(false); };

document.querySelectorAll("#chart-mode button").forEach((b) => (b.onclick = () => setChartMode(b.dataset.m)));

render();
safe("SOL-Preis", loadSol).then(() => solChart(true));
Promise.all([ safe("CoinGecko", loadCG), guarded("DexScreener", loadDS), guarded("GeckoTerminal", loadGT)]).then(tick);
setInterval(() => safe("SOL-Preis", loadSol), 60000);
setInterval(() => solChart(false), 60000);
setInterval(() => safe("CoinGecko", loadCG), 60000);
setInterval(() => guarded("GeckoTerminal", loadGT), 45000);
setInterval(() => guarded("DexScreener", loadDS), 30000);
setInterval(() => safe("Positionen", loadHeld), 15000);
setInterval(() => safe("Chart", () => loadOhlc(false)), 20000);
setInterval(tick, TICK_MS);
setInterval(() => guarded("Jupiter", loadLive), JUP_MS);
setInterval(() => { if (chartMode === "s1" && focusKey && poolOf(focusKey) && !$("tv").classList.contains("embed")) safe("Chart", () => loadTrades(focusKey)); }, 6000);
