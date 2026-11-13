# AWS Phase B - One-Command Deployment Runbook (PREPARATION ONLY)

Status: **NOT APPLIED.** No EC2 launched, no paid resources, no IAM changes. This is the
repeatable runbook + scripts to execute Phase B the moment quota approval + explicit
provisioning approval are given.

## Prerequisites (one-time, owner actions)

1. **Quota approved**: `Running On-Demand G and VT instances` >= 16 vCPU, us-east-1
   (request `179456940800730` is currently `CASE_OPENED`).
2. **Instance role + profile** (owner creates once - the agent's policy has `iam:PassRole`
   only, not `iam:CreateRole`):
   - Role `ltx-worker-instance-role` with `aws/iam/ltx-worker-instance-role-policy.json`
     (self-stop, S3 output upload, logs, metrics - no escalation surface).
   - Instance profile `ltx-worker-instance-profile` bound to that role.
3. **Key pair** `ltx-worker-key` (owner creates or imports; `.pem` kept on DEV under `awsops`).
4. **S3 buckets**: `gf-ltx-output` (private) and `gf-ltx-models` (optional weight backup).
5. **Phase B policy applied** to `GrowthForge-LTX-Setup`:
   `aws/iam/phase-b-provisioning-policy-v2.json` (only after explicit approval).
6. `aws sso login` as `awsops` (device-code) to refresh the session before deploying.

## Deployment sequence (one command)

```bash
# on DEV, as awsops (never as the app user)
sudo -u awsops -H bash -c 'export XDG_RUNTIME_DIR=/tmp/xdg-awsops; cd ~/aws/phase-b'
# inject HF token into bootstrap.sh, then deploy
sed "s/\$HF_TOKEN/hf_xxx/" bootstrap.sh > /tmp/bootstrap.sh
sudo -u awsops -H ./deploy.sh g6e.4xlarge      # g6e.2xlarge = cheaper option to test
```

`deploy.sh` does, in order: quota check → AMI lookup → security group (+SSH from pinned IP)
→ EBS gp3 200GB data volume (tagged `ltx=worker`) → launch instance (tagged `ltx=worker`,
instance-profile attached, root 60GB gp3) → attach volume → wait running → create the
idle-stop CloudWatch alarm. Bootstrap (user-data) installs the NVIDIA driver, mounts `/models`,
installs uv + LTX-2 + weights, and enables the watchdog systemd service.

## Run the 5-second benchmark (C1)

```bash
sudo -u awsops -H ssh -i ~/.ssh/ltx-worker-key ubuntu@<PUBLIC_IP> \
  'sudo /models/job/.../render-5s.sh'   # render + ffprobe validate + S3 upload + SHA256 verify
```

Then stop:
```bash
sudo -u awsops -H aws ec2 stop-instances --instance-ids <id> --profile growthforge-ltx --region us-east-1
# verify stopped (only "done" when the API confirms):
aws ec2 describe-instances --instance-ids <id> --query "Reservations[0].Instances[0].State.Name"
```

## Automatic shutdown enforcement (independent of the agent)

- **Layer 1 - in-instance watchdog** (`aws/phase-b/watchdog.sh`, systemd): hard **240 min**
  cap + **15 min** idle timeout (heartbeat file), self-stops via the instance role.
- **Layer 2 - external CloudWatch alarm** `ltx-worker-idle-stop`: `CPUUtilization < 3%` for
  15 min → `ec2:Stop` action. Survives the instance's own watchdog dying.
- **Verify-stopped**: after any stop, poll `DescribeInstances` until `State == stopped`;
  the job is only "done" once the API confirms it.
- Budgets is **notification only** (the $20 alert), not a control.

## S3 delivery gate (hard requirement)

A render is **not complete** and the instance may **not stop** until:
1. `ffprobe` shows video + audio streams, correct resolution/duration.
2. `aws s3 cp` exits 0.
3. `head-object` `ContentLength` == local bytes.
4. `ChecksumSHA256` == local SHA256.
5. `job-status.txt` written with `uploaded+verified`.

## g6e.2xlarge vs g6e.4xlarge

- Start on **g6e.4xlarge** (128 GB RAM - safe for fp8 + CPU offload).
- `render-5s.sh` records **peak system RAM** (`peak_ram_bytes`). If observed peak is
  comfortably < ~55 GB, re-run `deploy.sh g6e.2xlarge` ($2.24/hr) and validate identical output.
- g6e.2xlarge is only adopted if the measured RAM peak proves it fits; never assumed.

## First-benchmark cost estimate (us-east-1, on-demand)

| Item | Estimate |
|---|---|
| g6e.4xlarge ~1.5 h ($3.004/hr) | ~$4.50 |
| EBS gp3 200 GB, ~2 days prorated | ~$1.07 |
| S3 output (1 clip + logs) | <$0.01 |
| Data transfer (HF ingress, S3 same-region) | ~$0 |
| **Total** | **~$6 (ceiling ~$10)** |

## Acceptance criteria (C1 complete)

1. `nvidia-smi` shows L40S 48 GB on the instance.
2. `/models/bootstrap.done` exists; 67 GB weights present + verified.
3. `render-5s.sh` exits 0; `render_seconds`, `peak_vram_mib`, `peak_ram_bytes` recorded.
4. `ffprobe`: 1920x1088 h264 + AAC audio, duration ~5.0 s.
5. S3 `benchmark-5s/render.mp4` present, `ContentLength` + `ChecksumSHA256` match.
6. `job-status.txt` = `uploaded+verified`.
7. Watchdog service active; CloudWatch alarm created.
8. Instance reaches `stopped` state (API-confirmed); cost logged.
