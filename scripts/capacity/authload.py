import urllib.request, urllib.error, time, threading, random, json, sys, socket, os

CONC = int(sys.argv[1])
DUR = float(sys.argv[2])
rows = json.load(open("/tmp/cohort.json"))

# weighted endpoint mix (template, weight, needs_pid)
EP = [
    ("/api/auth/me", 8, False),
    ("/api/projects", 4, False),
    ("/api/projects/{pid}", 8, True),
    ("/api/projects/{pid}/dashboard", 10, True),
    ("/api/projects/{pid}/analysis", 10, True),
    ("/api/projects/{pid}/strategy", 6, True),
    ("/api/projects/{pid}/content", 12, True),
    ("/api/projects/{pid}/social-posts", 6, True),
    ("/api/projects/{pid}/campaigns", 12, True),
    ("/api/projects/{pid}/videos", 10, True),
    ("/api/projects/{pid}/competitors", 5, True),
    ("/api/projects/{pid}/usage", 5, True),
    ("/api/projects/{pid}/autonomous/decisions", 4, True),
]
total_w = sum(w for _, w, _ in EP)

lat = []
lock = threading.Lock()
stop = time.time() + DUR
timeout = 30

def pick():
    x = random.randint(0, total_w - 1)
    for path, w, needs in EP:
        if x < w:
            return path, needs
        x -= w
    return EP[0][0], EP[0][2]

def worker(i):
    u = rows[i % len(rows)]
    cookie = u["cookie"]; pid = u["project_id"]
    while time.time() < stop:
        path, needs = pick()
        url = os.environ.get("API_BASE", "http://127.0.0.1:4001") + (path.format(pid=pid) if needs else path)
        t0 = time.time()
        st = -1
        try:
            req = urllib.request.Request(url, headers={"Cookie": cookie})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                st = r.status
                r.read()
        except urllib.error.HTTPError as e:
            st = e.code
            e.read()
        except Exception:
            st = -1
        dt = (time.time() - t0) * 1000.0
        with lock:
            lat.append((st, dt))

threads = [threading.Thread(target=worker, args=(i,)) for i in range(CONC)]
t0 = time.time()
for t in threads: t.start()
for t in threads: t.join()
elapsed = time.time() - t0

dts = sorted(d for _, d in lat)
def pct(p):
    return dts[min(int(len(dts) * p), len(dts) - 1)] if dts else 0.0
from collections import Counter
cnt = Counter(s for s, _ in lat)
tot = len(lat)
ok = cnt.get(200, 0)
err5 = sum(v for k, v in cnt.items() if k >= 500)
err4 = sum(v for k, v in cnt.items() if k in (429, 401, 403))
neterr = cnt.get(-1, 0)
print("RESULT c=%d tot=%d tput=%.1f/s 200=%d 401=%d 403=%d 404=%d 429=%d 5xx=%d neterr=%d" % (
    CONC, tot, tot / elapsed if elapsed else 0, ok, cnt.get(401,0), cnt.get(403,0), cnt.get(404,0), cnt.get(429,0), err5, neterr))
print("LAT p50=%.1f p95=%.1f p99=%.1f max=%.1f ms" % (pct(0.5), pct(0.95), pct(0.99), dts[-1] if dts else 0))
