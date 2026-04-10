import { defineConfig } from "vitest/config";

const timeoutSec = Number(process.env.BAMBU_E2E_DOCKER_TIMEOUT ?? "900");

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/e2e/**/*.e2e.test.ts"],
    testTimeout: timeoutSec * 1000,
    hookTimeout: 120_000,
    reporters: ["default"],
    sequence: { concurrent: false },
  },
});
