# AWS Phase B - Corrected Runbook (PREPARATION ONLY - nothing applied/provisioned)

## Access model
- Agent runs as `awsops` (isolated). Instance access is **SSM Session Manager** - no public
  SSH, no key pair, no inbound security-group rules (SG is deny-all inbound).
- Hard runtime cap: **120 minutes**. Estimated vs maximum spend are tracked separately below.

## One-time owner prerequisites
1. Quota `L-DB2E81BA` >= 16 vCPU (case `179456940800730` currently `CASE_OPENED`).
2. **Instance role** `ltx-worker-instance-role` + **instance profile**
   `ltx-worker-instance-profile`. The role = `ltx-worker-instance-role-policy.json`
   (self-stop + S3 output + logs + metrics) **plus the managed policy
   `AmazonSSMManagedInstanceCore`** (for SSM). The agent can `iam:PassRole` but not create it.
3. **Stop-enforcer Lambda** `ltx-stop-enforcer` (code `aws/phase-b/stop-enforcer-lambda.py`,
   env `CAP_MIN=120`) with role from `ltx-stop-enforcer-role-policy.json`, invoked by an
   EventBridge schedule `rate(5 minutes)`. This is the **independent time-based hard stop**.
4. S3 buckets `gf-ltx-output` (private) + `gf-ltx-models` (optional weight backup).
5. Apply `phase-b-provisioning-policy-v4.json` to `GrowthForge-LTX-Setup` (after approval).

## Deployment (one command, after approval)
```bash
sudo -u awsops -H ./deploy.sh g6e.4xlarge      # g6e.2xlarge = cheaper option to test later
# connect:
aws ssm start-session --target <instance-id> --profile growthforge-ltx --region us-east-1
```

## Shutdown enforcement (independent, time-based)
1. **In-instance watchdog** (systemd): 120 min hard cap + 15 min idle → self-stop (instance role).
2. **External enforcer** (EventBridge 5 min → Lambda): stops any running `ltx=worker` instance
   older than 120 min, regardless of the instance's own watchdog or CPU state.
3. **Verify-stopped**: job "done" only after `DescribeInstances` returns `stopped`.

**Failure modes (layer 2):** if the Lambda errors/throttles, the in-instance watchdog is the
backstop; worst-case overshoot is ~5 min (the rule period). If both fail, the Budgets alert
($20) is notification-only and does **not** stop - hence the two independent stop layers above.

## Shutdown priority (hard deadline wins over upload)
- The 120-min deadline is absolute. The watchdog checks it first and stops **even if** render
  or upload is incomplete.
- Render script budget: if remaining time < ~2 min before upload, it **skips upload**, writes
  `render-done-not-uploaded` to `job-status.txt`, and lets the watchdog stop. The clip stays on
  persistent EBS (`/models`).
- **Recovery**: weights + repo + venv live on persistent EBS (no re-download on restart);
  a failed/partial render is on EBS for diagnosis; a completed+verified clip is durable in S3.
  Nothing important is lost by a hard stop.

## S3 delivery gate
A render is not complete until: `ffprobe` (video+audio+res/duration) passes → `s3 cp` exits 0 →
`ContentLength` matches → `ChecksumSHA256` matches → `job-status.txt = uploaded+verified`.
Upload is bounded by the hard deadline (see above); it never extends the runtime.

## Cost transparency (us-east-1 on-demand)
| Item | Estimated (first test) | Maximum exposure |
|---|---|---|
| EC2 g6e.4xlarge | ~1 h ≈ $3.00 | 2 h cap = $6.01 |
| EBS (60 GB root + 200 GB data, encrypted gp3) | ~1 day ≈ $0.69 | $20.80/mo if kept |
| S3 (clip + logs) | <$0.01 | <$0.05 |
| Lambda + EventBridge (enforcer) | $0 (free tier) | $0 |
| Data transfer | $0 | $0 |
| **Total** | **~$3.70** | **~$6.70 (EBS cleaned up next day)** / ~$26.82 (EBS kept 1 mo) |

**Key continuing cost is EBS (~$20.80/mo while the 260 GB persists).** After the test, delete
(or snapshot→S3) the volumes to stop that billing. EC2 stops billing the moment it's `stopped`.

## g6e.2xlarge path
Start on g6e.4xlarge; `render-5s.sh` records `peak_ram_bytes`. If < ~55 GB, re-run
`deploy.sh g6e.2xlarge` ($2.24/hr) and re-validate - evidence decides.

## Acceptance criteria (C1)
1. `nvidia-smi` shows L40S 48 GB. 2. `/models/bootstrap.done` + 67 GB weights verified.
3. `render_seconds`/`peak_vram_mib`/`peak_ram_bytes` recorded. 4. `ffprobe`: 1920x1088 h264 +
AAC, ~5 s. 5. S3 object `ContentLength` + `ChecksumSHA256` match. 6. `job-status.txt =
uploaded+verified`. 7. Watchdog active; enforcer Lambda + rule live. 8. Instance `stopped`
(API-confirmed); cost logged.
