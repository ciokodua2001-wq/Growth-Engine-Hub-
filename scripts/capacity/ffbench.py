import subprocess, time, threading, sys

N = int(sys.argv[1])
# representative "assembly": concat 4 x 10s scenes -> 40s 720p output, re-encode h264+aac
cmd_tmpl = ["ffmpeg","-hide_banner","-loglevel","error","-y",
    "-f","lavfi","-i","testsrc=duration=10:size=1280x720:rate=30",
    "-f","lavfi","-i","testsrc=duration=10:size=1280x720:rate=30",
    "-f","lavfi","-i","testsrc=duration=10:size=1280x720:rate=30",
    "-f","lavfi","-i","testsrc=duration=10:size=1280x720:rate=30",
    "-filter_complex","concat=n=4:v=1:a=0[v]","-map","[v]",
    "-c:v","libx264","-preset","medium","-crf","23","-shortest"]

results = []
lock = threading.Lock()
def runjob(i):
    t0 = time.time()
    r = subprocess.run(cmd_tmpl + ["/tmp/asm_%d.mp4" % i], capture_output=True, text=True)
    dt = time.time() - t0
    with lock:
        results.append((i, dt, r.returncode))

t0 = time.time()
threads = [threading.Thread(target=runjob, args=(i,)) for i in range(N)]
for t in threads: t.start()
for t in threads: t.join()
wall = time.time() - t0
dts = sorted(d for _, d, _ in results)
def pct(p): return dts[min(int(len(dts)*p), len(dts)-1)] if dts else 0
print("FFBENCH N=%d wall=%.1fs per_job_p50=%.1fs p95=%.1fs max=%.1fs rc_ok=%d/%d" % (
    N, wall, pct(0.5), pct(0.95), dts[-1] if dts else 0, sum(1 for _,_,rc in results if rc==0), N))
