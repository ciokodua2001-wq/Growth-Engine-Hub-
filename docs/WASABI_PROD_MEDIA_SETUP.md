# GrowthForge — Wasabi Production Media Bucket Setup

Goal: a **separate** prod media bucket + least-privilege sub-user. **Do NOT reuse DEV credentials** (`growthforge-media`).

---

## Step 1 — Create the bucket

- Wasabi console → Buckets → **Create Bucket**.
- Name: **`growthforge-prod-media`**
- Region: **`ca-central-1`** (matches the app's endpoint `https://s3.ca-central-1.wasabisys.com`).
- Leave versioning/locking at defaults.

## Step 2 — Create the sub-user

- Wasabi console → **IAM → Users → Create User**.
- Name: e.g. `growthforge-prod-media-writer`.
- **Programmatic access only** (access key + secret) — no console access.

## Step 3 — Attach a bucket-scoped policy (least privilege)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::growthforge-prod-media" },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::growthforge-prod-media/*" }
  ]
}
```

This grants access to **only** `growthforge-prod-media` — not the dev bucket (`growthforge-media`) or the backup bucket.

## Step 4 — Record the credentials

Save the access key ID + secret access key. Provide them to the agent for `.env` injection; **never commit them to the repo**.

## Step 5 — Prod `.env` values (inject at release)

```
DEFAULT_OBJECT_STORAGE_BUCKET_ID=growthforge-prod-media
OBJECT_STORAGE_ENDPOINT=https://s3.ca-central-1.wasabisys.com
OBJECT_STORAGE_REGION=ca-central-1
OBJECT_STORAGE_ACCESS_KEY_ID=<step 4>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<step 4>
```

- `OBJECT_STORAGE_FORCE_PATH_STYLE`: leave unset (path-style default).
- `PUBLIC_OBJECT_SEARCH_PATHS` / `PRIVATE_OBJECT_DIR`: optional (empty defaults); **not** required for assembly upload, which uses the fixed key prefix `renders/assembled/…`.

## Step 6 — Verify permissions (after creds are provided)

- PutObject + GetObject + ListBucket succeed on `growthforge-prod-media`.
- Confirm the key has **no** access to `growthforge-media` or the backup bucket (negative test).
- Confirm an assembled video lands at `renders/assembled/video-<id>-<format>-<ts>.mp4`.
