#!/usr/bin/env python3
"""Open-loop arrival-rate load generator (GrowthForge 2000-user capacity test).
Offers requests at a controlled Poisson arrival rate with warmup/cooldown ramp,
using N distinct synthetic users. Reports offered vs completed RPS, latency
percentiles, error/timeout rates, and system (load/mem/RSS/DB) samples.
"""
import json, time, threading, random, os, sys, subprocess
import urllib.request, urllib.error
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

TARGET = float(sys.argv[1])
DUR = float(sys.argv[2])
PROFILE = sys.argv[3]

rows = json.load(open("/tmp/cohort.json"))
NUSERS = len(rows)
API = os.environ.get("API_BASE", "http://127.0.0.1:4001")

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
TW = sum(w for _, w, _ in EP)
WARMUP = 60.0
COOLDOWN = 30.0
TIMEOUT = 30.0

def db_url():
    for line in open("/home/ubuntu/dev/app/.env"):
        line = line.strip()
        if line.startswith("DATABASE_URL="):
            d = line.split("=", 1)[1].strip().strip('"').strip("'")
            return d.replace("&uselibpqcompat=true", "").replace("?uselibpqcompat=true", "")
    return None
DBURL = db_url()

def q(sql):
    try:
        return subprocess.run(["psql", DBURL, "-t", "-A", "-c", sql],
                              capture_output=True, text=True, timeout=12).stdout.strip()
    except Exception:
        return "-1"

lock = threading.Lock()
offered = 0
lat = []
t0 = None
sys_samples = []

def pick():
    x = random.randint(0, TW - 1)
    for path, w, needs in EP:
        if x < w:
            return path, needs
        x -= w
    return EP[0][0], EP[0][2]

def phase(arrival):
    el = arrival - t0
    if el < WARMUP:
        return "warmup"
    if el > WARMUP + DUR:
        return "cooldown"
    return "steady"

def fire(arrival, u):
    cookie = u["cookie"]; pid = u["project_id"]
    path, needs = pick()
    url = API + (path.format(pid=pid) if needs else path)
    st = -1
    try:
        req = urllib.request.Request(url, headers={"Cookie": cookie})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            st = r.status
            r.read()
    except urllib.error.HTTPError as e:
        st = e.code
        try: e.read()
        except Exception: pass
    except Exception:
        st = -1
    e2e = (time.time() - arrival) * 1000.0
    with lock:
        lat.append((st, e2e, phase(arrival)))

def apirss():
    try:
        pid = subprocess.run(["systemctl", "show", "growthforge-dev-api", "-p", "MainPID", "--value"],
                             capture_output=True, text=True).stdout.strip()
        return int([l for l in open("/proc/%s/status" % pid) if l.startswith("VmRSS:")][0].split()[1]) / 1024.0
    except Exception:
        return 0.0

def sampler(stop_evt):
    while not stop_evt.is_set():
        try:
            l1 = float(open("/proc/loadavg").read().split()[0])
            ma = int([l for l in open("/proc/meminfo") if l.startswith("MemAvailable:")][0].split()[1]) / 1024.0
            rss = apirss()
            conns = q("SELECT count(*) FROM pg_stat_activity WHERE datname='growthforge_dev';")
            slow = q("SELECT count(*) FROM pg_stat_activity WHERE datname='growthforge_dev' AND state='active' AND now()-query_start > interval '500 ms';")
            with lock:
                sys_samples.append((time.time(), l1, ma, rss, conns, slow))
        except Exception:
            pass
        stop_evt.wait(20.0)

def pct(vals, p):
    if not vals:
        return 0.0
    return vals[min(int(len(vals) * p), len(vals) - 1)]

def summarize(label, subset):
    dts = sorted(d for _, d, _ in subset)
    cnt = Counter(s for s, _, _ in subset)
    tot = len(subset)
    ok = cnt.get(200, 0)
    err5 = sum(v for k, v in cnt.items() if k >= 500)
    neterr = cnt.get(-1, 0)
    print("SUMMARY[%s] n=%d 200=%d 401=%d 403=%d 404=%d 429=%d 5xx=%d timeout=%d" % (
        label, tot, ok, cnt.get(401, 0), cnt.get(403, 0), cnt.get(404, 0), cnt.get(429, 0), err5, neterr))
    print("LAT[%s] p50=%.1f p95=%.1f p99=%.1f max=%.1f ms" % (label, pct(dts, 0.5), pct(dts, 0.95), pct(dts, 0.99), dts[-1] if dts else 0))

def main():
    global offered, t0
    t0 = time.time()
    start = t0
    end = start + WARMUP + DUR + COOLDOWN
    workers = min(1200, max(200, int(TARGET * 3)))
    stop_evt = threading.Event()
    smp = threading.Thread(target=sampler, args=(stop_evt,), daemon=True)
    smp.start()
    ex = ThreadPoolExecutor(max_workers=workers)
    while time.time() < end:
        el = time.time() - start
        if el < WARMUP:
            frac = 0.2 + 0.8 * (el / WARMUP)
        elif el > WARMUP + DUR:
            frac = max(0.0, 1.0 - (el - WARMUP - DUR) / COOLDOWN)
        else:
            frac = 1.0
        rate = TARGET * frac
        offered += 1
        ex.submit(fire, time.time(), random.choice(rows))
        if rate > 0:
            time.sleep(random.expovariate(rate))
    ex.shutdown(wait=True)
    stop_evt.set(); smp.join(timeout=3)
    elapsed = time.time() - start
    with lock:
        alllat = list(lat)
        samples = list(sys_samples)
    steady = [x for x in alllat if x[2] == "steady"]
    print("RESULT profile=%s target=%.0f/s users=%d workers=%d elapsed=%.0fs offered=%d offered_rps=%.1f completed=%d completed_rps=%.1f" % (
        PROFILE, TARGET, NUSERS, workers, elapsed, offered, offered / elapsed, len(alllat), len(alllat) / elapsed))
    summarize("OVERALL", alllat)
    summarize("STEADY", steady)
    if samples:
        loads = [s[1] for s in samples]; mems = [s[2] for s in samples]; rsss = [s[3] for s in samples]
        conns = [int(s[4]) for s in samples if str(s[4]).lstrip("-").isdigit()]
        slows = [int(s[5]) for s in samples if str(s[5]).lstrip("-").isdigit()]
        print("SYS load_peak=%.2f load_avg=%.2f memavail_min=%.0fMB apiRSS_max=%.0fMB dbconns_max=%d db_slow_peak=%d" % (
            max(loads), sum(loads) / len(loads), min(mems), max(rsss), max(conns) if conns else -1, max(slows) if slows else -1))

if __name__ == "__main__":
    main()
