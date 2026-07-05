// Validates that shipped JSON configuration parses and setup config is usable.
// Run with: node tests/validate-config.mjs   (exit 1 on failure)
import { readFileSync } from "node:fs";

const files = [
  "overlay/src-tauri/tauri.conf.json",
  "overlay/src-tauri/capabilities/default.json",
];

let fail = 0;
function check(label, cond) {
  if (cond) console.log(`  PASS  ${label}`);
  else { console.error(`  FAIL  ${label}`); fail++; }
}

for (const f of files) {
  try {
    JSON.parse(readFileSync(f, "utf8"));
    console.log(`  PASS  ${f}`);
  } catch (e) {
    console.error(`  FAIL  ${f}: ${e.message}`);
    fail++;
  }
}

try {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const setup = pkg.drawdbDesktopSetup;
  check("package.json has setup config", Boolean(setup));
  check("setup npm packages are centralized", Array.isArray(setup?.npmPackages) && setup.npmPackages.length > 0);
  check("setup cargo packages are centralized", Array.isArray(setup?.cargoPackages) && setup.cargoPackages.length > 0);
  check("setup script is registered", pkg.scripts?.setup === "node scripts/setup.mjs");
} catch (e) {
  console.error(`  FAIL  package.json: ${e.message}`);
  fail++;
}

console.log(fail === 0 ? "CONFIG OK" : `${fail} config file(s) invalid`);
process.exit(fail === 0 ? 0 : 1);
