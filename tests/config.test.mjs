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
    expect(setup.npmPackages).toEqual(expect.arrayContaining([
      "jszip",
      "exceljs",
      "@tauri-apps/plugin-opener@2.5.4",
    ]));
    expect(setup.cargoPackages.map((pkg) => pkg.name)).toEqual(expect.arrayContaining([
      "tauri-plugin-fs",
      "tauri-plugin-dialog",
      "tauri-plugin-single-instance",
      "tauri-plugin-sql",
      "tauri-plugin-opener",
    ]));
    expect(pkg.scripts.setup).toBe("node scripts/setup.mjs");
  });

  it("grants local-history filesystem and opener permissions", () => {
    const capabilities = readJson("overlay/src-tauri/capabilities/default.json");
    const permissions = capabilities.permissions;
    const scope = permissions.find((permission) => permission.identifier === "fs:scope");

    expect(permissions).toEqual(expect.arrayContaining([
      "fs:allow-read-dir",
      "fs:allow-remove",
      "fs:allow-stat",
      "opener:default",
      "opener:allow-open-path",
    ]));
    expect(scope.allow.map((entry) => entry.path)).toEqual(expect.arrayContaining(["$APPDATA/**"]));
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

  it("verifies the Linux x64 RPM artifact in Fedora after the release build", () => {
    const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(releaseWorkflow).toContain("verify-linux-x64-rpm");
    expect(releaseWorkflow).toContain("needs: build");
    expect(releaseWorkflow).toContain("drawdb-ubuntu-22.04-x64");
    expect(releaseWorkflow).toContain("fedora:latest");
    expect(releaseWorkflow).toContain("rpm -qip");
    expect(releaseWorkflow).toContain("rpm -qp --requires");
    expect(releaseWorkflow).toContain("dnf install -y");
    expect(releaseWorkflow).toContain("command -v");
    expect(releaseWorkflow).toContain("xorg-x11-server-Xvfb");
    expect(releaseWorkflow).toContain("dbus-run-session");
    expect(releaseWorkflow).toContain("WEBKIT_DISABLE_COMPOSITING_MODE=1");
    expect(releaseWorkflow).toContain("dnf remove -y");
  });

  it("documents supported OS and package validation coverage", () => {
    const releaseDocs = readFileSync("docs/release-packaging.md", "utf8");
    const validationMatrix = readFileSync("docs/validation-matrix.md", "utf8");
    const readme = readFileSync("README.md", "utf8");

    expect(releaseDocs).toContain("first-party");
    expect(releaseDocs).toContain("Fedora-install-and-headless-launch-smoke-tests");
    expect(releaseDocs).toContain("Flatpak");
    expect(releaseDocs).toContain("AUR");
    expect(releaseDocs).toContain("Snap");
    expect(readme).toContain("Fedora-install-and-headless-launch-smoke-tests");

    for (const target of [
      "Windows 10 x64",
      "Windows 11 x64",
      "Windows 11 ARM64",
      "macOS Intel",
      "macOS Apple Silicon",
      "Ubuntu 22.04 x64",
      "Ubuntu 22.04 ARM64",
      "Ubuntu 24.04 x64",
      "Fedora latest x64",
    ]) {
      expect(validationMatrix).toContain(target);
    }

    for (const format of ["NSIS `.exe`", "MSI `.msi`", "`.dmg`", "`.deb`", "`.rpm`", "`.AppImage`"]) {
      expect(validationMatrix).toContain(format);
    }

    expect(validationMatrix).toContain("CI or VM checks");
    expect(validationMatrix).toContain("physical-device validation");
    expect(validationMatrix).toContain("Fedora container RPM inspection");
    expect(validationMatrix).toContain("Xvfb headless launch smoke");
    expect(validationMatrix).toContain("Flatpak, AUR, and Snap are not first-party release channels yet");
  });
});
