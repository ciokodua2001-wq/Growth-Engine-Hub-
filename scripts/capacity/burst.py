#!/usr/bin/env python3
"""Phase 4 burst test: moderate baseline -> 1.5x -> 2x bursts -> recovery."""
import json, time, random, os, sys
import urllib.request, urllib.error
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

rows = json.load(open("/tmp/cohort.json"))
API = os.environ.get("API_BASE", "http://127.0.0.1:4001")
EP = [
    ("/api/auth/me", 8, False), ("/api/projects", 4, False),
    ("/api/projects/{pid}", 8, True), ("/api/projects/{pid}/dashboard", 10, True),
    ("/api/projects/{pid}/analysis", 10, True), ("/api/projects/{pid}/strategy", 6, True),
    ("/api/projects/{pid}/content", 12, True), ("/api/projects/{pid}/social-posts", 6, True),
    ("/api/projects/{pid}/campaigns", 12, True), ("/api/projects/{pid}/videos", 10, True),
    ("/api/projects/{pid}/competitors", 5, True), ("/api/projects/{pid}/usage", 5, True),
    ("/api/projects/{pid}/autonomous/decisions", 4, True),
]
TW = sum(w for _, w, _ in EP)
TIMEOUT = 30
SCHED = [
    ("baseline200", 90, 200),
    ("burst300_1.5x", 45, 300),
    ("recover200a", 60, 200),
    ("burst400_2x", 45, 400),
    ("recover200b", 90, 200),
]
lock = __import__("threading").Lock()
seg = {}

def pick():
    x = random.randint(0, TW - 1)
    for path, w, needs in EP:
        if x < w: return path, needs
        x -= w
    return EP[0][0], EP[0][2]

def fire(arrival, u, label):
    cookie = u["cookie"]; pid = u["project_id"]
    path, needs = pick()
    url = API + (path.format(pid=pid) if needs else path)
    st = -1
    try:
        req = urllib.request.Request(url, headers={"Cookie": cookie})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            st = r.status; r.read()
    except urllib.error.HTTPError as e:
        st = e.code
        try: e.read()
        except Exception: pass
    except Exception:
        st = -1
    e2e = (time.time() - arrival) * 1000.0
    with lock:
        seg[label]["lat"].append((st, e2e))

def pct(v, p):
    return v[min(int(len(v)*p), len(v)-1)] if v else 0.0

def main():
    ex = ThreadPoolExecutor(max_workers=900)
    t0 = time.time()
    for label, dur, rate in SCHED:
        seg[label] = {"offered": 0, "completed": 0, "lat": [], "err": Counter()}
        end = time.time() + dur
        while time.time() < end:
            seg[label]["offered"] += 1
            ex.submit(fire, time.time(), random.choice(rows), label)
            time.sleep(random.expovariate(rate))
        # drain: wait for in-flight of this segment to mostly finish
        time.sleep(5)
    ex.shutdown(wait=True)
    print("BURST_RESULT")
    for label, dur, rate in SCHED:
        s = seg[label]
        dts = sorted(d for _, d in s["lat"])
        cnt = Counter(st for st, _ in s["lat"])
        err5 = sum(v for k, v in cnt.items() if k >= 500)
        neterr = cnt.get(-1, 0)
        comp = len(s["lat"])
        print("SEG %s offered=%d completed=%d offered_rps=%.1f completed_rps=%.1f p50=%.0f p95=%.0f p99=%.0f max=%.0f 5xx=%d timeout=%d" % (
            label, s["offered"], comp, s["offered"]/dur, comp/dur,
            pct(dts,0.5), pct(dts,0.95), pct(dts,0.99), dts[-1] if dts else 0, err5, neterr))

if __name__ == "__main__":
    main()
