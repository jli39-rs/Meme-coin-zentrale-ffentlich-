# Strategiesuche: Einstiegs-Familien × Ausstiegs-Raster. Auswahl NUR auf Trainingszeit, Bewertung auf Testzeit.
import os as _os; HERE = _os.path.dirname(_os.path.abspath(__file__)); DATA = _os.environ.get("BT", _os.path.join(HERE, "daten"))
import sys, os, itertools, json, math
sys.path.insert(0, HERE); import bt
by, bars, rug = bt.load()
ts = sorted(s["t"] for v in by.values() for s in v)
T0, T1 = ts[0], ts[-1]; SPLIT = T0 + (T1 - T0) * float(os.environ.get("SPLIT", 0.6))
print(f"Pools {len(by)} · Snapshots {len(ts)} · Zeitraum {(T1-T0)/60:.0f} Min · Split bei {(SPLIT-T0)/60:.0f} Min")
bp = lambda s: s["b5"] / max(1, s["b5"] + s["s5"])
tx = lambda s: s["b5"] + s["s5"]
def rugok(r, strict=True):
    if r is None: return not strict
    if r.get("rugged") or r.get("mintA") or r.get("freeze"): return False
    if r.get("top10", 0) > 40 or r.get("top1", 0) > 15 or r.get("clmax", 0) >= 18: return False
    ps = [p for p in r.get("pcts", []) if p >= 0.8]
    for c in ps:
        g = [x for x in ps if abs(x - c) / c <= 0.06]
        if len(g) >= 4 and sum(g) >= 6: return False
    if any("rugged" in (x or "").lower() for x in r.get("risks", [])): return False
    return True
def cur_score(s):  # aktuelle Bot-Logik (Preset normal) für GT-Pools
    if s["liq"] < 25000 or (s.get("age") is not None and s["age"] < 3): return None
    if s["fdv"] and s["fdv"] / max(s["liq"], 1) > 80: return None
    if tx(s) < 15 or s["h1"] > 500 or bp(s) < 0.5 or s["m5"] < -3: return None
    if s["by5"] and s["b5"] / s["by5"] > 4: return None
    return 1.2 + s["m5"] / 4 + min(s["h1"], 150) / 50 + (bp(s) - 0.5) * 6 + min(s["v5"] / max(s["liq"], 1) * 15, 1.5)
E_FAM = {
  "aktuell(Bot)": lambda s, r: (cur_score(s) or 0) >= 3.0 and rugok(r),
  "aktuell ohne Rug": lambda s, r: (cur_score(s) or 0) >= 3.0,
}
# Parametrisierte Einstiege
def mk_mom(liq, m5lo, m5hi, h1lo, h1hi, bpmin, txmin, rg):
    return lambda s, r: s["liq"] >= liq and m5lo <= s["m5"] <= m5hi and h1lo <= s["h1"] <= h1hi and bp(s) >= bpmin and tx(s) >= txmin and (not rg or rugok(r))
GRID_E = {}
for liq in (12000, 25000, 60000):
  for (m5lo, m5hi) in ((-100, -5), (-5, 0), (0, 5), (5, 20), (2, 100), (-100, 100)):
    for (h1lo, h1hi) in ((-100, 0), (0, 50), (50, 300), (-100, 1e9)):
      for bpmin in (0, 0.55):
        for rg in (True,):
          GRID_E[f"liq≥{liq//1000}k m5[{m5lo},{m5hi}] h1[{h1lo},{h1hi if h1hi<1e8 else '∞'}] bp≥{bpmin}"] = mk_mom(liq, m5lo, m5hi, h1lo, h1hi, bpmin, 15, rg)
GRID_P = [dict(tp=tp, sl=sl, tmax=tm, trail_on=tr[0], trail=tr[1]) for tp in (8, 15, 25, 50, 0) for sl in (5, 10, 20, 40) for tm in (10, 30, 90) for tr in ((None, None), (10, 5), (25, 10))]
CUR_P = dict(tp=30, sl=12, tmax=60, trail_on=12, trail=6)
def show(name, tr, tr2=None):
    a = bt.stats(tr); b = bt.stats(tr2) if tr2 is not None else None
    f = lambda x: f"n={x['n']:3d} Ø {x['mean']:+6.2f}% [{x['lo']:+.1f},{x['hi']:+.1f}] Treffer {x['win']:4.0f}% Σ {x['sum']:+.2f} SOL"
    print(f"{name[:58]:58s} | Train {f(a)}" + (f" | Test {f(b)}" if b else ""))
if __name__ == "__main__":
    print("\n== Vergleich: aktuelle Bot-Strategie (Preset normal) ==")
    for nm, E in E_FAM.items():
        show(nm, bt.run(by, bars, rug, E, CUR_P, T0, SPLIT), bt.run(by, bars, rug, E, CUR_P, SPLIT, 1e18))
    print("\n== Suche (Auswahl nur nach Train, mind. 25 Trades) ==")
    res = []
    for en, E in GRID_E.items():
        # Einstiege einmal vorfiltern spart Zeit: gleiche Signale, verschiedene Exits
        for P in GRID_P:
            tr = bt.run(by, bars, rug, E, P, T0, SPLIT)
            if len(tr) < int(os.environ.get("MINN", 25)): continue
            st = bt.stats(tr); res.append((st["mean"], st["lo"], en, P, st))
    res.sort(key=lambda x: -x[1])  # nach unterer Konfidenzgrenze (vorsichtig)
    print(f"{len(res)} Kombinationen bewertet")
    for mean, lo, en, P, st in res[:15]:
        show(f"{en} | {P}", bt.run(by, bars, rug, GRID_E[en], P, T0, SPLIT), bt.run(by, bars, rug, GRID_E[en], P, SPLIT, 1e18))
    json.dump([(en, P) for _, _, en, P, _ in res[:40]], open(_os.path.join(DATA, 'top.json'), "w"))
