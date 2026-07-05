import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const jsonFiles = [
  "overlay/src-tauri/tauri.conf.json",
  "overlay/src-tauri/capabilities/default.json",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("shipped JSON config", () => {
  it.each(jsonFiles)("%s parses", (path) => {
    expect(() => readJson(path)).not.toThrow();
  });

  it("keeps setup dependency lists centralized in package.json", () => {
    const pkg = readJson("package.json");
    const setup = pkg.drawdbDesktopSetup;

    expect(setup).toBeTruthy();
    expect(setup.npmPackages).toEqual(expect.arrayContaining(["jszip", "exceljs"]));
    expect(setup.cargoPackages.map((pkg) => pkg.name)).toEqual(expect.arrayContaining([
      "tauri-plugin-fs",
      "tauri-plugin-dialog",
      "tauri-plugin-single-instance",
      "tauri-plugin-sql",
    ]));
    expect(pkg.scripts.setup).toBe("node scripts/setup.mjs");
  });

  it("requests every first-party release bundle, including rpm", () => {
    const config = readJson("overlay/src-tauri/tauri.conf.json");
    expect(config.bundle.targets).toEqual(expect.arrayContaining([
      "nsis",
      "msi",
      "deb",
      "rpm",
      "appimage",
      "dmg",
    ]));
    expect(config.bundle.license).toBe("AGPL-3.0");
    expect(config.bundle.linux.rpm.depends).toEqual(expect.arrayContaining([
      "webkit2gtk4.1",
      "gtk3",
      "libappindicator-gtk3",
      "librsvg2",
    ]));
  });

  it("keeps release workflow coverage aligned with supported architectures", () => {
    const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(releaseWorkflow).toContain("ubuntu-22.04-arm");
    expect(releaseWorkflow).toContain("windows-11-arm");
    expect(releaseWorkflow).toContain("aarch64-pc-windows-msvc");
    expect(releaseWorkflow).toContain("*.rpm");
    expect(releaseWorkflow).toContain("rpm xdg-utils");
    expect(releaseWorkflow).toContain("--bundles nsis");
  });
});
