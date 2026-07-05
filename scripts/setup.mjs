#!/usr/bin/env node
import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = join(rootDir, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const setupConfig = packageJson.drawdbDesktopSetup;
const isWindows = process.platform === "win32";

const args = parseArgs(process.argv.slice(2));

main();

function main() {
  requireNode18();
  validateSetupConfig(setupConfig);

  const overlayDir = join(rootDir, "overlay");
  const projectDir = resolve(rootDir, args.projectDir ?? setupConfig.projectName);
  const baseRepo = args.baseRepo ?? setupConfig.baseRepo;

  ensureDirectory(overlayDir, "overlay folder");
  requireCommands(["git", "npm", "cargo"]);

  log(`Base repo: ${baseRepo}`);
  log(`Project dir: ${projectDir}`);
  if (args.dryRun) {
    log("Dry run: commands are printed but clone, copy, and installs are skipped.");
  }

  ensureBaseCheckout(projectDir, baseRepo);
  applyOverlay(overlayDir, projectDir);
  installFrontend(projectDir);
  installRustPlugins(join(projectDir, "src-tauri"));

  log("Apply manual patches per src/patches/PATCHES.md and PATCHES_FULL.md.");
  log("Then run: npm run tauri build");
}

function parseArgs(rawArgs) {
  const parsed = { dryRun: false, projectDir: undefined, baseRepo: undefined };
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--project-dir") {
      parsed.projectDir = readValue(rawArgs, ++i, arg);
    } else if (arg === "--base-repo") {
      parsed.baseRepo = readValue(rawArgs, ++i, arg);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function readValue(rawArgs, index, flag) {
  const value = rawArgs[index];
  if (!value || value.startsWith("--")) {
    fail(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/setup.mjs [options]

Options:
  --dry-run              Print setup steps without cloning or installing.
  --project-dir <path>   Override the target checkout directory.
  --base-repo <url>      Override the base drawDB-App repository URL.
  -h, --help             Show this help.
`);
}

function requireNode18() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (major < 18) {
    fail(`Node.js 18+ is required. Current version: ${process.version}`);
  }
}

function validateSetupConfig(config) {
  if (!config || typeof config !== "object") {
    fail("package.json is missing drawdbDesktopSetup.");
  }
  if (!config.projectName || !config.baseRepo) {
    fail("drawdbDesktopSetup requires projectName and baseRepo.");
  }
  if (!Array.isArray(config.npmPackages) || config.npmPackages.length === 0) {
    fail("drawdbDesktopSetup.npmPackages must be a non-empty array.");
  }
  if (!Array.isArray(config.cargoPackages) || config.cargoPackages.length === 0) {
    fail("drawdbDesktopSetup.cargoPackages must be a non-empty array.");
  }
  for (const cargoPackage of config.cargoPackages) {
    if (!cargoPackage?.name) {
      fail("Every cargo package entry needs a name.");
    }
    if (cargoPackage.args && !Array.isArray(cargoPackage.args)) {
      fail(`cargo package ${cargoPackage.name} has non-array args.`);
    }
  }
}

function requireCommands(commands) {
  const missing = commands.filter((command) => !commandExists(command));
  if (missing.length > 0) {
    fail(
      `Missing required command(s): ${missing.join(", ")}\n` +
      "Install git, Node.js/npm 18+, and Rust/Cargo before running setup."
    );
  }
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    shell: isWindows,
  });
  return !result.error && result.status === 0;
}

function ensureBaseCheckout(projectDir, baseRepo) {
  if (!existsSync(projectDir)) {
    run("git", ["clone", baseRepo, projectDir], { cwd: rootDir });
    return;
  }

  ensureDirectory(projectDir, "project directory");
  if (!existsSync(join(projectDir, ".git"))) {
    fail(`Target exists but is not a git checkout: ${projectDir}`);
  }
  log("Using existing base checkout.");
}

function applyOverlay(overlayDir, projectDir) {
  log("Applying overlay.");
  if (args.dryRun) {
    log(`DRY RUN: copy ${overlayDir} -> ${projectDir}`);
    return;
  }
  cpSync(overlayDir, projectDir, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
}

function installFrontend(projectDir) {
  run("npm", ["install", "--no-audit", "--no-fund"], { cwd: projectDir });
  run("npm", ["install", "--no-audit", "--no-fund", ...setupConfig.npmPackages], {
    cwd: projectDir,
  });
  run("npm", ["pkg", "set", "scripts.tauri=tauri"], { cwd: projectDir });
  run("npm", ["uninstall", "xlsx", "--no-audit", "--no-fund"], {
    cwd: projectDir,
    allowFailure: true,
  });
}

function installRustPlugins(srcTauriDir) {
  if (!args.dryRun) {
    ensureDirectory(srcTauriDir, "src-tauri directory");
  }
  const cargoTomlPath = join(srcTauriDir, "Cargo.toml");
  const cargoToml = !args.dryRun && existsSync(cargoTomlPath)
    ? readFileSync(cargoTomlPath, "utf8")
    : "";
  for (const cargoPackage of setupConfig.cargoPackages) {
    if (!args.dryRun && cargoTomlHasDependency(cargoToml, cargoPackage.name)) {
      log(`cargo package already present: ${cargoPackage.name}`);
      continue;
    }
    run("cargo", ["add", cargoPackage.name, ...(cargoPackage.args ?? [])], {
      cwd: srcTauriDir,
    });
  }
}

function cargoTomlHasDependency(cargoToml, packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\n)\\s*${escaped}\\s*=`, "m").test(cargoToml);
}

function run(command, commandArgs, { cwd, allowFailure = false } = {}) {
  const prettyCwd = cwd ? ` (${cwd})` : "";
  log(`${command} ${commandArgs.join(" ")}${prettyCwd}`);

  if (args.dryRun) {
    return;
  }

  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: "inherit",
    shell: isWindows,
  });

  if (result.status !== 0 && !allowFailure) {
    fail(`${command} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function ensureDirectory(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    fail(`Missing ${label}: ${path}`);
  }
}

function log(message) {
  console.log(`==> ${message}`);
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}
