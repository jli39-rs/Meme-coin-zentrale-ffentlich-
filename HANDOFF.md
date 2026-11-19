# Übergabe: Meme Coins Zentrale + Claude Bot

Stand 18.11.2026, aus einer Claude-Code-Cloud-Session. Diese Datei erklärt alles, damit eine neue Session (lokal auf dem Mac) direkt weitermachen kann.

## Was das ist
- **Meme Coins Zentrale** (`index.html`): Dashboard mit Top-50 Meme Coins (CoinGecko), 7-Tage-Sparklines, Watchlist, Trends, Paper Trading in USD.
- **Claude Bot** (`bot.html`): automatischer **Paper-Trading-Bot mit virtuellen 5 SOL**. Kein Wallet, kein echter Handel – das ist eine bewusste Entscheidung und soll so bleiben.
- Reines HTML/CSS/JS, kein Build-Schritt, keine API-Keys. Läuft komplett im Browser; der Bot handelt nur, solange die Seite offen ist. Zustand liegt im `localStorage`.

## Wo der Code liegt
| Was | Ort |
|---|---|
| Aktives Repo (öffentlich) | https://github.com/jli39-rs/Meme-coin-zentrale-ffentlich- , Branch `main` |
| Live-Seite (GitHub Pages aus `main`) | https://jli39-rs.github.io/Meme-coin-zentrale-ffentlich-/bot.html |
| Altes Repo (privat, veraltet – nicht mehr benutzen) | `jli39-rs/Meme-coin-zentrale-`, Branch `claude/eloquent-gates-a4n0qg` |

## Dateien
| Datei | Inhalt |
|---|---|
| `index.html`, `src/app.js`, `src/style.css` | Zentrale |
| `bot.html`, `src/bot.js`, `src/bot.css` | Claude Bot (Hauptlogik in `src/bot.js`, ~540 Zeilen) |
| `src/gate.js`, `src/gate-config.js` | Zugangscode-Sperre: PBKDF2-SHA256 (200 000 Runden) im Browser, im Repo steht nur Salt+Hash. **Nur eine Schranke, kein echter Schutz.** Der Code selbst steht nicht im Repo – die Nutzerin/der Nutzer kennt ihn. Achtung: Node muss das Salt als Bytes (`Buffer.from(salt,"hex")`) nehmen, sonst passt der Hash nicht. |
| `src/vendor/lightweight-charts.js` | TradingView Lightweight Charts v4.2.0 (Apache-2.0, Lizenz daneben) für Kerzen-Charts |
| `tests/*.js` | Playwright-Tests mit gemockten APIs (siehe unten) |
| `start.sh` | lokaler Server: `python3 -m http.server 8080` |

## Aufbau von `src/bot.js`
1. **Konstanten/Presets**: Risikostufen `vorsichtig | normal | aggressiv` (Positionsgröße, Take-Profit, Stop, Trailing, max. Positionen, Mindest-Score, Mindestliquidität, Zeit-Exit, max. Rug-Score). Gebühren: 0,3 % (etabliert) / 1 % (neue Coins) je Seite + 0,0005 SOL Netzwerkgebühr.
2. **Daten**:
   - CoinGecko `coins/markets?category=meme-token` (etablierte Coins, Schlüssel `cg:<id>`), `simple/price` (SOL-Preis), `coins/<id>/ohlc`
   - GeckoTerminal `networks/solana/new_pools`, `trending_pools`, `pools/multi`, `pools/<addr>/ohlcv/minute` (Schlüssel `gt:<poolAddress>`)
   - DexScreener als Fallback: `token-profiles/latest/v1`, `token-boosts/latest/v1`, `latest/dex/tokens/<mints>`, `latest/dex/pairs/solana/<pairs>` (gleiche Schlüssel `gt:<pairAddress>`)
   - RugCheck `api.rugcheck.xyz/v1/tokens/<mint>/report`
   - `guarded()` = Backoff je Quelle; Status oben als `GT ✓/✗ DS ✓/✗`
3. **Rug-Check** `analyseRug()`: Score 0–100. Harte Ausschlüsse: rugged, Mint-/Freeze-Authority aktiv, LP < 50 % gesperrt, Top-10 (ohne Pool) > 40 %, ein Wallet > 15 %, Insider > 20 %. Pool-Wallets werden erkannt, wenn ihre Adresse in `markets` vorkommt.
4. **Strategie** `score()` + `tick()` alle 5 s: Ausstiege (Take-Profit, Stop, Trailing, Zeit-Exit, Notverkauf bei −40 % Liquidität), dann bester Kandidat → Rug-Check → Kauf.
5. **Cluster/Bundles** (in `analyseRug`): Cluster = Wallets mit gemeinsamer Quelle laut RugCheck-Insider-Graph. Blockiert, wenn der größte Cluster ≥ `clMax` hält, alle Cluster zusammen ≥ 1,5 × `clMax`, oder ein Bundle/Sniper-Muster (≥ `bundleN` Wallets aus einer Quelle mit ≥ `bundlePct`). Grund steht im Entscheidungs-Log („🛡️ blockiert …: Cluster aus 16 Wallets hält 24%“).
6. **Anzeige**: Top-Trade-Kerzenchart mit Einstieg/Ziel/Stop-Linien, Positionen (antippbar), Rug-Panel mit **Cluster-Bubble-Map** (d3-force, `src/vendor/d3-force.js`): Ringe um die Funding-Quelle, Pfeile Quelle → Wallet, Farbe je Cluster, Pool blau, Dev orange, lose Holder violett; Bubble antippen zeigt Adresse + Solscan-Link. Darunter Cluster-Liste. Agenten, Live-Trades, Entscheidungs-Log (Wiederholungen werden zusammengefasst).

## Benachrichtigungen bei Käufen (19.11.2026)
- Bei jedem Kauf erscheint immer ein Hinweis oben in der Seite (`toast()`), Verkäufe optional („Auch bei Verkäufen benachrichtigen“).
- Zusätzlich gibt es eine System-Mitteilung (`notify()`), wenn sie in den Einstellungen per „🔔 Mitteilungen bei Käufen einschalten“ erlaubt wurde. Sie läuft über `sw.js` (minimaler Service Worker **ohne Caching**, nur für Mitteilungen und das Antippen).
- **iPad/iPhone:** Mitteilungen gibt es nur als Home-Bildschirm-App (ab iOS 16.4). Dafür neu: `manifest.webmanifest`, `icon-180/192/512.png`, `apple-touch-icon`. Der Weg: Safari → Teilen → „Zum Home-Bildschirm“ → über das Symbol öffnen → im Bot einschalten. Die Seite erklärt das selbst.
- Grenze: Der Bot läuft nur, solange die Seite/App offen ist. iOS pausiert sie im Hintergrund, dann kommen keine Käufe und keine Mitteilungen. Echte Push-Mitteilungen bei geschlossener App bräuchten einen Server – nicht gebaut.
- Test: `node tests/test-benachrichtigung.js` (gemockt, volles Headless-Chromium).
- **Nicht getestet:** auf einem echten iPad/iPhone.

## 1s-Chart mit Stop/Ziel + Solana-Fokus (19.11.2026, später)
- **Chart-Modi** (`chartMode`, gespeichert):
  - `s1` = Standard „⚡ 1 s + Stop/Ziel“: eigener Lightweight-Chart mit **1-Sekunden-Kerzen aus den echten Einzel-Trades**. Quelle: GeckoTerminal `GET /pools/<pool>/trades` (gratis, letzte 300 Trades, Abruf alle 6 s, `loadTrades()`, max. 1 Std. im Speicher). Einstieg/Ziel/Stop sind eingezeichnet, und die Preis-Skala wird so erweitert, dass Stop und Ziel immer sichtbar sind.
  - Ohne GeckoTerminal greift ein Ersatz: Kerzen aus den gesammelten Preisen.
  - `bot` = „📊 1 Min“: 1-Min-Kerzen.
  - `ds` = „DexScreener 1s“: eingebetteter Live-Chart, ohne eigene Linien.
- **Solana-Fokus:**
  - Etablierte CoinGecko-Coins nur als Beimischung: höchstens `maxCg` (1/1/2) gleichzeitig.
  - Gedämpfter Score (1h-Änderung auf −5…+6 %, 24h-Änderung auf −20…+60 % gedeckelt); vorher kamen Scores über 20 vor.
  - Im Chart haben Solana-Positionen Vorrang.
- Test: `node tests/test-live-chart.js` prüft u. a. die 3 Linien im 1s-Chart.

## Schnellere Preise + 1-Sekunden-Chart (19.11.2026)
- **Chart-Umschalter** im Top-Trade-Chart (`#chart-mode`):
  - „📊 Bot-Chart“: eigener Chart mit Einstieg/Ziel/Stop, 1-Min-Kerzen + Live-Preis.
  - „⚡ Live 1s“: eingebetteter **DexScreener-Chart mit 1-Sekunden-Kerzen**, gratis und live (`?embed=1&…&interval=1S`, geprüft).
  - „GeckoTerminal“: Einbettung mit 1-Min-Kerzen. GTs eigene 1s-Ansicht blieb im Test leer; die GT-API gibt Sekunden-Kerzen nur im Bezahl-Tarif (401).
  - Die Auswahl wird gespeichert. Bei etablierten Coins (z. B. DOGE) geht nur der Bot-Chart.
- **Schnelle Preise über Jupiter** (`lite-api.jup.ag/price/v3?ids=…`, gratis, ohne Key, CORS ok):
  - Alle 3 s für alle offenen Solana-Positionen + den Coin im Chart.
  - Danach sofort `checkExits()` (Stop/Ziel/Trailing) statt nur alle 5 s mit 15–45 s alten Preisen.
  - Jupiter selbst aktualisiert den Preis etwa alle 10 s (gemessen) – schneller geht es gratis nicht.
  - Status oben: `⚡JUP ✓`.
- Axiom: keine öffentliche API, Charts nur mit Login – nicht nutzbar.
- Test: `node tests/test-live-chart.js` (echte APIs).

## Handy/iPad-Version + SOL-Kurs (19.11.2026)
- **SOL-Kurs-Karte** (wie bei Google, `#sol-card` in `bot.html`, Code ab `// ---------- SOL-Kurs` in `src/bot.js`):
  - Preis in EUR (oder USD, umschaltbar), Änderung 24 Std., Verlauf 1 T./5 T./1 M./6 M./1 J. als Flächen-Chart (Lightweight Charts) und Umrechner SOL ↔ EUR/USD.
  - Quellen: CoinGecko `simple/price?vs_currencies=usd,eur&include_24hr_change=true` und `coins/solana/market_chart`.
  - Ersatz bei CoinGecko-Limit: Verlauf über GeckoTerminal-Pool Raydium SOL/USDC (`58oQChx4…`), EUR über den letzten bekannten Wechselkurs. GT hat dort nur ~6 Monate Verlauf – das wird dann ehrlich angezeigt.
  - Hinweis: Google zeigt „heute“ (seit 0 Uhr), die Karte zeigt „24 Std.“ – die Zahlen weichen deshalb leicht ab.
- Portfolio-Wert zusätzlich in € (bzw. $ je nach Auswahl).
- **iPad/Tablet (ab 820 px Breite): zwei Spalten.**
  - Links: Portfolio, Kennzahlen, SOL-Kurs, Top-Trade, Positionen.
  - Rechts: Rug-Check, Live-Trades, Entscheidungen, Einstellungen, Agenten.
  - Auf dem Handy stehen alle Bereiche in dieser Reihenfolge untereinander.
- iOS-Korrekturen:
  - Kein `background-attachment: fixed` mehr, das ergab einen weißen Hintergrund beim Scrollen.
  - Eingabefelder ≥ 16 px, damit iOS beim Antippen nicht zoomt.
  - Safe-Area links und rechts beachtet.
  - Kein „hängender“ Hover-Effekt auf Touch-Geräten.
  - Die leere Bubble-Map ist jetzt klein.
- Test: `node tests/test-sol-kurs.js` (echte APIs, einmal normal und einmal mit gesperrtem CoinGecko).
- Ungetestet: echtes iPhone/iPad-Safari – getestet nur per Chromium-Emulation (iPhone 14, iPad 1180×820).

## API-Prüfung (18.11.2026, live gegen die echten APIs)
Alle vier APIs antworten mit `access-control-allow-origin: *` (CORS ok): RugCheck, GeckoTerminal, DexScreener, CoinGecko.
- **RugCheck** `/v1/tokens/<mint>/report`: Feldnamen stimmen (`token.mintAuthority/freezeAuthority/supply`, `markets[].lp.lpLockedPct`, `topHolders[].{address,owner,pct,insider}`, `graphInsidersDetected`, `score_normalised`, `risks[].{name,level}`, `creator`, `rugged`, `totalHolders`). Neu genutzt: `knownAccounts` (Typ `AMM`/`LOCKER`/`CREATOR` → Pool- und Dev-Wallets), `insiderNetworks[]` (`size`, `type` transfer|trade, `currentHolding` in Roh-Einheiten → % über `token.supply`).
  - Reports großer Coins sind riesig (BONK ≈ 2,5 MB) – für neue Pump.fun-Coins nur ein paar KB.
  - `lpLockedPct` ist fast überall 100 → „Maximum über alle Märkte“ war wertlos. Jetzt zählt der gehandelte bzw. größte Pool; bei konzentrierter Liquidität (Raydium CLMM, Meteora DLMM, Orca) gibt es keinen LP-Lock → nur leichter Malus.
  - **Insider-Graph** `/v1/tokens/<mint>/insiders/graph` → `[{net_id, network_type, nodes:[{id, participant, holdings}], links:[{source, target}]}]`. Das ist genau die Bubblemaps-Struktur (Quelle → Wallets). Riesen-Netzwerke (> 1000 Wallets, meist Börse/Airdrop) fehlen im Graph und stehen nur in `insiderNetworks`; sie werden nicht gewertet. Prozentwerte können unplausibel sein (ein Coin hatte 115 %) → auf 100 % gedeckelt.
  - `/lockers` braucht einen bezahlten Plan (401).
- **GeckoTerminal**: Felder stimmen. Ursache für Safari-„Load failed“ gefunden: Bei Überlast (~30 Anfragen/Min) kommt **429 ohne CORS-Header**, das meldet der Browser als Netzwerkfehler. Der Bot hat durch einen Bug in `render()` denselben Chart-Abruf bis zu 7× parallel gestartet. Behoben: kein paralleler Chart-Abruf mehr, alle GT-Anfragen mit ≥ 2,5 s Abstand (gemessen ~10/Min).
  - Pools haben teils USDC/andere Token als Gegenwährung, manchmal ist SOL selbst Basis-Token → SOL/USDC/USDT als Basis werden übersprungen.
- **DexScreener**: Felder stimmen (`pairs[].{pairAddress, baseToken, priceUsd, txns.m5, volume, priceChange, liquidity.usd, fdv, pairCreatedAt}`); `latest/dex/pairs/solana/<a>` liefert `pairs` + `pair`.
- **CoinGecko**: ok, aber das Gratis-Limit wird schnell erreicht (429 ohne CORS) – der Bot läuft dann ohne etablierte Coins weiter.

## Was weiterhin NICHT verifiziert ist
- Safari auf dem iPhone selbst (getestet nur mit Chromium/Playwright).
- Ob die Cluster-Schwellen (Vorsichtig 12 % / Normal 18 % / Aggressiv 25 %, Bundle ab 8/12/20 Wallets mit ≥ 2/4/6 %) echte Rugs zuverlässig erkennen – das sind Startwerte, an echten Rug-Pulls nachschärfen.
- „Frische Wallets“: RugCheck sagt nicht, wie alt eine Wallet ist. Die Bundle-Regel zählt nur Wallets, die von **einer** Quelle Tokens bekommen haben (Fan-out im Graph). Eigene Funding-Analyse über Solana-RPC wurde bewusst nicht gebaut (öffentlicher RPC ist stark limitiert und langsam).
- Netzwerke mit 300–1000 Wallets (z. B. 770 Wallets / 19 %) werden als Cluster gewertet – kann bei großen Coins zu streng sein.

## Nächste Aufgaben (Wünsche der Nutzerin)
1. ~~**Cluster-Bubble-Map wie bei Bubblemaps**~~ (erledigt über RugCheck-Insider-Graph): Die Nutzerin hat einen Screenshot geschickt: große Ringe aus vielen Wallets, die alle von **einer gemeinsamen Quell-Wallet** (Mitte, Pfeile nach außen) gefüttert werden, farbig je Cluster, kleine lose Holder drumherum. Aktuell zeigt die Map nur die Top-Holder ohne Verbindungen. Umsetzung z. B.:
   - Holder-Liste von RugCheck (oder `getTokenLargestAccounts` per Solana-RPC),
   - pro Wallet die **erste eingehende SOL-Überweisung** (Funding-Quelle) über Solana-RPC/Helius/Solscan ermitteln, Wallets mit gleicher Quelle = Cluster,
   - prüfen, ob RugCheck selbst einen Insider-Graph liefert (z. B. `insiderNetworks` im Report oder ein eigener Graph-Endpunkt) – dann ist das viel einfacher,
   - Darstellung: Force-Layout (z. B. d3-force aus cdnjs) mit Hub in der Mitte und Pfeilen.
2. ~~**Rug-Pools gezielt ausfiltern über Cluster**~~ (erledigt, Schwellen je Risikostufe in `PRESETS`): Wenn ein Cluster (gleiche Funding-Quelle) zusammen > ~15–20 % hält oder viele frische Wallets aus einer Quelle kaufen (Bundle/Sniper), Coin blockieren. Neuer Grund im Log wie „🛡️ Cluster aus 37 Wallets hält 28 %“.
3. **Läuft lokal / „einfach eine Seite im Netz“**: Lokal genügt `./start.sh` → http://localhost:8080/bot.html. Die öffentliche Seite gibt es bereits über GitHub Pages (Link oben). Falls ein eigener Host gewünscht ist: Netlify/Vercel/Cloudflare Pages, alles statisch, kein Build.
4. **Features aus einem Video**: Die Nutzerin will noch ein Video zeigen – danach fragen.
5. Bei echten APIs: Felder/Schwellen anhand echter Rug-Pull-Beispiele prüfen und nachschärfen.

## Testen
```bash
npm i -D playwright   # falls nicht vorhanden; dann: npx playwright install chromium
./start.sh &          # Server auf :8080
node tests/test-rugcheck-mock.js        # Mocks im echten RugCheck-Format, beendet sich mit Fehlercode bei Problemen
node tests/test-dexscreener-fallback.js # GeckoTerminal fällt aus → DexScreener übernimmt
node tests/test-live.js                 # OHNE Mocks gegen die echten APIs (MINT=<mint> für eine bestimmte Bubble-Map)
```
Die Tests entsperren die Seite über den (öffentlichen) Hash aus `src/gate-config.js`; mit `ZENTRALE_CODE=<code>` wird stattdessen der echte Code eingegeben.
Der Mock-Test prüft: Mint-Authority, Cluster (16 Wallets / 24 %) und Bundle (14 Wallets aus einer Quelle) werden blockiert, sicherer Coin wird gekauft und mit Take-Profit verkauft, Pool-Wallet zählt nicht als Holder, Bubble-Map hat Pfeile.

## Regeln, die bisher galten
- Kein echtes Trading, kein Wallet, keine Seed-Phrases/Private Keys – nur Simulation.
- Keine Secrets ins Repo (das Repo ist öffentlich).
- Ehrlich bleiben: Rug-Checks sind Faustregeln, kein Schutz vor Verlusten.
