#!/usr/bin/env python3
import json, os, sys, time, urllib.request, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "output")
os.makedirs(OUT, exist_ok=True)

def load_env_key(name):
    with open("/home/ubuntu/projects/growthforge/.env.prod.wasabi") as f:
        for line in f:
            if line.startswith(name + "="):
                v = line.split("=", 1)[1].strip()
                if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
                    v = v[1:-1]
                return v
    raise RuntimeError("missing " + name)

def http_json(method, url, key=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if key:
        req.add_header("Authorization", "Bearer " + key)
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())

def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
    with urllib.request.urlopen(req, timeout=600) as r, open(dest, "wb") as f:
        f.write(r.read())

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

GROK_KEY = load_env_key("GROWTHFORGE_GROK_API_KEY")
SEED_KEY = load_env_key("ModelArk_SEEDANCE_API_KEY")
grok_prompt = open(os.path.join(BASE, "prompts", "grok-brief1.txt")).read().strip()
seed_prompt = open(os.path.join(BASE, "prompts", "seedance-brief1.txt")).read().strip()

meta = {}

# ---- GROK ----
print("[grok] submitting", flush=True)
grok_t0 = now()
try:
    grok_resp = http_json("POST", "https://api.x.ai/v1/videos/generations", GROK_KEY, {
        "model": "grok-imagine-video-1.5-lite",
        "prompt": grok_prompt,
        "duration": 15,
        "aspect_ratio": "9:16",
        "resolution": "720p",
        "generate_audio": True,
    })
except Exception as e:
    print("[grok] SUBMIT ERROR:", e, flush=True); sys.exit(1)
grok_rid = grok_resp["request_id"]
print("[grok] request_id:", grok_rid, flush=True)

grok_done = None
for i in range(90):
    time.sleep(10)
    st = http_json("GET", f"https://api.x.ai/v1/videos/{grok_rid}", GROK_KEY)
    print(f"[grok] poll {i+1}: {st.get('status')}", flush=True)
    if st.get("status") in ("done", "failed"):
        grok_done = st; break
grok_t1 = now()
meta["grok"] = {"model": "grok-imagine-video-1.5-lite", "request_id": grok_rid,
                "status": grok_done.get("status") if grok_done else "timeout",
                "submitted_at": grok_t0, "completed_at": grok_t1,
                "video": grok_done.get("video") if grok_done else None}
if grok_done and grok_done.get("status") == "done" and grok_done.get("video", {}).get("url"):
    download(grok_done["video"]["url"], os.path.join(OUT, "grok-brief1.mp4"))
    print("[grok] downloaded", flush=True)

# ---- SEEDANCE ----
print("[seedance] submitting", flush=True)
seed_t0 = now()
try:
    seed_resp = http_json("POST", "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks", SEED_KEY, {
        "model": "dreamina-seedance-2-5-260628",
        "content": [{"type": "text", "text": seed_prompt}],
        "resolution": "720p",
        "ratio": "9:16",
        "duration": 15,
        "generate_audio": True,
        "watermark": False,
    })
except Exception as e:
    print("[seedance] SUBMIT ERROR:", e, flush=True); sys.exit(1)
seed_id = seed_resp["id"]
print("[seedance] task_id:", seed_id, flush=True)

seed_done = None
for i in range(90):
    time.sleep(10)
    st = http_json("GET", f"https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/{seed_id}", SEED_KEY)
    print(f"[seedance] poll {i+1}: {st.get('status')}", flush=True)
    if st.get("status") in ("succeeded", "failed", "cancelled"):
        seed_done = st; break
seed_t1 = now()
meta["seedance"] = {"model": "dreamina-seedance-2-5-260628", "task_id": seed_id,
                    "status": seed_done.get("status") if seed_done else "timeout",
                    "submitted_at": seed_t0, "completed_at": seed_t1,
                    "usage": seed_done.get("usage") if seed_done else None,
                    "framespersecond": seed_done.get("framespersecond") if seed_done else None,
                    "resolution": seed_done.get("resolution") if seed_done else None,
                    "duration": seed_done.get("duration") if seed_done else None}
if seed_done and seed_done.get("status") == "succeeded" and seed_done.get("content", {}).get("video_url"):
    download(seed_done["content"]["video_url"], os.path.join(OUT, "seedance-brief1.mp4"))
    print("[seedance] downloaded", flush=True)

with open(os.path.join(OUT, "metadata.json"), "w") as f:
    json.dump(meta, f, indent=2)
print("[done] metadata written", flush=True)
