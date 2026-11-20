import os as _os; HERE = _os.path.dirname(_os.path.abspath(__file__)); DATA = _os.environ.get("BT", _os.path.join(HERE, "daten"))
import sys; sys.argv=['x']; sys.path.insert(0, HERE)
exec(open(_os.path.join(HERE, 'search.py')).read().split('if __name__')[0])
K=3; edges=[T0+(T1-T0)*i/K for i in range(K+1)]; edges[-1]+=1
def f(tr):
    st=bt.stats(tr); return f"n={st['n']:3d} Ø{st['mean']:+6.1f}% [{st['lo']:+.1f},{st['hi']:+.1f}] Σ{st['sum']:+.2f}"
def row(nm,E,P):
    al=bt.run(by,bars,rug,E,P); fs=[bt.run(by,bars,rug,E,P,edges[i],edges[i+1]) for i in range(K)]
    print(f"{nm:52s} gesamt {f(al)} | Abschn. "+" / ".join(f"{bt.stats(x)['mean']:+.1f}%({len(x)})" for x in fs))
NEW=dict(tp=8,sl=20,tmax=10)
cur=lambda s,r:(cur_score(s) or 0)>=3.0 and rugok(r)
old=lambda a:(lambda s,r: s.get('age') is not None and s['age']>=a)
for P,pn in ((CUR_P,'jetzige Exits'),(NEW,'TP8/SL20/10Min'),(dict(tp=15,sl=12,tmax=20),'TP15/SL12/20Min'),(dict(tp=8,sl=12,tmax=10),'TP8/SL12/10Min')):
  print('==',pn)
  row('jetziger Bot-Einstieg',cur,P)
  for a in (60,360,1440):
    row(f'jetziger Einstieg + Alter≥{a} Min',lambda s,r,a=a:cur(s,r) and old(a)(s,r),P)
  row('liq≥60k m5≥2 bp≥0.55 rug ok',lambda s,r:s['liq']>=60000 and s['m5']>=2 and bp(s)>=0.55 and tx(s)>=15 and rugok(r),P)
  row('liq≥60k m5≥2 bp≥0.55 rug ok Alter≥60',lambda s,r:s['liq']>=60000 and s['m5']>=2 and bp(s)>=0.55 and tx(s)>=15 and rugok(r) and old(60)(s,r),P)
  row('Zufall: liq≥25k rug ok Alter≥60',lambda s,r:s['liq']>=25000 and rugok(r) and old(60)(s,r),P)
