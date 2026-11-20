# Holt 1-Min-Kerzen (GeckoTerminal, bis 1000 Min zurück) für alle beobachteten Kandidaten-Pools (liq >= MINLIQ).
# Ein Pool wird geholt, sobald seit seiner ersten Beobachtung >= WAIT Minuten vergangen sind (genug "Zukunft"), sonst am Ende (--final).
import os as _os; HERE = _os.path.dirname(_os.path.abspath(__file__)); DATA = _os.environ.get("BT", _os.path.join(HERE, "daten"))
import json, time, urllib.request, sys, os
BT = DATA; GT = "https://api.geckoterminal.com/api/v2/networks/solana"
MINLIQ = 12000; WAIT = float(os.environ.get("WAIT", 125)); GAP = float(os.environ.get("GAP", 4.0))
final = "--final" in sys.argv; until = time.time() + float(os.environ.get("MAXMIN", 200)) * 60
os.makedirs(f"{BT}/ohlcv", exist_ok=True)
def get(u):
    for i in range(4):
        try:
            with urllib.request.urlopen(u, timeout=25) as r: return json.load(r)
        except Exception as e:
            if "429" in str(e): time.sleep(10)
            elif "404" in str(e): return {"missing": True}
            else: time.sleep(3)
    return None
while time.time() < until:
    first = {}
    for line in open(f"{BT}/snaps.jsonl"):
        r = json.loads(line)
        if r["liq"] >= MINLIQ and r["pool"] not in first: first[r["pool"]] = r["t"]
    todo = [p for p, t in sorted(first.items(), key=lambda x: x[1]) if not os.path.exists(f"{BT}/ohlcv/{p}.json") and (final or time.time() - t >= WAIT * 60)]
    if not todo:
        if final: break
        time.sleep(30); continue
    for p in todo[:20]:
        d = get(f"{GT}/pools/{p}/ohlcv/minute?aggregate=1&limit=1000&currency=usd")
        if d is not None:
            bars = (d.get("data") or {}).get("attributes", {}).get("ohlcv_list", []) if not d.get("missing") else []
            json.dump(sorted(bars), open(f"{BT}/ohlcv/{p}.json", "w"))
        time.sleep(GAP)
    print(time.strftime("%H:%M"), "Pools gesamt", len(first), "geholt", len(os.listdir(f"{BT}/ohlcv")), flush=True)
print("fertig", flush=True)
