# Familie "frisch migrierte Pools": Basisrate und robuste Prüfung über 3 Zeitabschnitte
import os as _os; HERE = _os.path.dirname(_os.path.abspath(__file__)); DATA = _os.environ.get("BT", _os.path.join(HERE, "daten"))
import sys,os,json,itertools; sys.argv=['x']; sys.path.insert(0, HERE)
exec(open(_os.path.join(HERE, 'search.py')).read().split('if __name__')[0])
K=3; edges=[T0+(T1-T0)*i/K for i in range(K+1)]; edges[-1]+=1
def mk(amax,liq,m5lo,m5hi,bpmin,rg=True):
    return lambda s,r: s.get('age') is not None and s['age']<=amax and s['liq']>=liq and m5lo<=s['m5']<=m5hi and bp(s)>=bpmin and (not rg or rugok(r))
def f(tr):
    st=bt.stats(tr); return f"n={st['n']:3d} Ø{st['mean']:+6.1f}% [{st['lo']:+.1f},{st['hi']:+.1f}] Tr {st['win']:3.0f}% Σ{st['sum']:+.2f}"
def folds(E,P): return [bt.run(by,bars,rug,E,P,edges[i],edges[i+1]) for i in range(K)]
print("Basisrate: jeder neue Pool (Alter≤5 Min, liq≥12k), 10 Min halten")
for rg in (True,False):
  for amax in (3,5,10,30):
    E=mk(amax,12000,-100,1000,0,rg); P=dict(tp=0,sl=90,tmax=10)
    print(f" rug={'an ' if rg else 'aus'} Alter≤{amax:2d}: ", " | ".join(f(x) for x in folds(E,P)))
print("\nRaster (alle 3 Abschnitte):")
res=[]
for amax,liq,(lo,hi),bpm in itertools.product((3,5),(12000,25000),((-100,1000),(0,1000),(2,1000),(0,30)),(0,0.55)):
  E=mk(amax,liq,lo,hi,bpm)
  for tp,sl,tm,tr in itertools.product((0,25,50,100),(15,25,40),(5,10,15,20,30),((None,None),(30,15))):
    P=dict(tp=tp,sl=sl,tmax=tm,trail_on=tr[0],trail=tr[1]); fs=folds(E,P)
    if min(len(x) for x in fs)<5: continue
    ms=[bt.stats(x)['mean'] for x in fs]; med=[sorted(t['net'] for t in x)[len(x)//2]*100 for x in fs]
    res.append((min(ms),min(med),(amax,liq,lo,hi,bpm),P,[len(x) for x in fs],[round(m,1) for m in ms],[round(m,1) for m in med]))
res.sort(key=lambda x:-(x[0]+x[1]))
for r in res[:15]: print(r)
json.dump([[r[2],r[3]] for r in res[:30]],open(_os.path.join(DATA, 'newpool_top.json'),'w'))
# Nachbarschaft: wie empfindlich ist tmax?
