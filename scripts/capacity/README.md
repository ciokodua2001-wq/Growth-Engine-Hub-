# GrowthForge capacity test tooling (DEV only)

Scripts used for the authenticated capacity + FFmpeg concurrency assessment.
All run against `http://127.0.0.1:4001` and read `.env` for `DATABASE_URL` and
`BETTER_AUTH_SECRET` (never printed).

- `cohort.py N` — create N synthetic users/projects/sessions (real signed Better Auth
  session cookies), project ids `90001..`, `is_test_account=true`, emails
  `cap-NNNNNN@example.com`. Writes `/tmp/cohort.json`.
- `authload.py C DUR` — C concurrent authenticated clients (weighted endpoint mix:
  auth/me, projects, dashboard, analysis, strategy, content, social-posts, campaigns,
  videos, competitors, usage, autonomous/decisions). Reports throughput + latency
  percentiles + status-code histogram.
- `ffbench.py N` — N concurrent FFmpeg 4-scene assembly jobs (libx264). Reports wall +
  per-job time.
- `one_level.py C DUR` — runs `authload.py` while sampling loadavg / MemAvailable /
  pg connections / slow queries / API RSS; prints peak resources + results.

Cleanup: `DELETE FROM users WHERE is_test_account=true AND email LIKE 'cap-%';`
(also cascade-removes projects/sessions via FK).
