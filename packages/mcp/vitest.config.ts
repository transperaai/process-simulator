import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The PostgREST end-to-end test waits for PostgREST to pick up a fresh database.
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
