const API = "https://api.coingecko.com/api/v3";
const START_CASH = 10000;
const $ = (id) => document.getElementById(id);
const store = {
  get: (k, d) => JSON.parse(localStorage.getItem(k) || JSON.stringify(d)),
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

let coins = [];
let watch = store.get("watch", []);
let paper = store.get("paper", { cash: START_CASH, pos: {}, log: [] });

const usd = (n) => n == null ? "–" : "$" + (n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toPrecision(3));
const big = (n) => n == null ? "–" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n);
const pct = (n) => n == null ? "–" : `<span class="${n >= 0 ? "up" : "down"}">${n >= 0 ? "+" : ""}${n.toFixed(2)}%</span>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function api(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`CoinGecko ${r.status} (Rate-Limit? kurz warten)`);
  return r.json();
}

async function load() {
  $("status").textContent = "lädt…";
  try {
    coins = await api("/coins/markets?vs_currency=usd&category=meme-token&order=market_cap_desc&per_page=50&page=1&price_change_percentage=24h");
    $("status").textContent = "Stand: " + new Date().toLocaleTimeString();
  } catch (e) {
    $("status").textContent = "⚠ " + e.message;
  }
  render();
}

function coinRows(list) {
  return list.map((c) => `<tr>
    <td><button class="star" data-star="${c.id}">${watch.includes(c.id) ? "★" : "☆"}</button></td>
    <td><img class="ic" src="${esc(c.image)}" alt="">${esc(c.name)} <span class="mut">${esc(c.symbol.toUpperCase())}</span></td>
    <td>${usd(c.current_price)}</td><td>${pct(c.price_change_percentage_24h)}</td>
    <td>${big(c.market_cap)}</td><td>${big(c.total_volume)}</td></tr>`).join("");
}
const head = "<tr><th></th><th>Coin</th><th>Preis</th><th>24h</th><th>Market Cap</th><th>Volumen</th></tr>";

function renderMarket() {
  $("market").innerHTML = `<table>${head}${coinRows(coins)}</table>`;
}
function renderWatch() {
  const l = coins.filter((c) => watch.includes(c.id));
  $("watchlist").innerHTML = l.length ? `<table>${head}${coinRows(l)}</table>` : "<p class='mut'>Noch leer – markiere Coins mit ☆ im Kurse-Tab.</p>";
}

async function renderTrending() {
  $("trending").innerHTML = "<p class='mut'>lädt…</p>";
  try {
    const t = await api("/search/trending");
    $("trending").innerHTML = `<h2>Aktuell trending (CoinGecko-Suchen)</h2><table><tr><th>#</th><th>Coin</th><th>Rang</th></tr>` +
      t.coins.map((x, i) => `<tr><td>${i + 1}</td><td><img class="ic" src="${esc(x.item.small)}" alt="">${esc(x.item.name)} <span class="mut">${esc(x.item.symbol)}</span></td><td>${x.item.market_cap_rank ?? "–"}</td></tr>`).join("") + "</table>";
  } catch (e) { $("trending").innerHTML = `<p class="down">${esc(e.message)}</p>`; }
}

function portfolioValue() {
  let v = paper.cash;
  for (const [id, q] of Object.entries(paper.pos)) {
    const c = coins.find((x) => x.id === id);
    if (c) v += q * c.current_price;
  }
  return v;
}

function renderPaper() {
  const val = portfolioValue(), pnl = val - START_CASH;
  const rows = Object.entries(paper.pos).map(([id, q]) => {
    const c = coins.find((x) => x.id === id);
    return `<tr><td></td><td>${esc(c ? c.name : id)}</td><td>${q.toPrecision(6)}</td><td>${c ? usd(c.current_price) : "–"}</td><td>${c ? usd(q * c.current_price) : "–"}</td><td></td></tr>`;
  }).join("");
  $("paper").innerHTML = `
    <div class="cards">
      <div class="card">Cash<b>${usd(paper.cash)}</b></div>
      <div class="card">Gesamtwert<b>${usd(val)}</b></div>
      <div class="card">Gewinn/Verlust<b class="${pnl >= 0 ? "up" : "down"}">${pnl >= 0 ? "+" : ""}${usd(pnl)}</b></div>
    </div>
    <form id="trade">
      <select id="tc">${coins.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select>
      <input id="ta" type="number" min="0" step="any" placeholder="USD-Betrag" required>
      <button value="buy">Kaufen</button><button value="sell">Verkaufen</button>
      <button type="button" id="reset">Zurücksetzen</button>
    </form>
    <table><tr><th></th><th>Position</th><th>Menge</th><th>Kurs</th><th>Wert</th><th></th></tr>${rows || "<tr><td colspan=6 class='mut'>Keine Positionen</td></tr>"}</table>
    <h2>Verlauf</h2><table>${paper.log.slice(-15).reverse().map((l) => `<tr><td></td><td>${esc(l)}</td></tr>`).join("")}</table>`;
  $("trade").onsubmit = (e) => {
    e.preventDefault();
    trade(e.submitter.value, $("tc").value, parseFloat($("ta").value));
  };
  $("reset").onclick = () => { if (confirm("Paper-Portfolio zurücksetzen?")) { paper = { cash: START_CASH, pos: {}, log: [] }; store.set("paper", paper); renderPaper(); } };
}

function trade(side, id, amount) {
  const c = coins.find((x) => x.id === id);
  if (!c || !(amount > 0)) return;
  const qty = amount / c.current_price;
  if (side === "buy") {
    if (amount > paper.cash) return alert("Nicht genug Cash.");
    paper.cash -= amount;
    paper.pos[id] = (paper.pos[id] || 0) + qty;
  } else {
    if (qty > (paper.pos[id] || 0) + 1e-12) return alert("Nicht genug Bestand.");
    paper.cash += amount;
    paper.pos[id] -= qty;
    if (paper.pos[id] < 1e-12) delete paper.pos[id];
  }
  paper.log.push(`${new Date().toLocaleString()} – ${side === "buy" ? "Kauf" : "Verkauf"} ${c.symbol.toUpperCase()} für ${usd(amount)} @ ${usd(c.current_price)}`);
  store.set("paper", paper);
  renderPaper();
}

function render() { renderMarket(); renderWatch(); if (!$("paper").hidden) renderPaper(); }

document.addEventListener("click", (e) => {
  const star = e.target.closest("[data-star]");
  if (star) {
    const id = star.dataset.star;
    watch = watch.includes(id) ? watch.filter((x) => x !== id) : [...watch, id];
    store.set("watch", watch);
    render();
  }
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b === tab));
    document.querySelectorAll("main section").forEach((s) => (s.hidden = s.id !== tab.dataset.tab));
    if (tab.dataset.tab === "trending") renderTrending();
    if (tab.dataset.tab === "paper") renderPaper();
  }
});

load();
setInterval(load, 60000);
