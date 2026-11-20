# Backtester für die Forward-Daten. Jeder Snapshot = was der Bot zu dem Zeitpunkt wusste. Kurse danach = 1-Min-Kerzen.
import os as _os; HERE = _os.path.dirname(_os.path.abspath(__file__)); DATA = _os.environ.get("BT", _os.path.join(HERE, "daten"))
import json, os, math, random, itertools, sys
BT = DATA
SIZE, FEE, NET = 0.5, 0.01, 0.0005
FETCHED = {}
def load():
    snaps = [json.loads(l) for l in open(f"{BT}/snaps.jsonl")]
    rug = {}
    if os.path.exists(f"{BT}/rug.jsonl"):
        for l in open(f"{BT}/rug.jsonl"): r = json.loads(l); rug.setdefault(r["mint"], r)
    bars = {}
    d = f"{BT}/{os.environ.get('OHLCV', 'ohlcv')}"
    for fn in os.listdir(d):
        b = json.load(open(f"{d}/{fn}"))
        b = [x for x in b if x[1] > 0 and x[3] > 0]
        # Ausreißer-Kerzen (Datenfehler) entfernen: Sprung >8x gegenüber Nachbarn oder Docht >8x
        cl = []
        for k, x in enumerate(b):
            ref = cl[-1][4] if cl else (b[k + 1][1] if k + 1 < len(b) else x[1])
            if x[2] / x[3] > 8 or max(x[2], x[4]) / ref > 8 or ref / min(x[3], x[4]) > 8: continue
            cl.append(x)
        if cl: bars[fn[:-5]] = cl; FETCHED[fn[:-5]] = os.path.getmtime(f"{d}/{fn}")
    by = {}
    for s in snaps:
        if s["pool"] in bars: by.setdefault(s["pool"], []).append(s)
    for v in by.values(): v.sort(key=lambda s: s["t"])
    return by, bars, rug

def exit_sim(b, i0, entry, P):
    """Ab Kerze i0 (Einstieg zum Open) laufen. Liefert (Rendite vor Gebühren, Grund, Minuten)."""
    tp, sl, trail_on, trail, tmax = P["tp"], P["sl"], P.get("trail_on"), P.get("trail"), P["tmax"]
    peak = entry; stop = entry * (1 - sl / 100)
    for j in range(i0, len(b)):
        ts, o, h, l, c = b[j][0], b[j][1], b[j][2], b[j][3], b[j][4]
        mins = (ts - b[i0][0]) / 60
        if trail_on and peak >= entry * (1 + trail_on / 100): stop = max(stop, peak * (1 - trail / 100))
        if l <= stop:  # konservativ: Stop zuerst; bei Lücke/Absturz schlechterer Ausführungspreis
            fill = o if o < stop else max(l, stop - (stop - l) * 0.5)
            return fill / entry - 1, "stop" if stop < entry else "trail", mins
        if tp and h >= entry * (1 + tp / 100): return tp / 100, "tp", mins
        peak = max(peak, h)
        if mins >= tmax: return c / entry - 1, "time", mins
    return b[-1][4] / entry - 1, "end", (b[-1][0] - b[i0][0]) / 60

def run(by, bars, rug, E, P, t_from=0, t_to=1e18, cooldown=30):
    trades = []
    for pool, ss in by.items():
        b = bars[pool]; idx = {x[0]: k for k, x in enumerate(b)}; busy_until = 0
        for s in ss:
            if not (t_from <= s["t"] < t_to) or s["t"] < busy_until: continue
            if not E(s, rug.get(s["mint"])): continue
            m = math.floor(s["t"] / 60) * 60 + 60          # Einstieg: Open der nächsten Minute
            i0 = idx.get(m)
            if i0 is None:
                cand = [k for k, x in enumerate(b) if m <= x[0] <= m + 180]
                if not cand: continue
                i0 = cand[0]
            entry = b[i0][1]
            if entry <= 0 or FETCHED.get(pool, 1e18) - b[i0][0] < min(P["tmax"], 20) * 60 + 15 * 60: continue   # zu wenig Zukunft → nicht bewertbar
            r, why, mins = exit_sim(b, i0, entry, P)
            if why == "end" and b[-1][0] < FETCHED.get(pool, 1e18) - 15 * 60:
                r, why = -1.0, "tot"   # Pool handelt nicht mehr (Liquidität abgezogen) → nicht verkaufbar
            net = (1 + r) * (1 - FEE) * (1 - FEE) - 1 - 2 * NET / SIZE
            trades.append(dict(t=s["t"], pool=pool, sym=s.get("sym"), r=r, net=net, why=why, mins=mins))
            busy_until = b[i0][0] + mins * 60 + cooldown * 60
    return trades

def stats(tr):
    if not tr: return dict(n=0, mean=0, sum=0, win=0, lo=0, hi=0)
    xs = [t["net"] for t in tr]; n = len(xs); mean = sum(xs) / n
    random.seed(1); bs = sorted(sum(random.choice(xs) for _ in range(n)) / n for _ in range(400))
    return dict(n=n, mean=mean * 100, sum=sum(xs) * SIZE, win=100 * sum(x > 0 for x in xs) / n, lo=bs[20] * 100, hi=bs[379] * 100)
