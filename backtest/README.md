# Backtest der Bot-Strategie (20.11.2026)

Reine Auswertung mit öffentlichen, kostenlosen APIs (GeckoTerminal, RugCheck). Kein Wallet, keine Keys.

## Ablauf
1. `python3 collect.py 110` – sammelt 110 Min lang jede Minute, was der Bot sieht (neue + trendende Solana-Pools) → `daten/snaps.jsonl`, dazu RugCheck je neuem Coin → `daten/rug.jsonl`. Es wird nur vorwärts gesammelt, also ohne Blick in die Zukunft und ohne Survivorship-Bias.
2. `python3 fetch_ohlcv.py --final` – holt die 1-Min-Kerzen aller Pools mit ≥ $12k Liquidität → `daten/ohlcv/`.
3. Auswertung:
   - `search.py` – Train/Test-Split
   - `robust.py` – 3 Zeitabschnitte, getrimmter Mittelwert
   - `newpool.py` – ganz neue Pools
   - `final.py` – Empfindlichkeit der eingebauten Regel
   - `cmp.py` – Vergleich mit der alten Strategie

Datenordner ändern: `BT=/pfad python3 …`.

## Annahmen (`bt.py`)
- Einstieg zum Open der Minute nach dem Signal.
- Stop vor Take-Profit, bei Kurslücken ein schlechterer Ausführungspreis.
- 1 % Gebühr/Slippage je Seite + 0,0005 SOL, also etwa 2,2 % pro Runde.
- 30 Min Sperre pro Pool nach einem Trade.
- Kerzen mit Datenfehlern (Sprung > 8×) werden entfernt.
- **Pool handelt nicht mehr** (letzte Kerze > 15 Min vor dem Abruf, bevor der Ausstieg erreicht war) → **−100 %**: Liquidität abgezogen, Verkauf unmöglich.
- Einstiege, für die noch zu wenig Zukunft beobachtet wurde, zählen nicht. Maßstab ist die Abrufzeit, nicht das Kerzenende, sonst würden tote Pools herausfallen.

## Ergebnis (110 Min, 275 Pools, 6.646 Snapshots)

| Strategie | Trades | Ø pro Trade nach Gebühren | 95 %-Intervall |
|---|---|---|---|
| alte Bot-Strategie („Normal“: Score ≥ 3, TP 30 / SL 12 / Trailing / 60 Min) | 23 | **−10,2 %** | −19,2 … −3,0 |
| alter Einstieg, neue Ausstiege (TP 8 / SL 20 / 10 Min) | 28 | −4,7 % | −8,5 … −1,9 |
| **eingebaut („📊 Daten“):** Liq ≥ 60k, ≥ 55 % Käufe, 5m ≥ +1 %, Rug ok, TP 8 / SL 20 / Zeit-Exit 10 Min | 14 | **−0,7 %** | −2,9 … +1,4 |
| Zufällige Käufe (Liq ≥ 25k, Rug ok, älter als 1 Std) | 54 | −4,1 % | −6,5 … −2,0 |
| Ganz neue Pools (< 3 Min, Rug ok), 10 Min halten | 63 | je Abschnitt −25 % / +29 % / −25 % (Ø etwa 0, reines Glücksspiel) | viele tote Pools (−100 %) |

**Fazit:** Keine getestete Regel war nach Gebühren verlässlich im Plus. Die eingebaute Regel verliert am wenigsten.
- **Was hilft:** kleines Ziel, schneller Ausstieg und nur liquide Pools mit Kaufdruck.
- **Was schadet:** Pumps hinterherkaufen, lange halten und frisch gestartete Pools. Viele davon sind Serien-Scams (derselbe Name mehrfach neu gestartet), deren Liquidität abgezogen wird.
- **Grenzen:** Das sind nur 110 Minuten an einem Tag mit kleinen Stichproben (10–30 Trades). Ein anderer Markttag kann ganz anders aussehen. Etablierte CoinGecko-Coins sind nicht getestet.
