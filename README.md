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

## Claude Bot (`bot.html`)
Handy-Layout mit Agenten-Ansicht (Scanner → Safety → Analyst → Risk → Executor), Kurve und Entscheidungs-Stream. Handelt automatisch mit **virtuellen 100 $** auf Basis der Live-Preise. v2: neue & trendende Solana-Coins über GeckoTerminal, Risikostufen (Vorsichtig/Normal/Aggressiv), Trailing-Stop, Zeit-Exit, simulierte Gebühren/Slippage und Statistik. Öffnen: http://localhost:8080/bot.html (oder Link in der Zentrale). Kein Wallet, kein echter Handel.

## Zugangscode
Beide Seiten fragen beim ersten Öffnen nach einem Code (`src/gate.js`). Im Repo steht nur ein Hash (`src/gate-config.js`), nicht der Code selbst.
Das ist eine einfache Schranke im Browser, **kein echter Schutz**: Wer den Code der Seite liest, kann sie umgehen. Es liegen aber keine Geheimnisse darin.
Neuen Code setzen: Hash mit `node` erzeugen (PBKDF2-SHA256, 200000 Runden, Salt als Bytes aus 16-Byte-Hex) und in `src/gate-config.js` eintragen.
