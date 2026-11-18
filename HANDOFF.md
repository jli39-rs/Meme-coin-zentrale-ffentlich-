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
5. **Anzeige**: Top-Trade-Kerzenchart mit Einstieg/Ziel/Stop-Linien, Positionen (antippbar), Rug-Panel mit **einfacher** Bubble-Map (Spirale, nur Top-Holder aus RugCheck), Agenten, Live-Trades, Entscheidungs-Log.

## Was NICHT verifiziert ist (wichtig!)
Die Cloud-Session konnte keine der APIs live erreichen (Netzwerk gesperrt). Alles wurde nur mit **gemockten** Antworten getestet. Auf dem Mac bitte zuerst prüfen:
- Antwortet RugCheck aus dem Browser (CORS)? Stimmen die Feldnamen (`token.mintAuthority`, `token.freezeAuthority`, `markets[].lp.lpLockedPct`, `topHolders[].{address,owner,pct,insider}`, `graphInsidersDetected`, `score_normalised`, `risks[].level`, `creator`, `rugged`)?
- GeckoTerminal zeigte bei der Nutzerin in Safari „Load failed“ (vermutlich Rate-Limit oder CORS). Deshalb gibt es den DexScreener-Fallback – ob DexScreener wirklich geht, ist ebenfalls ungetestet.
- Schnelltest im Terminal: `curl -s https://api.rugcheck.xyz/v1/tokens/<mint>/report | head -c 2000` und `curl -sI https://api.geckoterminal.com/api/v2/networks/solana/new_pools` (auf `access-control-allow-origin` achten).

## Nächste Aufgaben (Wünsche der Nutzerin)
1. **Cluster-Bubble-Map wie bei Bubblemaps**: Die Nutzerin hat einen Screenshot geschickt: große Ringe aus vielen Wallets, die alle von **einer gemeinsamen Quell-Wallet** (Mitte, Pfeile nach außen) gefüttert werden, farbig je Cluster, kleine lose Holder drumherum. Aktuell zeigt die Map nur die Top-Holder ohne Verbindungen. Umsetzung z. B.:
   - Holder-Liste von RugCheck (oder `getTokenLargestAccounts` per Solana-RPC),
   - pro Wallet die **erste eingehende SOL-Überweisung** (Funding-Quelle) über Solana-RPC/Helius/Solscan ermitteln, Wallets mit gleicher Quelle = Cluster,
   - prüfen, ob RugCheck selbst einen Insider-Graph liefert (z. B. `insiderNetworks` im Report oder ein eigener Graph-Endpunkt) – dann ist das viel einfacher,
   - Darstellung: Force-Layout (z. B. d3-force aus cdnjs) mit Hub in der Mitte und Pfeilen.
2. **Rug-Pools gezielt ausfiltern über Cluster**: Wenn ein Cluster (gleiche Funding-Quelle) zusammen > ~15–20 % hält oder viele frische Wallets aus einer Quelle kaufen (Bundle/Sniper), Coin blockieren. Neuer Grund im Log wie „🛡️ Cluster aus 37 Wallets hält 28 %“.
3. **Läuft lokal / „einfach eine Seite im Netz“**: Lokal genügt `./start.sh` → http://localhost:8080/bot.html. Die öffentliche Seite gibt es bereits über GitHub Pages (Link oben). Falls ein eigener Host gewünscht ist: Netlify/Vercel/Cloudflare Pages, alles statisch, kein Build.
4. **Features aus einem Video**: Die Nutzerin will noch ein Video zeigen – danach fragen.
5. Bei echten APIs: Felder/Schwellen anhand echter Rug-Pull-Beispiele prüfen und nachschärfen.

## Testen
```bash
npm i -D playwright   # falls nicht vorhanden; dann: npx playwright install chromium
./start.sh &          # Server auf :8080
ZENTRALE_CODE=<zugangscode> node tests/test-rugcheck-mock.js
ZENTRALE_CODE=<zugangscode> node tests/test-dexscreener-fallback.js
```
Die Tests mocken alle APIs und prüfen: Coin mit aktiver Mint-Authority und Insider-Cluster wird blockiert, sicherer Coin wird gekauft und mit Take-Profit verkauft; bei Ausfall von GeckoTerminal übernimmt DexScreener.

## Regeln, die bisher galten
- Kein echtes Trading, kein Wallet, keine Seed-Phrases/Private Keys – nur Simulation.
- Keine Secrets ins Repo (das Repo ist öffentlich).
- Ehrlich bleiben: Rug-Checks sind Faustregeln, kein Schutz vor Verlusten.
