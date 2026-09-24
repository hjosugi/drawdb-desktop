<!-- i18n: language-switcher -->
[English](validation-matrix.md) | [日本語](validation-matrix.ja.md)

# Release validation matrix

This matrix records what the release workflow proves automatically and what must
still be checked manually before publishing a non-draft release. CI or VM checks
are acceptable substitutes only where the table says so; otherwise, do not treat
hosted-runner builds as physical-device validation.

## Current coverage

| Target | Release packages | CI coverage | Manual release status | Notes |
| --- | --- | --- | --- | --- |
| Windows 10 x64 | NSIS `.exe`, MSI `.msi` with WebView2 `offlineInstaller` | Build artifacts from `windows-latest` only; config test enforces `bundle.windows.webviewInstallMode` | Pending clean VM install, launch, feature, and uninstall checks with WebView2 absent before install | GitHub-hosted Windows is not a Windows 10 desktop validation substitute. |
| Windows 11 x64 | NSIS `.exe`, MSI `.msi` with WebView2 `offlineInstaller` | Build artifacts from `windows-latest` only; config test enforces `bundle.windows.webviewInstallMode` | Pending physical or VM install, launch, feature, and uninstall checks | Use the x64 Windows artifacts. |
| Windows 11 ARM64 | NSIS `.exe` with WebView2 `offlineInstaller` | Build artifact from `windows-11-arm`; config test enforces `bundle.windows.webviewInstallMode` | Pending ARM device or VM install, launch, feature, and uninstall checks | MSI ARM64 remains deferred until device verification. |
| macOS Intel | `.dmg`, `.app` | Build artifacts from `macos-latest` with `x86_64-apple-darwin` | Pending Intel Mac install, launch, feature, and uninstall checks | Hosted macOS builds do not prove Finder association or user launch behavior. |
| macOS Apple Silicon | `.dmg`, `.app` | Build artifacts from `macos-latest` with `aarch64-apple-darwin` | Pending Apple Silicon Mac install, launch, feature, and uninstall checks | Physical hardware is preferred for release sign-off. |
| Ubuntu 22.04 x64 | `.deb`, `.rpm`, `.AppImage` | Build artifacts from `ubuntu-22.04` | Pending VM or physical install, launch, feature, association, and uninstall checks | Ubuntu 22.04 is the Linux glibc baseline; `.deb`/`.rpm` should install `application/x-drawdb` and `application/x-drawdbpack` metadata, while AppImage association requires external desktop integration. |
| Ubuntu 22.04 ARM64 | `.deb`, `.rpm`, `.AppImage` | Build artifacts from `ubuntu-22.04-arm` | Pending ARM VM or physical install, launch, feature, association, and uninstall checks | No hosted install smoke test is claimed; validate `.deb`/`.rpm` associations manually. |
| Ubuntu 24.04 x64 | `.deb`, `.AppImage` from the Ubuntu 22.04 x64 build | No separate build; compatibility is expected from the 22.04 baseline | Pending VM or physical install, launch, feature, association, and uninstall checks | Record any dependency gap before release; AppImage association is not automatic without Gear Lever, appimaged, or equivalent integration. |
| Fedora latest x64 | `.rpm` from the Ubuntu 22.04 x64 build | Fedora container RPM inspection, `dnf install`, package and binary presence check, Xvfb headless launch smoke, and `dnf remove` | Pending full desktop feature and association checks on a VM or physical Fedora install | The CI smoke test covers package installability and startup, not full GUI or KDE file association behavior. |

## Manual checklist

For each target that requires manual release validation, record results in issue
#14 before publishing a non-draft release:

- Installer run and uninstall.
- On Windows 10, install from both NSIS and MSI artifacts on a clean VM where
  WebView2 Runtime is absent before installation, then verify first launch.
- Launch and new diagram creation.
- `.ddb` save and open through the dialog.
- `.ddbpack` save and open.
- Open a `.ddb` outside Documents/Desktop/Downloads, restart the app, and
  reopen it with one click from File > Recent Files; then move or delete a
  remembered file and confirm it is marked "Not found" and removed with an
  error toast when selected.
- `.ddb`, `.ddbpack`, and `.xlsx` double-click association from installed
  `.deb` and `.rpm` packages when the app is closed and already running.
- On both Intel and Apple Silicon macOS, open `.ddb` and `.xlsx` with the app
  not running, open another file while it is running, and drop each format onto
  the Dock icon. Confirm the generated app bundle lists all three supported
  extensions (`ddb`, `ddbpack`, and `xlsx`) in `CFBundleDocumentTypes`.
- Exercise the Save / Discard / Cancel close guard immediately after an edit
  through both the window close control and application-level Quit / Cmd+Q.
- On Linux, confirm `xdg-mime query default application/x-drawdb` and
  `xdg-mime query default application/x-drawdbpack` return `drawDB.desktop`,
  and confirm `/usr/share/applications/drawDB.desktop` keeps `%F` in `Exec=`.
- On Ubuntu GNOME and Fedora KDE, test the association path on Wayland and X11
  where both sessions are available.
- For AppImage, record whether Gear Lever, appimaged, or a manual desktop
  integration was used; automatic file association is not supported without that
  integration.
- On macOS, confirm the native menu bar shows the drawDB application menu
  (About, Check for Updates, Services, Hide, Quit), File (New, Open, Recent
  Files, Save, Save As, Import, Export, Local History, Close Window), Edit,
  View, Window, and Help; that Cmd+N/O/S/Shift+S/W/Q work exactly once; that
  Cmd+C/V/Z still work in text fields and on the canvas; and that labels switch
  when the language is changed. On Windows and Linux, confirm no native menu bar
  is shown and Ctrl+N/O/S/Shift+S/W (Ctrl+Q on Linux) work once.
- Excel export/import round-trip.
- SQL export for Oracle, MySQL, PostgreSQL, and SQL Server, and "Open SQL"
  import of each exported file.
- Schema comparison: compare the open diagram with an older `.ddb`, two `.ddb`
  files, and a Local History snapshot; confirm the colored change list, the
  destructive-change warning, the dialect switch, and saving the migration
  `.sql`. (Applying generated PostgreSQL/MySQL migrations is automated in CI.)
- EN/JA switching and Japanese IME input.
- Autosave restore.
- Install a previous release and verify updater detection, signature validation,
  download progress, install, pre-restart file flush, and relaunch.
- HiDPI or 150% scaling display.

## Deferred channels

Flatpak, AUR, and Snap are not first-party release channels yet. They remain
deferred until release asset naming is stable, required store or registry
credentials are available, and the relevant sandbox or packaging policy review is
complete.
