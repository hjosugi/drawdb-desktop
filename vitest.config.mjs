import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      include: [
        "overlay/src/data/exportSQL/*.js",
        "overlay/src/data/importSQL/*.js",
        "overlay/src/i18n/**/*.js",
        "overlay/src/utils/excelIO.js",
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
