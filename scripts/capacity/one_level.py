import subprocess, time, sys

c = int(sys.argv[1]); dur = int(sys.argv[2])
db=None
for line in open(".env"):
    line=line.strip()
    if line.startswith("DATABASE_URL="):
        db=line.split("=",1)[1].strip().strip(chr(34)).strip(chr(39))
def q(sql):
    return subprocess.run(["psql",db,"-t","-A","-c",sql],capture_output=True,text=True).stdout.strip()
def loadavg(): return float(open("/proc/loadavg").read().split()[0])
def memavail(): return int([l for l in open("/proc/meminfo") if l.startswith("MemAvailable:")][0].split()[1])/1024.0
def dbconn(): return int(q("SELECT count(*) FROM pg_stat_activity;") or 0)
def slowq():
    return int(q("SELECT count(*) FROM pg_stat_activity WHERE state="+chr(39)+"active"+chr(39)+" AND now()-query_start > interval "+chr(39)+"500 ms"+chr(39)+";") or 0)
def apirss():
    pid=subprocess.run(["systemctl","show","growthforge-dev-api","-p","MainPID","--value"],capture_output=True,text=True).stdout.strip()
    try: return int([l for l in open("/proc/%s/status"%pid) if l.startswith("VmRSS:")][0].split()[1])/1024.0
    except Exception: return 0.0

lb0=loadavg(); mb0=memavail(); cb0=dbconn(); rss0=apirss()
p=subprocess.Popen(["python3","/tmp/authload.py",str(c),str(dur)],stdout=subprocess.PIPE,text=True)
peak={"load":lb0,"dbconn":cb0,"slowq":0,"rss":rss0}
n=samples=dur//20
for _ in range(max(1,samples)):
    time.sleep(20)
    peak["load"]=max(peak["load"],loadavg())
    peak["dbconn"]=max(peak["dbconn"],dbconn())
    peak["slowq"]=max(peak["slowq"],slowq())
    peak["rss"]=max(peak["rss"],apirss())
out,_=p.communicate()
lb1=loadavg(); mb1=memavail(); cb1=dbconn()
print("RES c=%d | load b/p/a %.2f/%.2f/%.2f | memAvail b/a %.0f/%.0fMB | dbconn b/p/a %d/%d/%d | slowq>500ms peak %d | apiRSS b/p %.0f/%.0fMB" % (
    c, lb0, peak["load"], lb1, mb0, mb1, cb0, peak["dbconn"], cb1, peak["slowq"], rss0, peak["rss"]))
print(out.strip())
