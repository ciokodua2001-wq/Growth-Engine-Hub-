import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    // DB-backed suites share the isolated Postgres test DB; run files one at a
    // time so concurrent TRUNCATE/cleanup between files cannot race.
    fileParallelism: false,
  },
});
