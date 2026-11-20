// ==UserScript==
// @name         Axiom Paper Trading (Claude Bot)
// @namespace    https://jli39-rs.github.io/Meme-coin-zentrale-ffentlich-/
// @version      1.0.0
// @description  Virtuelles Paper Trading direkt auf axiom.trade – kein Wallet, keine echten Trades, nur Simulation.
// @match        https://axiom.trade/*
// @match        https://*.axiom.trade/*
// @grant        GM.xmlHttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @connect      lite-api.jup.ag
// @connect      api.dexscreener.com
// @run-at       document-idle
// @noframes
// @downloadURL  https://jli39-rs.github.io/Meme-coin-zentrale-ffentlich-/axiom/axiom-paper.user.js
// @updateURL    https://jli39-rs.github.io/Meme-coin-zentrale-ffentlich-/axiom/axiom-paper.user.js
// ==/UserScript==

// WICHTIG: Dieses Skript handelt NIE echt. Es liest keine Wallets, signiert nichts und klickt keine Knöpfe von Axiom.
// Es erkennt nur, welchen Coin du gerade ansiehst (Adresse im Link), holt den Preis selbst (Jupiter/DexScreener)
// und führt ein virtuelles Depot in deinem Browser-Speicher.
(function () {
  "use strict";
  if (window.top !== window.self || window.__axPaper) return;
  window.__axPaper = true;

  // ---------- Einstellungen ----------
  const START = 5;                 // virtuelles Startkapital in SOL
  const FEE = 0.01;                // simulierte DEX-Gebühr + Slippage je Seite (1 %)
  const NET_FEE = 0.0005;          // simulierte Netzwerk-/Priority-Gebühr je Trade in SOL
  const PRICE_MS = 2000;           // Preis-Abfrage (Jupiter) alle 2 s
  const WSOL = "So11111111111111111111111111111111111111112";
  const KEY = "axpaper-v1";

  // ---------- Helfer ----------
  const now = () => Date.now();
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sol = (n, d = 3) => (n ?? 0).toFixed(d);
  const ssol = (n, d = 3) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(d);
  const pct = (n, d = 1) => (n >= 0 ? "+" : "") + (n ?? 0).toFixed(d) + "%";
  const fmtP = (n) => !n ? "–" : "$" + (n >= 1 ? n.toFixed(4) : n >= 0.0001 ? n.toPrecision(4) : n.toExponential(3));
  const big = (n) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
  const B58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

  // GM-Funktionen (Userscripts-App, Tampermonkey, Violentmonkey) mit Ersatz für Tests/ohne Manager
  const GM_ = typeof GM !== "undefined" ? GM : {};
  const store = {
    get: async (k, d) => { try { if (GM_.getValue) { const v = await GM_.getValue(k); return v == null ? d : JSON.parse(v); } } catch {} try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: async (k, v) => { const s = JSON.stringify(v); try { if (GM_.setValue) return await GM_.setValue(k, s); } catch {} try { localStorage.setItem(k, s); } catch {} },
  };
  // Anfragen über den Userscript-Manager (umgeht CSP/CORS der Axiom-Seite), sonst normales fetch
  function getJSON(url) {
    if (GM_.xmlHttpRequest) {
      return new Promise((res, rej) => GM_.xmlHttpRequest({ method: "GET", url, timeout: 10000,
        onload: (r) => { if (r.status !== 200) return rej(new Error("HTTP " + r.status)); try { res(JSON.parse(r.responseText)); } catch (e) { rej(e); } },
        onerror: () => rej(new Error("Netzwerk")), ontimeout: () => rej(new Error("Timeout")) }));
    }
    return fetch(url).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }

  // ---------- Zustand ----------
  const fresh = () => ({ cash: START, pos: {}, closed: [], fees: 0, since: now(), size: 0.5 });
  let S = fresh(), solUsd = 0, cur = null, lastUrl = "", open = true, err = "";
  const tok = {};   // mint -> { sym, name, img, price, liq, mcap, pair, t }
  const save = () => store.set(KEY, S);

  // ---------- Coin auf der Seite erkennen ----------
  // Axiom-Links enthalten die Pool- oder Token-Adresse (z. B. /meme/<adresse>). Jede Adresse wird über DexScreener aufgelöst.
  const resolved = {}; // adresse -> mint | null
  async function resolve(addr) {
    if (addr in resolved) return resolved[addr];
    resolved[addr] = null;
    try {
      const p = await getJSON(`https://api.dexscreener.com/latest/dex/pairs/solana/${addr}`);
      const pair = (p.pairs || [])[0] || p.pair;
      if (pair?.baseToken?.address) { meta(pair); return (resolved[addr] = pair.baseToken.address === WSOL ? pair.quoteToken.address : pair.baseToken.address); }
    } catch {}
    try {
      const t = await getJSON(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
      const pairs = (t.pairs || []).filter((x) => x.chainId === "solana" && x.baseToken?.address === addr);
      if (pairs.length) { meta(pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0]); return (resolved[addr] = addr); }
    } catch {}
    return null;
  }
  function meta(pair) {
    const m = pair.baseToken.address;
    tok[m] = { ...tok[m], sym: pair.baseToken.symbol, name: pair.baseToken.name, img: pair.info?.imageUrl || "", liq: pair.liquidity?.usd || 0,
      mcap: pair.marketCap || pair.fdv || 0, pair: pair.pairAddress, price: tok[m]?.price || +pair.priceUsd || 0, dex: pair.dexId };
  }
  async function detect(force) {
    const url = location.href;
    if (!force && url === lastUrl) return;
    lastUrl = url;
    const cands = [...new Set((location.pathname + " " + location.search).match(B58) || [])];
    for (const a of cands) { const m = await resolve(a); if (m) { setCoin(m); return; } }
    if (cands.length) err = "Coin aus dem Link nicht gefunden – Adresse unten einfügen";
    render();
  }
  function setCoin(m) { cur = m; err = ""; render(); refresh(); }

  // ---------- Preise ----------
  let busy = false;
  async function refresh() {
    if (busy) return; busy = true;
    try {
      const ids = [...new Set([WSOL, cur, ...Object.keys(S.pos)].filter(Boolean))].slice(0, 50);
      const d = await getJSON(`https://lite-api.jup.ag/price/v3?ids=${ids.join(",")}`);
      if (d[WSOL]?.usdPrice) solUsd = +d[WSOL].usdPrice;
      for (const id of ids) if (id !== WSOL && d[id]?.usdPrice) { tok[id] = { ...tok[id], price: +d[id].usdPrice, t: now() }; if (d[id].liquidity) tok[id].liq = d[id].liquidity; }
      err = err.startsWith("Preis") ? "" : err;
      checkExits();
    } catch (e) { err = "Preis gerade nicht erreichbar (" + e.message + ")"; }
    busy = false; render();
  }

  // ---------- Paper-Trading ----------
  const valSol = (m, p) => (solUsd && tok[m]?.price ? (p.qty * tok[m].price * (1 - FEE)) / solUsd : p.cost);
  const equity = () => S.cash + Object.entries(S.pos).reduce((s, [m, p]) => s + valSol(m, p), 0);
  function buy(m, amt) {
    const t = tok[m];
    if (!t?.price || !solUsd) return toast("Noch kein Preis – kurz warten");
    amt = Math.min(amt, S.cash - NET_FEE);
    if (amt < 0.01) return toast("Nicht genug virtuelles SOL");
    const qty = (amt * solUsd * (1 - FEE)) / t.price;
    const p = S.pos[m];
    S.cash -= amt + NET_FEE; S.fees += NET_FEE + amt * FEE;
    if (p) { const q = p.qty + qty; p.entry = (p.entry * p.qty + t.price * qty) / q; p.qty = q; p.cost += amt + NET_FEE; }
    else S.pos[m] = { sym: t.sym, name: t.name, img: t.img, qty, cost: amt + NET_FEE, entry: t.price, ts: now(), tp: S.tp || null, sl: S.sl || null };
    save(); toast(`🟢 Paper-Kauf ${t.sym}: ${sol(amt)} SOL zu ${fmtP(t.price)}`); render();
  }
  function sell(m, frac, why = "manuell") {
    const p = S.pos[m]; if (!p) return;
    frac = Math.min(1, Math.max(0, frac));
    const part = { ...p, qty: p.qty * frac, cost: p.cost * frac };
    const got = valSol(m, part) - NET_FEE, pnl = got - part.cost;
    S.cash += got; S.fees += NET_FEE + part.qty * (tok[m]?.price || p.entry) * FEE / (solUsd || 1);
    S.closed.unshift({ m, sym: p.sym, img: p.img, entry: p.entry, exit: tok[m]?.price || p.entry, buyTs: p.ts, sellTs: now(), cost: part.cost, got, pnl, pct: (pnl / part.cost) * 100, frac, why });
    S.closed = S.closed.slice(0, 200);
    if (frac >= 0.999) delete S.pos[m]; else { p.qty -= part.qty; p.cost -= part.cost; }
    save(); toast(`${pnl >= 0 ? "💰" : "🔻"} Paper-Verkauf ${p.sym} ${frac < 1 ? Math.round(frac * 100) + " % " : ""}${ssol(pnl)} SOL · ${why}`); render();
  }
  function checkExits() {
    for (const [m, p] of Object.entries(S.pos)) {
      const t = tok[m]; if (!t?.price) continue;
      const ch = (t.price / p.entry - 1) * 100;
      if (p.tp && ch >= p.tp) sell(m, 1, `Take-Profit ${pct(ch)}`);
      else if (p.sl && ch <= -p.sl) sell(m, 1, `Stop-Loss ${pct(ch)}`);
    }
  }

  // ---------- Oberfläche (Shadow DOM: Axioms CSS bleibt unberührt) ----------
  const host = document.createElement("div");
  host.id = "axpaper-host";
  host.style.cssText = "position:fixed;z-index:2147483646;right:12px;bottom:12px;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif}
    .w{width:min(340px,92vw);max-height:min(78vh,640px);overflow:auto;-webkit-overflow-scrolling:touch;background:#12151d;color:#eef1f7;border:1px solid #2a3142;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.6);font-size:13px}
    .hd{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #222838;position:sticky;top:0;background:#12151d;cursor:move;touch-action:none}
    .hd b{font-size:14px}.tag{font-size:10px;font-weight:800;background:#ffc542;color:#000;border-radius:5px;padding:1px 5px;margin-left:6px}
    .sec{padding:10px 12px;border-bottom:1px solid #1d2230}.mut{color:#7d869b}.t{font-size:11px}.up{color:#14f195}.dn{color:#ff4d6d}
    .row{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:3px 0}
    .big{font-size:20px;font-weight:800}
    button{border:0;border-radius:10px;padding:9px 6px;font-weight:700;font-size:13px;cursor:pointer;color:#fff;flex:1;font-family:inherit}
    .b{background:#14a86b}.s{background:#d13a57}.g{background:#232938;border:1px solid #2f3647}.x{flex:none;background:none;color:#7d869b;font-size:16px;padding:2px 6px}
    .btns{display:flex;gap:6px;margin-top:6px}
    input{width:100%;background:#0b0d12;border:1px solid #2a3142;color:#eef1f7;border-radius:9px;padding:8px;font-size:16px}
    .pos{padding:7px 0;border-top:1px solid #1d2230}.pos:first-child{border-top:0}
    img{width:18px;height:18px;border-radius:50%;vertical-align:-4px;margin-right:5px}
    .fab{width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#9945ff,#14f195);color:#0b0d12;font-weight:800;font-size:12px;display:grid;place-items:center;box-shadow:0 8px 24px rgba(0,0,0,.5);cursor:pointer;line-height:1.1;text-align:center}
    .toast{position:fixed;left:50%;transform:translateX(-50%);top:14px;background:#171b25;border:1px solid #14f195;color:#eef1f7;padding:9px 14px;border-radius:12px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.5);max-width:90vw}
    details summary{cursor:pointer;color:#7d869b;font-size:12px;margin:2px 0}
  </style><div id="ui"></div><div id="toasts"></div>`;
  (document.body || document.documentElement).appendChild(host);
  const $ = (id) => root.getElementById(id);
  function toast(txt) { const t = document.createElement("div"); t.className = "toast"; t.textContent = txt; $("toasts").appendChild(t); setTimeout(() => t.remove(), 3500); }

  // Verschiebbar (Maus + Finger)
  let drag = null;
  root.addEventListener("pointerdown", (e) => { const h = e.target.closest?.(".hd, .fab"); if (!h || e.target.closest("button")) return; drag = { x: e.clientX, y: e.clientY, r: parseFloat(host.style.right), b: parseFloat(host.style.bottom), moved: false }; });
  window.addEventListener("pointermove", (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; host.style.right = Math.max(0, drag.r - dx) + "px"; host.style.bottom = Math.max(0, drag.b - dy) + "px"; });
  window.addEventListener("pointerup", () => { if (drag?.moved) store.set(KEY + "-pos", { r: host.style.right, b: host.style.bottom }); setTimeout(() => (drag = null), 0); });

  let typing = false;
  function render() {
    if (typing) return; // nicht neu zeichnen, während man tippt
    const ui = $("ui");
    if (!open) { ui.innerHTML = `<div class="fab" id="fab">📝<br>${sol(equity(), 2)}</div>`; $("fab").onclick = () => { if (drag?.moved) return; open = true; store.set(KEY + "-open", true); render(); }; return; }
    const v = equity(), pnl = v - START, t = cur ? tok[cur] : null, p = cur ? S.pos[cur] : null;
    const posList = Object.entries(S.pos);
    const pv = p ? valSol(cur, p) : 0, ppnl = p ? pv - p.cost : 0, ppct = p ? (pv / p.cost - 1) * 100 : 0;
    const wins = S.closed.filter((x) => x.pnl >= 0).length, real = S.closed.reduce((s, x) => s + x.pnl, 0);
    ui.innerHTML = `<div class="w">
      <div class="hd"><span><b>📝 Paper Trading</b><span class="tag">SIMULATION</span></span><button class="x" id="min" title="Verkleinern">▾</button></div>
      <div class="sec"><div class="row"><span class="mut">Depot</span><span class="big">${sol(v)} <span class="t mut">SOL</span></span></div>
        <div class="row t"><span class="mut">frei ${sol(S.cash)} SOL${solUsd ? ` · ≈ $${(v * solUsd).toFixed(0)}` : ""}</span><span class="${pnl >= 0 ? "up" : "dn"}">${ssol(pnl)} SOL (${pct((v / START - 1) * 100)})</span></div></div>
      <div class="sec">${t ? `
        <div class="row"><b>${t.img ? `<img src="${esc(t.img)}">` : ""}${esc(t.sym || "?")}</b><b>${fmtP(t.price)}</b></div>
        <div class="row t mut"><span>${esc(t.name || "")}</span><span>Liq $${big(t.liq)} · MC $${big(t.mcap)}</span></div>
        <div class="btns">${[0.1, 0.5, 1].map((a) => `<button class="b" data-buy="${a}">Kauf ${a}</button>`).join("")}</div>
        <div class="btns"><input id="amt" type="number" inputmode="decimal" step="any" min="0" placeholder="SOL-Betrag" value="${S.size || ""}"><button class="b" id="buyx" style="flex:none;padding:9px 14px">Kauf</button></div>
        ${p ? `<div class="row" style="margin-top:8px"><span>Position: ${sol(pv)} SOL</span><b class="${ppnl >= 0 ? "up" : "dn"}">${ssol(ppnl)} (${pct(ppct)})</b></div>
          <div class="row t mut"><span>Einstieg ${fmtP(p.entry)}</span><span>seit ${Math.round((now() - p.ts) / 60000)} Min</span></div>
          <div class="btns">${[0.25, 0.5, 1].map((f) => `<button class="s" data-sell="${f}">Verk. ${f * 100}%</button>`).join("")}</div>
          <div class="btns"><input id="tp" type="number" inputmode="decimal" placeholder="Take-Profit %" value="${p.tp ?? ""}"><input id="sl" type="number" inputmode="decimal" placeholder="Stop-Loss %" value="${p.sl ?? ""}"></div>
          <div class="t mut">Take-Profit/Stop-Loss werden geprüft, solange die Seite offen ist.</div>` : ""}`
        : `<div class="mut t">${esc(err) || "Öffne einen Coin auf Axiom – er wird automatisch erkannt."}</div>`}
        <div class="btns"><input id="ca" placeholder="Coin-Adresse einfügen (Token oder Pool)"><button class="g" id="go" style="flex:none;padding:9px 12px">OK</button></div>
        ${t && err ? `<div class="t dn">${esc(err)}</div>` : ""}</div>
      <div class="sec"><div class="row"><b>Offene Positionen</b><span class="t mut">${posList.length}</span></div>
        ${posList.map(([m, q]) => { const pv2 = valSol(m, q), pl = pv2 - q.cost; return `<div class="pos"><div class="row"><span>${q.img ? `<img src="${esc(q.img)}">` : ""}<b>${esc(q.sym)}</b></span><span class="${pl >= 0 ? "up" : "dn"}">${ssol(pl)} (${pct((pv2 / q.cost - 1) * 100)})</span></div>
          <div class="row t mut"><span>${sol(pv2)} SOL · ${fmtP(tok[m]?.price || q.entry)}</span><span><button class="g" data-show="${m}" style="padding:4px 8px;font-size:11px">zeigen</button> <button class="s" data-close="${m}" style="padding:4px 8px;font-size:11px">schließen</button></span></div></div>`; }).join("") || `<div class="t mut">keine</div>`}</div>
      <div class="sec"><details><summary>Verlauf · ${S.closed.length} Trades · ${S.closed.length ? Math.round((wins / S.closed.length) * 100) : 0}% Treffer · <span class="${real >= 0 ? "up" : "dn"}">${ssol(real)} SOL</span></summary>
        ${S.closed.slice(0, 40).map((x) => `<div class="pos"><div class="row"><b>${esc(x.sym)}${x.frac < 0.999 ? ` <span class="t mut">${Math.round(x.frac * 100)}%</span>` : ""}</b><span class="${x.pnl >= 0 ? "up" : "dn"}">${ssol(x.pnl)} (${pct(x.pct)})</span></div>
          <div class="row t mut"><span>▲ ${fmtP(x.entry)} → ▼ ${fmtP(x.exit)}</span><span>${Math.round((x.sellTs - x.buyTs) / 60000)} Min · ${esc(x.why)}</span></div></div>`).join("") || `<div class="t mut">noch keine</div>`}</details>
        <div class="row t mut" style="margin-top:6px"><span>Gebühren ${sol(S.fees, 4)} SOL (simuliert)</span><button class="g" id="reset" style="flex:none;padding:5px 9px;font-size:11px">Zurücksetzen</button></div></div>
    </div>`;
    $("min").onclick = () => { open = false; store.set(KEY + "-open", false); render(); };
    root.querySelectorAll("[data-buy]").forEach((b) => (b.onclick = () => buy(cur, +b.dataset.buy)));
    root.querySelectorAll("[data-sell]").forEach((b) => (b.onclick = () => sell(cur, +b.dataset.sell)));
    root.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => sell(b.dataset.close, 1)));
    root.querySelectorAll("[data-show]").forEach((b) => (b.onclick = () => setCoin(b.dataset.show)));
    const amt = $("amt"); if (amt) $("buyx").onclick = () => { const a = parseFloat(amt.value.replace(",", ".")); if (a > 0) { S.size = a; buy(cur, a); } };
    const setLim = (id, f) => { const el = $(id); if (!el) return; el.onchange = () => { const x = parseFloat(el.value.replace(",", ".")); S.pos[cur][f] = x > 0 ? x : null; S[f] = S.pos[cur][f]; save(); toast(`${f === "tp" ? "Take-Profit" : "Stop-Loss"} ${x > 0 ? x + " %" : "aus"}`); }; };
    setLim("tp", "tp"); setLim("sl", "sl");
    $("go").onclick = async () => { const a = ($("ca").value.match(B58) || [])[0]; if (!a) return toast("Keine gültige Adresse"); const m = await resolve(a); m ? setCoin(m) : toast("Coin nicht gefunden"); };
    $("reset").onclick = () => { if (confirm("Paper-Depot zurücksetzen? (Nur virtuelle SOL)")) { S = fresh(); save(); render(); } };
    // Während Eingabe in Feldern nicht neu zeichnen (sonst springt der Cursor)
    root.querySelectorAll("input").forEach((i) => { i.onfocus = () => (typing = true); i.onblur = () => { typing = false; setTimeout(render, 50); }; });
  }

  // ---------- Start ----------
  (async () => {
    S = { ...fresh(), ...(await store.get(KEY, {})) };
    open = await store.get(KEY + "-open", true);
    const pos = await store.get(KEY + "-pos", null); if (pos) { host.style.right = pos.r; host.style.bottom = pos.b; }
    render(); detect(true);
    setInterval(() => detect(false), 1000);   // Axiom wechselt Seiten ohne Neuladen → Link beobachten
    setInterval(refresh, PRICE_MS);
  })();
})();
