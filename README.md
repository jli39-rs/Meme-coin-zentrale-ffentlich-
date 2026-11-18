# 🐸 Meme Coins Zentrale

Lokales Dashboard für Meme Coins: Kurse, Watchlist, Trends und **Paper Trading** (nur Simulation, 10.000 $ Startguthaben). Daten von der öffentlichen CoinGecko-API. Keine Build-Tools, keine API-Keys, keine Wallet.

## Einrichten auf dem Mac

```bash
# 1. Repo klonen (git ist nach `xcode-select --install` vorhanden)
git clone https://github.com/jli39-rs/meme-coin-zentrale-ffentlich-.git
cd meme-coin-zentrale-ffentlich-


# 2. Starten (python3 liegt auf dem Mac bereits bei den Command Line Tools)
./start.sh
```

Danach öffnet sich http://localhost:8080 im Browser.

## Funktionen
- **Kurse**: Top-50 Meme Coins nach Market Cap, aktualisiert jede Minute
- **Watchlist**: Coins mit ☆ merken (im Browser gespeichert)
- **Trends**: aktuell meistgesuchte Coins auf CoinGecko
- **Paper Trading**: virtuell kaufen/verkaufen, Gewinn/Verlust verfolgen

Hinweis: Die kostenlose CoinGecko-API hat ein Rate-Limit; bei Fehlermeldung kurz warten.
Kein echter Handel, keine Finanzberatung.

## Claude Bot (`bot.html`) – v3
Paper-Trading-Bot mit **virtuellen 5 SOL** (kein Wallet, kein echter Handel).
- **Coins:** neue & trendende Solana-Pools (GeckoTerminal) + etablierte Meme Coins (CoinGecko)
- **Top-Trade live:** Candlestick-Chart der besten offenen Position (TradingView Lightweight Charts, Daten GeckoTerminal/CoinGecko) mit Einstieg, Ziel und Stop
- **Rug-Check** (RugCheck-API) vor jedem Kauf eines neuen Coins: Mint-/Freeze-Authority, LP gesperrt/verbrannt, Top-10-Holder, größter Holder, Insider-Cluster, Dev-Anteil, RugCheck-Risiken → Risiko-Score 0–100
- **Bubble-Map** der Top-Holder (Insider rot, Dev orange, Pool/LP blau) + Links zu RugCheck, Bubblemaps, Solscan
- **Risikostufen**, Trailing-Stop, Zeit-Exit, Notverkauf bei Liquiditätsabzug, simulierte Gebühren/Slippage/Netzwerkgebühr
- Läuft nur, solange die Seite offen ist. Keine Finanzberatung.

Rug-Kriterien (Faustregeln aus öffentlichen Checklisten, keine Garantie): Mint/Freeze aktiv = Ausschluss · LP < 50 % gesperrt = Ausschluss, < 80 % = Risiko · Top-10 (ohne Pool) > 40 % = Ausschluss · ein Wallet > 15 % = Ausschluss · Insider > 20 % = Ausschluss · Dev > 5 % = Risiko.

## Zugangscode
Beide Seiten fragen beim ersten Öffnen nach einem Code (`src/gate.js`). Im Repo steht nur ein Hash (`src/gate-config.js`), nicht der Code selbst.
Das ist eine einfache Schranke im Browser, **kein echter Schutz**: Wer den Code der Seite liest, kann sie umgehen. Es liegen aber keine Geheimnisse darin.
Neuen Code setzen: Hash mit `node` erzeugen (PBKDF2-SHA256, 200000 Runden, Salt als Bytes aus 16-Byte-Hex) und in `src/gate-config.js` eintragen.
