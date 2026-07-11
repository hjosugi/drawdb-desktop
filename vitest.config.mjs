import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.mjs"],
    // CLI round-trip tests launch multiple Node processes and can exceed
    // Vitest's 5-second default on cold or contended CI runners.
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      include: [
        "src/data/exportSQL/*.js",
        "src/data/importSQL/*.js",
        "src/i18n/**/*.js",
        "src/utils/ddb.js",
        "src/utils/excel/build.js",
        "src/utils/excel/constants.js",
        "src/utils/excel/helpers.js",
        "src/utils/excel/parse.js",
        "src/utils/excel/styles.js",
      ],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
    },
  },
});
