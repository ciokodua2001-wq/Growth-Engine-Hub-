/**
 * Vitest global setup for @workspace/api-server tests.
 *
 * Provides a dedicated, isolated Postgres test database so test files that
 * statically import `@workspace/db` (which throws "DATABASE_URL must be set"
 * at module load) can execute. The value is a LOCAL, throwaway database - never
 * production and never the active Nigeria application database.
 *
 * Credential-heavy modules that throw at import (Google GenAI) are given a
 * non-secret dummy key so they load; real AI calls remain out of scope for
 * these tests and are mocked by the suites that need them.
 */
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://ubuntu@/growthforge_nigeria_test?host=/var/run/postgresql";
}

if (!process.env.GOOGLE_GENAI_API_KEY) {
  process.env.GOOGLE_GENAI_API_KEY = "vitest-dummy-key-not-real";
}
