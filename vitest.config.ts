import { defineConfig } from "vitest/config";
import { testEnv } from "./tests/test-env.js";

export default defineConfig({
  test: {
    env: testEnv,
    globalSetup: "tests/global-setup.ts",
    setupFiles: "tests/setup.ts",
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
