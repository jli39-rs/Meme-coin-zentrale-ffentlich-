# Forward-Datensammlung: jede Minute die Kandidaten, die auch der Bot sieht (GT new/trending, DexScreener-Profile/Boosts),
# mit allen Entscheidungsdaten zum Zeitpunkt t. Kein Blick in die Zukunft.
import os as _os; HERE = _os.path.dirname(_os.path.abspath(__file__)); DATA = _os.environ.get("BT", _os.path.join(HERE, "daten"))
import json, time, urllib.request, sys, datetime
OUT = _os.path.join(DATA, 'snaps.jsonl'); RC = _os.path.join(DATA, 'rug.jsonl')
DUR = float(sys.argv[1]) * 60
GT = "https://api.geckoterminal.com/api/v2/networks/solana"
NOT = {"So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"}
def get(u):
    for i in range(3):
        try:
            with urllib.request.urlopen(u, timeout=20) as r: return json.load(r)
        except Exception as e:
            if "429" in str(e): time.sleep(6)
            else: time.sleep(2)
    return None
def f(x):
    try: return float(x or 0)
    except: return 0.0
seen_rug = set(); t0 = time.time(); n = 0
def gt_rows(js, src):
    rows = []
    if not js: return rows
    inc = {t["id"]: t["attributes"] for t in js.get("included", [])}
    now = time.time()
    for p in js.get("data", []):
        a = p["attributes"]; tid = p["relationships"]["base_token"]["data"]["id"]; mint = tid.split("_", 1)[1]
        if mint in NOT: continue
        pc, tx, vol = a.get("price_change_percentage") or {}, a.get("transactions") or {}, a.get("volume_usd") or {}
        age = (now - datetime.datetime.fromisoformat(a["pool_created_at"].replace("Z", "+00:00")).timestamp()) / 60 if a.get("pool_created_at") else None
        rows.append(dict(t=now, src=src, pool=a["address"], mint=mint, sym=(inc.get(tid) or {}).get("symbol"), price=f(a["base_token_price_usd"]), liq=f(a.get("reserve_in_usd")),
            fdv=f(a.get("fdv_usd")), mcap=f(a.get("market_cap_usd")), age=age,
            m5=f(pc.get("m5")), m15=f(pc.get("m15")), m30=f(pc.get("m30")), h1=f(pc.get("h1")), h6=f(pc.get("h6")), h24=f(pc.get("h24")),
            b5=(tx.get("m5") or {}).get("buys", 0), s5=(tx.get("m5") or {}).get("sells", 0), by5=(tx.get("m5") or {}).get("buyers", 0), se5=(tx.get("m5") or {}).get("sellers", 0),
            b15=(tx.get("m15") or {}).get("buys", 0), s15=(tx.get("m15") or {}).get("sells", 0), b1=(tx.get("h1") or {}).get("buys", 0), s1=(tx.get("h1") or {}).get("sells", 0),
            v5=f(vol.get("m5")), v15=f(vol.get("m15")), v1=f(vol.get("h1")), v24=f(vol.get("h24"))))
    return rows
while time.time() - t0 < DUR:
    ts = time.time(); rows = []
    rows += gt_rows(get(f"{GT}/new_pools?include=base_token&page=1"), "new"); time.sleep(2.2)
    for pg in (1, 2, 3):
        rows += gt_rows(get(f"{GT}/trending_pools?include=base_token&page={pg}"), "trend"); time.sleep(2.2)
    with open(OUT, "a") as fh:
        for r in rows: fh.write(json.dumps(r) + "\n")
    # RugCheck einmal je neuem Kandidaten mit Liquidität (Rug-Merkmale zum Beobachtungszeitpunkt)
    for r in rows:
        if r["mint"] in seen_rug or r["liq"] < 10000: continue
        seen_rug.add(r["mint"])
        rep = get(f"https://api.rugcheck.xyz/v1/tokens/{r['mint']}/report")
        if rep:
            tok = rep.get("token") or {}; sup = f(tok.get("supply")) or 1
            ka = rep.get("knownAccounts") or {}
            hs = [h for h in rep.get("topHolders") or [] if not (ka.get(h.get("owner")) or {}).get("type") in ("AMM", "LOCKER")]
            nets = [n for n in rep.get("insiderNetworks") or [] if (n.get("size") or 0) <= 1000]
            pcts = sorted([h.get("pct", 0) for h in hs], reverse=True)
            with open(RC, "a") as fh:
                fh.write(json.dumps(dict(t=time.time(), mint=r["mint"], score=rep.get("score_normalised"), rugged=rep.get("rugged"), mintA=bool(tok.get("mintAuthority")), freeze=bool(tok.get("freezeAuthority")),
                    top1=pcts[0] if pcts else 0, top10=sum(pcts[:10]), holders=rep.get("totalHolders"), clmax=max([100 * f(n.get("currentHolding")) / sup for n in nets] or [0]),
                    pcts=pcts[:20], risks=[x.get("name") for x in rep.get("risks") or [] if x.get("level") == "danger"])) + "\n")
        time.sleep(1.2)
        if time.time() - ts > 50: break
    n += 1
    print(f"Runde {n}: {len(rows)} Zeilen, {len(seen_rug)} Rug-Checks, {int((time.time()-t0)/60)} Min", flush=True)
    time.sleep(max(1, 60 - (time.time() - ts)))
print("fertig", flush=True)
