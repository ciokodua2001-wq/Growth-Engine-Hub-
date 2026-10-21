import subprocess, secrets, string, hmac, hashlib, base64, json, sys

N = int(sys.argv[1]) if len(sys.argv) > 1 else 600
START_ID = 90001

db = None
secret = None
for line in open(".env"):
    line = line.strip()
    if line.startswith("DATABASE_URL="):
        db = line.split("=", 1)[1].strip().strip(chr(34)).strip(chr(39))
    elif line.startswith("BETTER_AUTH_SECRET="):
        secret = line.split("=", 1)[1].strip().strip(chr(34)).strip(chr(39))

Q = chr(39)
alphabet = string.ascii_letters + string.digits

def sign(token):
    sig = base64.b64encode(hmac.new(secret.encode(), token.encode(), hashlib.sha256).digest()).decode()
    return token + "." + sig

rows = []
sql = []
for i in range(N):
    uid = "".join(secrets.choice(alphabet) for _ in range(32))
    token = "".join(secrets.choice(alphabet) for _ in range(32))
    email = "cap-%06d@example.com" % (100000 + i)
    pid = START_ID + i
    # user (better auth)
    sql.append(f"INSERT INTO {chr(34)}user{chr(34)} (id,name,email,email_verified,created_at,updated_at) VALUES ({Q}{uid}{Q},{Q}CapUser{Q},{Q}{email}{Q},true,now(),now());")
    # app users row (test account marker)
    sql.append(f"INSERT INTO users (id,email,role,is_owner,can_access_dev,is_test_account,plan) VALUES ({Q}{uid}{Q},{Q}{email}{Q},{Q}user{Q},true,true,true,{Q}trial{Q}) ON CONFLICT (id) DO NOTHING;")
    # project (explicit id)
    sql.append(f"INSERT INTO projects (id,owner_id,name,status,plan) VALUES ({pid},{Q}{uid}{Q},{Q}Cap Project {i}{Q},{Q}active{Q},{Q}trial{Q}) ON CONFLICT (id) DO NOTHING;")
    # session (expires 7 days)
    sql.append(f"INSERT INTO session (id,expires_at,token,created_at,updated_at,user_id) VALUES ({Q}{uid}{Q}, now() + interval {Q}7 days{Q}, {Q}{token}{Q}, now(), now(), {Q}{uid}{Q});")
    rows.append({"uid": uid, "token": token, "cookie": "__Secure-better-auth.session_token=" + sign(token), "project_id": pid})

# write SQL + pipe to psql (single transaction-ish bulk)
with open("/tmp/cohort.sql", "w") as f:
    f.write("BEGIN;\n" + "\n".join(sql) + "\nCOMMIT;\n")
r = subprocess.run(["psql", db, "-v", "ON_ERROR_STOP=1", "-f", "/tmp/cohort.sql"], capture_output=True, text=True)
if r.returncode != 0:
    sys.stderr.write("SQL error: %s\n" % r.stderr[-400:])
    raise SystemExit(1)

with open("/tmp/cohort.json", "w") as f:
    json.dump(rows, f)
print("created %d synthetic users/projects/sessions (project ids %d..%d)" % (N, START_ID, START_ID + N - 1))
