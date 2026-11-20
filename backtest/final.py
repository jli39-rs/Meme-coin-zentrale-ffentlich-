import os as _os; HERE = _os.path.dirname(_os.path.abspath(__file__)); DATA = _os.environ.get("BT", _os.path.join(HERE, "daten"))
import sys; sys.argv=['x']; sys.path.insert(0, HERE)
exec(open(_os.path.join(HERE, 'search.py')).read().split('if __name__')[0])
K=3; edges=[T0+(T1-T0)*i/K for i in range(K+1)]; edges[-1]+=1
def rule(liq,amin,m5,bpm):
  def E(s,r):
    if s['liq']<liq or (s.get('age') is not None and s['age']<amin): return False
    if s['fdv'] and s['fdv']/max(s['liq'],1)>80: return False
    if tx(s)<15 or s['h1']>500 or bp(s)<bpm or s['m5']<m5: return False
    if s['by5'] and s['b5']/s['by5']>4: return False
    return rugok(r)
  return E
def f(tr):
    st=bt.stats(tr); return f"n={st['n']:3d} Ø{st['mean']:+5.1f}% [{st['lo']:+.1f},{st['hi']:+.1f}] Treffer {st['win']:.0f}% Σ{st['sum']:+.2f} SOL"
for liq in (40000,60000,100000):
 for amin in (3,60):
  for m5 in (1,2,4):
   for bpm in (0.5,0.55,0.6):
    for P in (dict(tp=8,sl=20,tmax=10),dict(tp=6,sl=20,tmax=10),dict(tp=10,sl=20,tmax=15)):
      E=rule(liq,amin,m5,bpm); al=bt.run(by,bars,rug,E,P); fs=[bt.run(by,bars,rug,E,P,edges[i],edges[i+1]) for i in range(K)]
      print(f"liq≥{liq//1000}k Alter≥{amin} m5≥{m5} bp≥{bpm} {P}: {f(al)} | "+" / ".join(f"{bt.stats(x)['mean']:+.1f}%({len(x)})" for x in fs))
