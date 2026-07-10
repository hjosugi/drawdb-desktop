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
        "overlay/src/data/exportSQL/*.js",
        "overlay/src/data/importSQL/*.js",
        "overlay/src/i18n/**/*.js",
        "overlay/src/utils/ddb.js",
        "overlay/src/utils/excel/build.js",
        "overlay/src/utils/excel/constants.js",
        "overlay/src/utils/excel/helpers.js",
        "overlay/src/utils/excel/parse.js",
        "overlay/src/utils/excel/styles.js",
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
