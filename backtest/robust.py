# Robuste Auswahl: 3 Zeitabschnitte, getrimmter Mittelwert (beste 10 % der Trades entfernt), Mindestanzahl je Abschnitt.
import os as _os; HERE = _os.path.dirname(_os.path.abspath(__file__)); DATA = _os.environ.get("BT", _os.path.join(HERE, "daten"))
import sys, os, json
sys.argv = ['x']; sys.path.insert(0, HERE)
exec(open(_os.path.join(HERE, 'search.py')).read().split('if __name__')[0])
K = 3; edges = [T0 + (T1 - T0) * i / K for i in range(K + 1)]; edges[-1] += 1
def trim(tr, q=0.1):
    xs = sorted(t["net"] for t in tr)
    if not xs: return 0
    k = max(1, int(len(xs) * (1 - q))) if len(xs) >= 5 else len(xs)
    return 100 * sum(xs[:k]) / k
def med(tr):
    xs = sorted(t["net"] for t in tr); return 100 * xs[len(xs) // 2] if xs else 0
def evalc(E, P):
    folds = [bt.run(by, bars, rug, E, P, edges[i], edges[i + 1]) for i in range(K)]
    return folds
MINF = int(os.environ.get("MINF", 6))
out = []
EX = dict(E_FAM); EX.update(GRID_E)
for en, E in EX.items():
    for P in [CUR_P] + GRID_P:
        f = evalc(E, P)
        if min(len(x) for x in f) < MINF: continue
        tm = [trim(x) for x in f]
        out.append((min(tm), sum(tm) / K, en, P, [len(x) for x in f], tm, [med(x) for x in f]))
out.sort(key=lambda x: -x[0])
print(f"{len(out)} Kombinationen mit ≥{MINF} Trades in jedem Abschnitt")
print("Rang | schlechtester Abschnitt (getrimmt) | Ø | Trades je Abschnitt | Median je Abschnitt | Strategie")
for r in out[:20]:
    print(f"{r[0]:+6.2f}% | Ø {r[1]:+6.2f}% | n {r[4]} | getrimmt {[round(x,1) for x in r[5]]} | Median {[round(x,1) for x in r[6]]} | {r[2]} | {r[3]}")
base = [x for x in out if x[2] == "aktuell(Bot)" and x[3] == CUR_P]
print("\nAKTUELLER BOT:", base[0][:2] if base else "zu wenige Trades", base[0][4:7] if base else "")
json.dump([(r[2], r[3], r[0], r[1], r[4]) for r in out[:60]], open(_os.path.join(DATA, 'robust_top.json'), 'w'))
