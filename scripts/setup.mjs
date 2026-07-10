#!/usr/bin/env node
import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  const baseRef = args.baseRef ?? setupConfig.baseRef;

  ensureDirectory(overlayDir, "overlay folder");
  requireCommands(["git", "npm", "cargo"]);

  log(`Base repo: ${baseRepo}`);
  log(`Base ref: ${baseRef}`);
  log(`Project dir: ${projectDir}`);
  if (args.dryRun) {
    log("Dry run: commands are printed but clone, copy, and installs are skipped.");
  }

  ensureBaseCheckout(projectDir, baseRepo, baseRef);
  applyOverlay(overlayDir, projectDir);
  applyDesktopIntegration(projectDir);
  installFrontend(projectDir);
  installRustPlugins(join(projectDir, "src-tauri"));

  log("Updater integration applied. Apply the remaining manual patches per src/patches/PATCHES.md and PATCHES_FULL.md.");
  log("Then run: npm run tauri build");
}

function parseArgs(rawArgs) {
  const parsed = {
    dryRun: false,
    projectDir: undefined,
    baseRepo: undefined,
    baseRef: undefined,
  };
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--project-dir") {
      parsed.projectDir = readValue(rawArgs, ++i, arg);
    } else if (arg === "--base-repo") {
      parsed.baseRepo = readValue(rawArgs, ++i, arg);
    } else if (arg === "--base-ref") {
      parsed.baseRef = readValue(rawArgs, ++i, arg);
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
  --base-ref <ref>       Override the pinned base commit, branch, or tag.
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
  if (!config.projectName || !config.baseRepo || !config.baseRef) {
    fail("drawdbDesktopSetup requires projectName, baseRepo, and baseRef.");
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

function ensureBaseCheckout(projectDir, baseRepo, baseRef) {
  if (!existsSync(projectDir)) {
    run("git", ["clone", baseRepo, projectDir], { cwd: rootDir });
    run("git", ["checkout", "--detach", baseRef], { cwd: projectDir });
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

function applyDesktopIntegration(projectDir) {
  log("Applying release-critical desktop integration.");
  if (args.dryRun) {
    log("DRY RUN: wire the updater into ControlPanel and the upstream EN/JA dictionaries");
    return;
  }

  const controlPanel = join(projectDir, "src/components/EditorHeader/ControlPanel.jsx");
  replaceRequired(
    controlPanel,
    'import { useContext, useState } from "react";',
    'import { useContext, useEffect, useState } from "react";',
  );
  replaceRequired(
    controlPanel,
    'import { exportSavedData } from "../../utils/exportSavedData";',
    'import { exportSavedData } from "../../utils/exportSavedData";\n' +
      'import { checkForAppUpdates } from "../../utils/appUpdates";\n' +
      'import { setLocale as setDesktopLocale, t as desktopT } from "../../i18n/index.js";',
  );
  replaceRequired(
    controlPanel,
    `  const navigate = useNavigate();

  const invertLayout = (component) =>`,
    `  const navigate = useNavigate();

  const [updateProgress, setUpdateProgress] = useState(null);
  const checkUpdates = (manual = false) => {
    setDesktopLocale(i18n.language === "jp" ? "ja" : i18n.language);
    return checkForAppUpdates({ manual, onProgress: setUpdateProgress });
  };

  useEffect(() => {
    setDesktopLocale(i18n.language === "jp" ? "ja" : i18n.language);
    const timer = window.setTimeout(() => {
      void checkForAppUpdates({ onProgress: setUpdateProgress });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [i18n.language]);

  const invertLayout = (component) =>`,
  );
  replaceRequired(
    controlPanel,
    `      exit: {
        function: () => {
          save();
          if (saveState === State.SAVED) navigate("/");
        },
      },`,
    `      check_updates: {
        function: () => checkUpdates(true),
      },
      exit: {
        function: () => {
          save();
          if (saveState === State.SAVED) navigate("/");
        },
      },`,
  );
  replaceRequired(
    controlPanel,
    `      </div>
      <Modal
        modal={modal}`,
    `      </div>
      {updateProgress?.status === "downloading" && (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-4 top-4 z-[10000] rounded-md bg-gray-900 px-4 py-3 text-sm text-white shadow-lg"
        >
          {updateProgress.percent == null
            ? desktopT("update.downloading")
            : desktopT("update.downloadingProgress", {
                percent: updateProgress.percent,
              })}
        </div>
      )}
      <Modal
        modal={modal}`,
  );

  replaceRequired(
    join(projectDir, "src/i18n/locales/en.js"),
    '    exit: "Exit",',
    '    check_updates: "Check for updates...",\n    exit: "Exit",',
  );
  replaceRequired(
    join(projectDir, "src/i18n/locales/jp.js"),
    '    exit: "終了",',
    '    check_updates: "更新を確認...",\n    exit: "終了",',
  );
}

function replaceRequired(path, before, after) {
  const source = readFileSync(path, "utf8");
  if (source.includes(after)) {
    return;
  }
  if (!source.includes(before)) {
    fail(`Desktop integration anchor not found in ${path}: ${before.slice(0, 80)}`);
  }
  writeFileSync(path, source.replace(before, after));
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
