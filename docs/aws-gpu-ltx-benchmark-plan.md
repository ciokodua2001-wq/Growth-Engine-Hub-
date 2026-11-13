# GrowthForge - AWS GPU Infrastructure for LTX Native Audio/Video (Benchmark Plan)

Status: PLANNING ONLY. Nothing provisioned, no spend authorized yet.
Owner authorizes AWS access. Do not modify GrowthForge production.

---

## 1. LTX model facts (verified 2026-11-13 against HuggingFace `Lightricks/LTX-2.5`)

- Current model is **LTX-2.5** (successor to LTX-2), a 22B open-weights world model with
  **native synchronized video + audio** (text-to-audio-video, image-to-audio-video, etc.).
  Older 1.x/0.9 "LTX-Video" models do not have this native audio path - do not use them
  for the native-audio benchmark.
- Weights and code are on HuggingFace under the **`Lightricks`** org (`LTX-2.5`,
  `LTX-2.5-Pre-Trained`, `LTX-2.5-Diffusers`). Install path is `ltx-pipelines`
  (PyTorch) or ComfyUI.
- **License:** `LTX-2.x Community License Agreement`.
  - "Commercial and production use at no cost" under the Community License.
  - **> $10M annual revenue → a Paid Commercial Use Agreement is required.**
  - "Transfer of fine-tunes may require a paid license."
  - Action for owner: confirm the >$10M revenue trigger against GrowthForge's actual
    revenue, and have counsel read the full license text before production SaaS use.
- **Architecture (why VRAM matters):** 22B diffusion transformer + **Gemma-4 12B text
  encoder** + video VAE + audio VAE + latent spatial/temporal upscalers + duration head.
  In bf16 the two big tensors alone are ~68 GB; the full set is ~80-100 GB on disk.
- **Hardware reality:** LTX-2.5 22B does **not** run comfortably in 48 GB VRAM in bf16.
  The official "VRAM tips" path is `--quantization fp8-cast --offload cpu`, i.e. fp8
  weights + CPU offload of the text encoder/VAEs. That works on a 48 GB GPU but is
  slower and needs substantial **system RAM** for the offloaded modules.

## 2. AWS instance verdict (verified: specs from aws.amazon.com/ec2/instance-types/g6e,
pricing from instances.vantage.sh dataset, Linux on-demand)

g6e = NVIDIA **L40S (48 GB)** per GPU.

| Instance      | GPUs (L40S) | vCPU | RAM    | us-east-1 $/hr | Verdict for LTX-2.5 |
|---------------|-------------|------|--------|----------------|----------------------|
| g6e.xlarge    | 1           | 4    | 32 GB  | $1.861         | **Too little RAM** (32 GB) for CPU offload of a 12B encoder + VAEs |
| g6e.2xlarge   | 1           | 8    | 64 GB  | $2.242         | Marginal; offload RAM still tight |
| **g6e.4xlarge** | 1         | 16   | 128 GB | **$3.004**     | **Recommended** (48 GB VRAM + 128 GB RAM for fp8 offload) |
| g6e.8xlarge   | 1         | 32   | 256 GB | $4.529         | Extra RAM headroom; not required |
| g6e.12xlarge  | 4           | 48   | 384 GB | $10.493        | Upgrade path if fp8/offload too slow (4× VRAM) |
| g6e.16xlarge  | 1           | 64   | 512 GB | $7.577         | More RAM only, same 48 GB VRAM (skip) |
| g6e.24xlarge  | 4           | 96   | 768 GB | $15.066        | Overkill for benchmark |
| g6e.48xlarge  | 8           | 192  | 1536 GB| $30.131        | Overkill for benchmark |

**Recommended:** `g6e.4xlarge` (single L40S, 128 GB RAM), `us-east-1` (N. Virginia).
**Revised 2026-11-13 with real measurements** (Runpod A100-SXM 80 GB, bf16, no offload):
5.04 s clip, 1920x1088, native AAC 48 kHz stereo, ~99 s render, **42.7 GB peak VRAM**
(the 12B text encoder offloads after encoding). Therefore fp8-cast (~20 GB) fits 48 GB
with large headroom, and 128 GB system RAM comfortably holds the fp8 transformer +
offloaded encoder. g6e.8xlarge's 256 GB is no longer required.
us-west-2 (Oregon) is the fallback region.

Availability/quotas: g6e frequently ships with **0 vCPU quota on new accounts**. Step 1
of any run is a Service Quota increase for "Running On-Demand G and VT instances"
(and "All G and VT Spot Instance Requests" if Spot is desired).

## 3. Minimum IAM permissions for secure agent access (least privilege)

Owner creates an IAM **User** (or Role) with MFA; agent gets temporary credentials only.
**Never root.** Scope everything to the benchmark region + a naming tag prefix.

Phase 1-2 minimum (provision/manage one GPU + storage + logs):
```
ec2:RunInstances, DescribeInstances, DescribeInstanceTypes, DescribeInstanceStatus,
  StartInstances, StopInstances, TerminateInstances, GetConsoleOutput, CreateTags
ec2:DescribeImages, DescribeVpcs, DescribeSubnets, DescribeSecurityGroups,
  AuthorizeSecurityGroupIngress, CreateSecurityGroup
ec2:CreateKeyPair, ImportKeyPair, DescribeKeyPairs
ec2:CreateVolume, AttachVolume, DetachVolume, DescribeVolumes, DeleteVolume,
  CreateSnapshot, DescribeSnapshots
ec2:CreateImage, DescribeImages, RegisterImage, DeregisterImage, CopyImage   # golden AMI
s3:ListBucket, GetObject, PutObject, DeleteObject   # ONLY on s3://<models-bucket>/*
servicequotas:GetServiceQuota, GetAWSDefaultServiceQuota, ListServiceQuotas,
  RequestServiceQuotaIncrease
cloudwatch:PutMetricData, GetMetricData
logs:CreateLogGroup, CreateLogStream, PutLogEvents                       # job logs
ssm:SendCommand, GetCommandInvocation (optional, for run commands)
```
Deliberately **excluded** from the agent: `iam:*`, `billing:*`, `organizations:*`,
root-adjacent, and anything on the production account/app. Grant `budgets:*` +
`ce:GetCostAndUsage` only if the owner wants the agent to read cost, and keep it
read-only. Phase 3 adds (only after benchmark passes): `batch:*`, `ecs:*`, `ecr:*`,
`iam:PassRole` scoped to the batch roles, `fsx:*` or `elasticfilesystem:*` (if used).

## 4. Estimated benchmark budget ($50-100 target)

| Item | Estimate |
|------|----------|
| g6e.8xlarge, us-east-1, on-demand | $4.53/hr |
| ~6 h install + weight download + sanity (1 run) | ~$27 |
| ~8 h of actual test renders (several 5-15 s clips, fp8+offload) | ~$36 |
| EBS gp3 400 GB for ~1 week (weights + outputs) | ~$2 |
| Egress/data transfer (weights from HF/CDN, outputs to S3) | ~$1-3 |
| **Total (comfortable)** | **~$65-70** |
| Floor (minimal: g6e.4xlarge + fewer clips) | ~$45 |
| Ceiling (add g6e.12xlarge for a speed comparison) | ~$95 |

All within the $50-100 window. Big cost lever is instance hours, not the model.

## 5. Design - non-continuous GPU (scale to zero by default)

- Instance runs **only during an active benchmark/test session**; `Stop` (not terminate)
  at the end of every session so the EBS data volume and root disk persist.
- Guard rails: a CloudWatch alarm that **stops** the instance after N hours of
  no-activity (or a hard TTL Lambda), so a forgotten instance can't burn hours.
- Optional: AWS Instance Scheduler (start/stop on a schedule) if benchmark needs
  recurring windows.

## 6. Design - persistent model storage (download weights once)

- Phase 1-2: a **dedicated EBS gp3 data volume** (e.g. 400 GB, `$0.08/GB-month`) mounted
  at `/models`, created once and **attached across instance stop/start**. Weights
  (`LTX-2.5` bf16 + text encoder + VAEs + upscalers ≈ 80-100 GB) download exactly once
  and survive every reboot/stop.
- Belt-and-suspenders: also keep a tarball/objects in a private `s3://<models-bucket>`
  so the volume can be rebuilt if it is ever lost.
- Phase 3 (Batch): move to one of - (a) a **golden AMI** with weights baked in (fastest
  cold start), or (b) **EFS** shared across the compute environment, or (c) S3 +
  **FSx for Lustre** for fast load. Do not download weights per-job from the internet.

## 7. Benchmark execution plan (Phase 2 - after approval + credentials)

1. Quota check/request for g6e on-demand (and Spot if used) in us-east-1.
2. Provision `g6e.8xlarge` (Ubuntu 24.04 or the Deep Learning AMI), 400 GB gp3
   data volume mounted at `/models`, key pair, security group (SSH 22 from a pinned
   IP only).
3. Install NVIDIA driver + CUDA (matching PyTorch build) + `ltx-pipelines`; confirm
   `nvidia-smi` shows 48 GB L40S.
4. Download `Lightricks/LTX-2.5` weights to `/models` and **verify checksums**.
5. Run `--quantization fp8-cast --offload cpu` on the distilled pipeline; generate the
   same 6-scene commercial brief used for the Omni test (Hook/Problem/Solution/Benefits/
   Proof/CTA) at 1080p, native synchronized audio.
6. Record per clip: render time, resolution, duration, audio presence/quality (ffprobe +
   volumedetect), GPU util/VRAM (`nvidia-smi dmon`), and instance-hours → cost.
7. Compare against the Omni baseline (quality, time, cost-per-clip, licensing posture).
8. **Stop the instance** when finished; leave the `/models` volume intact.

## 8. Phase 3 - AWS Batch architecture (design only; implement only after benchmark passes)

- EC2 GPU compute environment (`g6e.8xlarge` or `g6e.12xlarge`), `MAXvCpus` scaled so
  idle capacity drains to **0** (scale-to-zero).
- Prebuilt inference image in **ECR** (CUDA + `ltx-pipelines` + entrypoint), weights via
  golden AMI / EFS / FSx (no per-job download).
- Video job queue: submit → job → S3 output (signed URLs for GrowthForge) → status in
  DB/CloudWatch → automatic instance stop when queue empty.
- Secure storage: private S3 bucket + presigned GET for the app; CloudFront optional.
- Cost monitoring: CloudWatch alarms + AWS Budgets alert at $ threshold.
- Failure recovery: job retries with backoff, checkpointing not needed for single clips,
  Spot (if used) with graceful drain on 2-min interruption notice.

## 9. Hard rules (repeated, because they matter)

- Do not modify GrowthForge production.
- Do not provision billable AWS resources without explicit approval.
- Do not use AWS root credentials.
- Do not deploy LTX into the existing GrowthForge app server.
- Do not implement the full AWS Batch system until the LTX quality benchmark succeeds.
