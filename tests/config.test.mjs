import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const jsonFiles = [
  "src-tauri/tauri.conf.json",
  "src-tauri/capabilities/default.json",
];

const linuxMimeMetadataFiles = {
  "/usr/share/icons/hicolor/32x32/mimetypes/application-x-drawdb.png": "icons/32x32.png",
  "/usr/share/icons/hicolor/32x32/mimetypes/application-x-drawdbpack.png": "icons/32x32.png",
  "/usr/share/icons/hicolor/128x128/mimetypes/application-x-drawdb.png": "icons/128x128.png",
  "/usr/share/icons/hicolor/128x128/mimetypes/application-x-drawdbpack.png": "icons/128x128.png",
  "/usr/share/metainfo/app.drawdb.desktop.metainfo.xml": "linux/app.drawdb.desktop.metainfo.xml",
  "/usr/share/mime/packages/app.drawdb.desktop.xml": "linux/app.drawdb.desktop.xml",
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function cspDirectives(csp) {
  return Object.fromEntries(
    csp
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...values] = directive.split(/\s+/);
        return [name, values];
      }),
  );
}

describe("shipped JSON config", () => {
  it.each(jsonFiles)("%s parses", (path) => {
    expect(() => readJson(path)).not.toThrow();
  });

  it("keeps the Tauri application version aligned across manifests", () => {
    const version = readJson("src-tauri/tauri.conf.json").version;
    const packageJson = readJson("package.json");
    const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
    const cargoLock = readFileSync("src-tauri/Cargo.lock", "utf8");

    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.version).toBe(version);
    expect(cargoToml).toContain(`name = "drawdb-desktop"\nversion = "${version}"`);
    expect(cargoToml).toContain('crate-type = ["rlib"]');
    expect(cargoLock).toContain(`name = "drawdb-desktop"\nversion = "${version}"`);
  });

  it("ships one integrated app with desktop dependencies and no manual overlay step", () => {
    const pkg = readJson("package.json");

    expect(pkg.name).toBe("drawdb-desktop");
    expect(pkg.license).toBe("AGPL-3.0-only");
    expect(pkg.dependencies).toMatchObject({
      "@tauri-apps/api": "2.11.1",
      "@tauri-apps/plugin-dialog": "2.7.1",
      "@tauri-apps/plugin-fs": "2.5.1",
      "@tauri-apps/plugin-opener": "2.5.4",
      "@tauri-apps/plugin-process": "2.3.1",
      "@tauri-apps/plugin-sql": "2.4.0",
      "@tauri-apps/plugin-updater": "2.10.1",
      "@tauri-apps/plugin-window-state": "2.4.1",
      exceljs: "^4.4.0",
      jszip: "^3.10.1",
    });
    expect(pkg.scripts.setup).toBeUndefined();
    expect(pkg.scripts["desktop:build"]).toBe("tauri build");
    expect(pkg.scripts.cli).toBe("node scripts/drawdb-cli.mjs");
    expect(pkg.bin.drawdb).toBe("./scripts/drawdb-cli.mjs");
    expect(existsSync("scripts/setup.mjs")).toBe(false);
    expect(existsSync("overlay")).toBe(false);
    expect(existsSync("APPLY_PATCH.md")).toBe(false);

    expect(readFileSync("src/main.jsx", "utf8")).toContain("<FilePathProvider>");
    expect(readFileSync("src/components/Workspace.jsx", "utf8")).toContain("useDesktopWorkspace({");
    expect(readFileSync("src/components/EditorHeader/ControlPanel.jsx", "utf8")).toContain("useDesktopFileMenu({");

    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toContain('desktopAvailable() ? <Navigate to="/editor" replace />');
    expect(readFileSync("src/main.jsx", "utf8")).toContain("installDesktopExternalLinkHandler()");
    expect(readFileSync("vite.config.js", "utf8")).toContain("lottie_light.js");

    const html = readFileSync("index.html", "utf8");
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).not.toContain("cdnjs.cloudflare.com");
    expect(pkg.dependencies).toMatchObject({
      "@fortawesome/fontawesome-free": "6.5.2",
      "bootstrap-icons": "1.11.3",
    });
  });

  it("grants local-history filesystem and opener permissions", () => {
    const capabilities = readJson("src-tauri/capabilities/default.json");
    const permissions = capabilities.permissions;
    const scope = permissions.find((permission) => permission.identifier === "fs:scope");
    const openerScope = permissions.find(
      (permission) => permission.identifier === "opener:allow-open-path",
    );

    expect(permissions).toEqual(expect.arrayContaining([
      "fs:allow-read-dir",
      "fs:allow-remove",
      "fs:allow-stat",
      "opener:default",
    ]));
    expect(scope.allow.map((entry) => entry.path)).toEqual(expect.arrayContaining(["$APPDATA/**"]));
    expect(openerScope.allow).toEqual([{ path: "$APPDATA/**" }]);
  });

  it("ships a restrictive Tauri content security policy", () => {
    const config = readJson("src-tauri/tauri.conf.json");
    const csp = config.app.security.csp;
    const directives = cspDirectives(csp);

    expect(typeof csp).toBe("string");
    expect(csp).not.toContain("*");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directives["default-src"]).toEqual(["'self'"]);
    expect(directives["script-src"]).toEqual(["'self'"]);
    expect(directives["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directives["img-src"]).toEqual(expect.arrayContaining(["'self'", "data:", "blob:", "asset:", "https://asset.localhost"]));
    expect(directives["font-src"]).toEqual(["'self'", "data:"]);
    expect(directives["connect-src"]).toEqual(expect.arrayContaining(["'self'", "ipc:", "http://ipc.localhost", "https://ipc.localhost"]));
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["base-uri"]).toEqual(["'none'"]);
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
  });

  it("keeps desktop capabilities scoped to app and user-chosen file locations", () => {
    const capabilities = readJson("src-tauri/capabilities/default.json");
    const permissions = capabilities.permissions;
    const scope = permissions.find((permission) => permission.identifier === "fs:scope");
    const scopedPaths = scope.allow.map((entry) => entry.path).sort();

    expect(permissions).not.toEqual(expect.arrayContaining([
      "shell:default",
      "shell:allow-execute",
      "fs:allow-create",
      "fs:allow-copy-file",
      "fs:allow-rename",
    ]));
    expect(scopedPaths).toEqual([
      "$APPCONFIG/**",
      "$APPDATA/**",
      "$DESKTOP/**",
      "$DOCUMENT/**",
      "$DOWNLOAD/**",
      "$HOME/drawDB/**",
    ]);
    expect(scopedPaths).not.toEqual(expect.arrayContaining(["/**", "**", "$HOME/**", "$ROOT/**"]));
  });

  it("uses a frontend-ready handshake for startup file opens", () => {
    const lib = readFileSync("src-tauri/src/lib.rs", "utf8");
    const desktopIO = readFileSync("src/utils/desktopIO.js", "utf8");
    const listenIndex = desktopIO.indexOf('listen("open-file"');
    const readyIndex = desktopIO.indexOf('invoke("frontend_ready"');

    expect(lib).toContain("#[tauri::command]");
    expect(lib).toContain("fn frontend_ready");
    expect(lib).toContain("OpenFileQueue");
    expect(lib).toContain("app.fs_scope().allow_file(&path)");
    expect(lib).toMatch(/tauri::generate_handler!\[\s*frontend_ready,\s*request_app_exit,/);
    expect(lib).not.toContain("thread::sleep");
    expect(lib).not.toContain("Duration::from_millis(700)");
    expect(listenIndex).toBeGreaterThanOrEqual(0);
    expect(readyIndex).toBeGreaterThan(listenIndex);
  });

  it("wires the dirty-close guard and application-level quit handshake", () => {
    const desktopIO = readFileSync("src/utils/desktopIO.js", "utf8");
    const workspace = readFileSync("src/desktop/useDesktopWorkspace.js", "utf8");
    const lib = readFileSync("src-tauri/src/lib.rs", "utf8");
    const capabilities = readJson("src-tauri/capabilities/default.json");

    expect(capabilities.permissions).toEqual(expect.arrayContaining([
      "core:window:default",
      "dialog:allow-message",
    ]));
    expect(desktopIO).toContain("onCloseRequested");
    expect(desktopIO).toContain("onAppExitRequested");
    expect(desktopIO).toContain("requestAppExit");
    expect(desktopIO).toContain("confirmCloseWithUnsavedChanges");
    expect(desktopIO).toContain("buttons: { yes: save, no: discard, cancel }");
    expect(workspace).toContain("fileSaverRef.current.flush()");
    expect(workspace).toContain("fileSaverRef.current.hasPending()");
    expect(workspace).toContain("event.preventDefault()");
    expect(lib).toContain("tauri::RunEvent::ExitRequested");
    expect(lib).toContain('app.emit("app-exit-requested"');
    expect(lib).toContain("fn request_app_exit");
  });

  it("persists Recent Files in the backend and re-grants only remembered paths", () => {
    const lib = readFileSync("src-tauri/src/lib.rs", "utf8");
    const recent = readFileSync("src-tauri/src/recent_files.rs", "utf8");
    const workspace = readFileSync("src/desktop/useDesktopWorkspace.js", "utf8");
    const fileMenu = readFileSync("src/desktop/useDesktopFileMenu.jsx", "utf8");

    for (const command of [
      "recent_files_list",
      "recent_files_add",
      "recent_files_prepare_open",
      "recent_files_remove",
      "recent_files_clear",
    ]) {
      expect(lib).toContain(`recent_files::${command}`);
    }
    expect(lib).toContain("app.manage(recent_files::init(app.handle()))");
    expect(recent).toContain("pub const MAX_RECENT_FILES: usize = 10;");
    expect(recent).toContain("app.fs_scope().is_allowed(&path)");
    expect(recent).toContain(".allow_file(&stored)");
    expect(recent).toContain("app_config_dir()");
    expect(workspace.match(/recordRecentFile\(path\)/g)).toHaveLength(3);
    expect(fileMenu).toContain("recentFilesMenuItems(recentFiles");
    expect(fileMenu).toContain("RECENT_FILE_NOT_FOUND");
  });

  it("writes rotated local logs, records panics, and bridges frontend errors", () => {
    const pkg = readJson("package.json");
    const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
    const capabilities = readJson("src-tauri/capabilities/default.json");
    const lib = readFileSync("src-tauri/src/lib.rs", "utf8");
    const logging = readFileSync("src-tauri/src/logging.rs", "utf8");
    const main = readFileSync("src/main.jsx", "utf8");

    expect(pkg.dependencies["@tauri-apps/plugin-log"]).toBe("2.9.2");
    expect(cargoToml).toContain('tauri-plugin-log = "2"');
    expect(capabilities.permissions).toContain("log:default");
    expect(lib).toContain("logging::install_panic_hook();");
    expect(lib).toContain("tauri::Builder::default().plugin(logging::plugin())");
    expect(lib).toContain("logging::open_log_dir");
    expect(lib).not.toContain("eprintln!");
    expect(logging).toContain("TargetKind::LogDir");
    expect(logging).toContain("RotationStrategy::KeepSome(KEPT_LOG_FILES)");
    expect(logging).toContain("std::panic::set_hook");
    expect(logging).not.toMatch(/sentry/i);
    expect(main.indexOf("installFrontendLogBridge()")).toBeGreaterThanOrEqual(0);
    expect(main.indexOf("installFrontendLogBridge()"))
      .toBeLessThan(main.indexOf("ReactDOM.createRoot"));
    expect(existsSync("docs/logging.md")).toBe(true);
    expect(existsSync("docs/logging.ja.md")).toBe(true);
  });

  it("type-checks desktop modules against the shared diagram types in CI", () => {
    const pkg = readJson("package.json");
    const tsconfig = readJson("tsconfig.json");
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const types = readFileSync("src/types/drawdb.d.ts", "utf8");

    expect(pkg.scripts.typecheck).toBe("tsc -p tsconfig.json");
    expect(pkg.devDependencies.typescript).toMatch(/^5\./);
    expect(tsconfig.compilerOptions).toMatchObject({ allowJs: true, noEmit: true });
    expect(ci).toContain("run: npm run typecheck");
    for (const name of ["Diagram", "Table", "Field", "Relationship", "DdbPayload"]) {
      expect(types).toContain(`export interface ${name} `);
    }
    for (const file of [
      "src/desktop/diagram.js",
      "src/desktop/recentFiles.js",
      "src/desktop/nativeMenu.js",
      "src/utils/ddb.js",
      "src/data/exportSQL/core.js",
      "src/data/importSQL/common.js",
    ]) {
      expect(readFileSync(file, "utf8").startsWith("// @ts-check\n")).toBe(true);
    }
  });

  it("enables Tauri window state persistence for desktop builds", () => {
    const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
    const capabilities = readJson("src-tauri/capabilities/default.json");
    const lib = readFileSync("src-tauri/src/lib.rs", "utf8");

    expect(cargoToml).toContain("tauri-plugin-window-state = \"2\"");
    expect(cargoToml).toContain("[target.'cfg(any(target_os = \"macos\", windows, target_os = \"linux\"))'.dependencies]");
    expect(capabilities.permissions).toEqual(expect.arrayContaining(["window-state:default"]));
    expect(lib).toContain("tauri_plugin_window_state::Builder::default()");
    expect(lib).toContain("tauri_plugin_window_state::StateFlags::SIZE");
    expect(lib).toContain("tauri_plugin_window_state::StateFlags::POSITION");
    expect(lib).toContain("tauri_plugin_window_state::StateFlags::MAXIMIZED");
  });

  it("configures signed GitHub Releases updater support", () => {
    const config = readJson("src-tauri/tauri.conf.json");
    const capabilities = readJson("src-tauri/capabilities/default.json");
    const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
    const lib = readFileSync("src-tauri/src/lib.rs", "utf8");
    const appUpdates = readFileSync("src/utils/appUpdates.js", "utf8");

    expect(config.bundle.createUpdaterArtifacts).toBe(true);
    expect(config.plugins.updater).toMatchObject({
      endpoints: ["https://github.com/hjosugi/drawdb-desktop/releases/latest/download/latest.json"],
      windows: { installMode: "passive" },
    });
    expect(config.plugins.updater.pubkey).toMatch(/^dW50cnVzdGVkIGNvbW1lbnQ6/);
    expect(config.plugins.updater.pubkey.length).toBeGreaterThan(100);
    expect(capabilities.permissions).toEqual(expect.arrayContaining([
      "dialog:allow-ask",
      "dialog:allow-message",
      "process:default",
      "updater:default",
    ]));
    expect(cargoToml).toContain("tauri-plugin-process = \"2\"");
    expect(cargoToml).toContain("tauri-plugin-updater = \"2\"");
    expect(lib).toContain("tauri_plugin_process::init()");
    expect(lib).toContain("tauri_plugin_updater::Builder::new().build()");
    expect(appUpdates).toContain("@tauri-apps/plugin-updater");
    expect(appUpdates).toContain("downloadAndInstall");
    expect(appUpdates).toContain("drawdb-update-progress");
  });

  it("configures conditional OS code signing and macOS notarization inputs", () => {
    const config = readJson("src-tauri/tauri.conf.json");
    const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");
    const windowsSigner = readFileSync("src-tauri/scripts/sign-windows.ps1", "utf8");
    const entitlements = readFileSync("src-tauri/entitlements.plist", "utf8");

    expect(config.bundle.windows).toMatchObject({
      digestAlgorithm: "sha256",
      timestampUrl: "http://timestamp.acs.microsoft.com",
    });
    expect(config.bundle.windows.signCommand).toMatchObject({
      cmd: "powershell",
      args: expect.arrayContaining(["scripts/sign-windows.ps1", "%1"]),
    });
    expect(config.bundle.macOS).toMatchObject({
      hardenedRuntime: true,
      entitlements: "entitlements.plist",
    });
    expect(entitlements).toContain("com.apple.security.cs.allow-jit");
    expect(windowsSigner).toContain("artifact-signing-cli");
    expect(windowsSigner).toContain("signtool verify /pa");
    expect(windowsSigner).toContain("WINDOWS_CERTIFICATE_THUMBPRINT");
    expect(releaseWorkflow).toContain("cargo install artifact-signing-cli --locked");
    expect(releaseWorkflow).toContain("AZURE_ARTIFACT_SIGNING_ENDPOINT");
    expect(releaseWorkflow).toContain("AZURE_ARTIFACT_SIGNING_ACCOUNT");
    expect(releaseWorkflow).toContain("AZURE_ARTIFACT_SIGNING_CERT_PROFILE");
    expect(releaseWorkflow).toContain("WINDOWS_CERTIFICATE_THUMBPRINT");
    expect(releaseWorkflow).toContain("APPLE_CERTIFICATE");
    expect(releaseWorkflow).toContain("APPLE_SIGNING_IDENTITY");
    expect(releaseWorkflow).toContain("APPLE_TEAM_ID");
    expect(releaseWorkflow).toContain("APPLE_API_ISSUER");
    expect(releaseWorkflow).toContain("APPLE_API_PRIVATE_KEY");
    expect(releaseWorkflow).toContain("APPLE_API_KEY_PATH");
    expect(releaseWorkflow).toContain("persist_env APPLE_CERTIFICATE");
    expect(releaseWorkflow).toContain('persist_env APPLE_SIGNING_IDENTITY "-"');
    expect(releaseWorkflow).not.toContain(
      "          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}",
    );
  });

  it("requests every first-party release bundle, including rpm", () => {
    const config = readJson("src-tauri/tauri.conf.json");
    expect(config.bundle.targets).toEqual(expect.arrayContaining([
      "nsis",
      "msi",
      "deb",
      "rpm",
      "appimage",
      "app",
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

  it("declares Linux file associations with drawDB-specific MIME types", () => {
    const config = readJson("src-tauri/tauri.conf.json");
    const associations = Object.fromEntries(
      config.bundle.fileAssociations.map((association) => [association.ext[0], association]),
    );

    expect(Object.keys(associations).sort()).toEqual(["ddb", "ddbpack", "xlsx"]);

    expect(associations.ddb).toMatchObject({
      name: "drawDB Diagram",
      description: "drawDB diagram file",
      role: "Editor",
      mimeType: "application/x-drawdb",
    });
    expect(associations.ddbpack).toMatchObject({
      name: "drawDB Project Pack",
      description: "drawDB project package",
      role: "Editor",
      mimeType: "application/x-drawdbpack",
    });
    expect(associations.xlsx).toMatchObject({
      name: "Excel Workbook",
      description: "Excel workbook imported by drawDB",
      role: "Viewer",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(Object.values(associations).map((association) => association.mimeType)).not.toEqual(expect.arrayContaining([
      "application/json",
      "application/zip",
    ]));

    const rustBackend = readFileSync("src-tauri/src/lib.rs", "utf8");
    for (const extension of Object.keys(associations)) {
      expect(rustBackend).toContain(`lower.ends_with(\".${extension}\")`);
    }
    expect(rustBackend).toContain("tauri::RunEvent::Opened { urls }");
  });

  it("packages Linux shared MIME, mimetype icons, and AppStream metadata", () => {
    const config = readJson("src-tauri/tauri.conf.json");
    const linux = config.bundle.linux;
    const mimeXml = readFileSync("src-tauri/linux/app.drawdb.desktop.xml", "utf8");
    const appStreamXml = readFileSync("src-tauri/linux/app.drawdb.desktop.metainfo.xml", "utf8");

    expect(linux.deb.files).toMatchObject(linuxMimeMetadataFiles);
    expect(linux.rpm.files).toMatchObject(linuxMimeMetadataFiles);
    expect(linux.appimage.files).toMatchObject(linuxMimeMetadataFiles);
    expect(mimeXml).toContain('<mime-type type="application/x-drawdb">');
    expect(mimeXml).toContain('<sub-class-of type="application/json"/>');
    expect(mimeXml).toContain('<glob pattern="*.ddb" weight="80"/>');
    expect(mimeXml).toContain('<icon name="application-x-drawdb"/>');
    expect(mimeXml).toContain('<mime-type type="application/x-drawdbpack">');
    expect(mimeXml).toContain('<sub-class-of type="application/zip"/>');
    expect(mimeXml).toContain('<glob pattern="*.ddbpack" weight="80"/>');
    expect(mimeXml).toContain('<icon name="application-x-drawdbpack"/>');
    expect(appStreamXml).toContain("<id>app.drawdb.desktop</id>");
    expect(appStreamXml).toContain('<launchable type="desktop-id">drawDB.desktop</launchable>');
    expect(appStreamXml).toContain("<mediatype>application/x-drawdb</mediatype>");
    expect(appStreamXml).toContain("<mediatype>application/x-drawdbpack</mediatype>");
    expect(appStreamXml).toContain(
      "<mediatype>application/vnd.openxmlformats-officedocument.spreadsheetml.sheet</mediatype>",
    );
  });

  it("uses Linux desktop entries that pass selected files through argv", () => {
    const config = readJson("src-tauri/tauri.conf.json");
    const template = readFileSync("src-tauri/linux/drawdb.desktop.hbs", "utf8");
    const cacheScript = readFileSync("src-tauri/linux/update-desktop-mime-cache.sh", "utf8");

    expect(config.bundle.linux.deb.desktopTemplate).toBe("linux/drawdb.desktop.hbs");
    expect(config.bundle.linux.rpm.desktopTemplate).toBe("linux/drawdb.desktop.hbs");
    expect(config.bundle.linux.deb.postInstallScript).toBe("linux/update-desktop-mime-cache.sh");
    expect(config.bundle.linux.deb.postRemoveScript).toBe("linux/update-desktop-mime-cache.sh");
    expect(config.bundle.linux.rpm.postInstallScript).toBe("linux/update-desktop-mime-cache.sh");
    expect(config.bundle.linux.rpm.postRemoveScript).toBe("linux/update-desktop-mime-cache.sh");
    expect(template).toContain("Exec={{exec}} %F");
    expect(template).toContain("MimeType={{mime_type}};");
    expect(template).not.toContain("Exec={{exec}}\n");
    expect(cacheScript).toContain("update-mime-database /usr/share/mime");
    expect(cacheScript).toContain("update-desktop-database -q /usr/share/applications");
    expect(cacheScript).toContain("gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor");
  });

  it("bundles the WebView2 runtime installer for Windows 10 machines without WebView2", () => {
    const config = readJson("src-tauri/tauri.conf.json");

    expect(config.bundle.targets).toEqual(expect.arrayContaining(["nsis", "msi"]));
    expect(config.bundle.windows.webviewInstallMode).toEqual({
      type: "offlineInstaller",
    });
  });

  it("keeps release workflow coverage aligned with supported architectures", () => {
    const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(releaseWorkflow).toContain("ubuntu-22.04-arm");
    expect(releaseWorkflow).toContain("windows-11-arm");
    expect(releaseWorkflow).toContain("aarch64-pc-windows-msvc");
    expect(releaseWorkflow).toContain("tauri-apps/tauri-action@v1");
    expect(releaseWorkflow).toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(releaseWorkflow).toContain("uploadUpdaterJson: true");
    expect(releaseWorkflow).toContain("updaterJsonPreferNsis: true");
    expect(releaseWorkflow).toContain(
      "releaseCommitish: ${{ github.event.repository.default_branch }}",
    );
    expect(releaseWorkflow).toContain("*.rpm");
    expect(releaseWorkflow).toContain("*.sig");
    expect(releaseWorkflow).toContain("rpm xdg-utils");
    expect(releaseWorkflow).toContain("--bundles nsis");
  });

  it("records the imported upstream revision without cloning a base app in CI", () => {
    const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");
    const upstream = readFileSync("UPSTREAM.md", "utf8");
    const contributing = readFileSync("CONTRIBUTING.md", "utf8");
    const snapshotHelper = readFileSync("scripts/update-upstream-snapshot.sh", "utf8");
    const baseRevision = "b24ad20b6588b9b99609e8a03b87efa7b28cf245";

    expect(upstream).toContain("drawdb-io/drawdb");
    expect(upstream).toContain(baseRevision);
    expect(contributing).toContain("git remote add upstream https://github.com/drawdb-io/drawdb.git");
    expect(contributing).toContain("scripts/update-upstream-snapshot.sh upstream/main");
    expect(contributing).toContain("Never bypass");
    expect(snapshotHelper).toContain("git commit-tree");
    expect(snapshotHelper).toContain("Upstream-Commit:");
    expect(snapshotHelper).not.toContain("git merge --no-ff upstream/main");
    expect(ciWorkflow).not.toContain("repository: khsuzan/drawDB-App");
    expect(ciWorkflow).toContain("npm audit --omit=dev --audit-level=high");
    expect(releaseWorkflow).not.toContain("base_repo");
    expect(releaseWorkflow).not.toContain("overlay-src");
  });

  it("uses current Node 24 based GitHub action majors", () => {
    const workflows = [
      readFileSync(".github/workflows/ci.yml", "utf8"),
      readFileSync(".github/workflows/release.yml", "utf8"),
    ].join("\n");

    for (const action of [
      "actions/checkout@v7",
      "actions/setup-node@v6",
      "actions/setup-python@v6",
      "actions/upload-artifact@v7",
      "actions/download-artifact@v8",
    ]) {
      expect(workflows).toContain(action);
    }
    expect(workflows).not.toMatch(/actions\/(?:checkout|setup-node)@v4/);
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
    expect(releaseWorkflow).toContain('grep -E "^Exec=.* %F$"');
    expect(releaseWorkflow).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(releaseWorkflow).toContain("dnf remove -y");
  });

  it("verifies generated macOS document associations during release", () => {
    const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(releaseWorkflow).toContain("Verify macOS document associations");
    expect(releaseWorkflow).toContain("CFBundleDocumentTypes");
    expect(releaseWorkflow).toContain('required = {"ddb", "ddbpack", "xlsx"}');
  });

  it("documents supported OS and package validation coverage", () => {
    const releaseDocs = readFileSync("docs/release-packaging.md", "utf8");
    const validationMatrix = readFileSync("docs/validation-matrix.md", "utf8");
    const cliDocs = readFileSync("docs/headless-cli.md", "utf8");
    const readme = readFileSync("README.md", "utf8");

    expect(releaseDocs).toContain("first-party");
    expect(releaseDocs).toContain("Fedora-install-and-headless-launch-smoke-tests");
    expect(releaseDocs).toContain("Flatpak");
    expect(releaseDocs).toContain("AUR");
    expect(releaseDocs).toContain("Snap");
    expect(cliDocs).toContain("drawdb export");
    expect(cliDocs).toContain("validate schema.ddb");
    expect(readme).toContain("Fedora-install-and-headless-launch-smoke-tests");
    expect(readme).toContain("docs/headless-cli.md");
    expect(readme).toContain("WebView2 Runtime offline installer");
    expect(releaseDocs).toContain("bundle.windows.webviewInstallMode");
    expect(releaseDocs).toContain("{ \"type\": \"offlineInstaller\" }");
    expect(releaseDocs).toContain("application/x-drawdb");
    expect(releaseDocs).toContain("Gear Lever");
    expect(releaseDocs).toContain("appimaged");
    expect(validationMatrix).toContain("WebView2 `offlineInstaller`");
    expect(validationMatrix).toContain("WebView2 Runtime is absent before installation");
    expect(validationMatrix).toContain("xdg-mime query default application/x-drawdb");

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
