// Validates that the shipped Tauri JSON configuration parses.
// Run with: node tests/validate-config.mjs   (exit 1 on failure)
import { readFileSync } from "node:fs";

const files = [
  "overlay/src-tauri/tauri.conf.json",
  "overlay/src-tauri/capabilities/default.json",
];

let fail = 0;
for (const f of files) {
  try {
    JSON.parse(readFileSync(f, "utf8"));
    console.log(`  PASS  ${f}`);
  } catch (e) {
    console.error(`  FAIL  ${f}: ${e.message}`);
    fail++;
  }
}
console.log(fail === 0 ? "CONFIG OK" : `${fail} config file(s) invalid`);
process.exit(fail === 0 ? 0 : 1);
