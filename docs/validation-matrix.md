# Release validation matrix

This matrix records what the release workflow proves automatically and what must
still be checked manually before publishing a non-draft release. CI or VM checks
are acceptable substitutes only where the table says so; otherwise, do not treat
hosted-runner builds as physical-device validation.

## Current coverage

| Target | Release packages | CI coverage | Manual release status | Notes |
| --- | --- | --- | --- | --- |
| Windows 10 x64 | NSIS `.exe`, MSI `.msi` | Build artifacts from `windows-latest` only | Pending physical or VM install, launch, feature, and uninstall checks | GitHub-hosted Windows is not a Windows 10 desktop validation substitute. |
| Windows 11 x64 | NSIS `.exe`, MSI `.msi` | Build artifacts from `windows-latest` only | Pending physical or VM install, launch, feature, and uninstall checks | Use the x64 Windows artifacts. |
| Windows 11 ARM64 | NSIS `.exe` | Build artifact from `windows-11-arm` | Pending ARM device or VM install, launch, feature, and uninstall checks | MSI ARM64 remains deferred until device verification. |
| macOS Intel | `.dmg`, `.app` | Build artifacts from `macos-latest` with `x86_64-apple-darwin` | Pending Intel Mac install, launch, feature, and uninstall checks | Hosted macOS builds do not prove Finder association or user launch behavior. |
| macOS Apple Silicon | `.dmg`, `.app` | Build artifacts from `macos-latest` with `aarch64-apple-darwin` | Pending Apple Silicon Mac install, launch, feature, and uninstall checks | Physical hardware is preferred for release sign-off. |
| Ubuntu 22.04 x64 | `.deb`, `.rpm`, `.AppImage` | Build artifacts from `ubuntu-22.04` | Pending VM or physical install, launch, feature, and uninstall checks | Ubuntu 22.04 is the Linux glibc baseline. |
| Ubuntu 22.04 ARM64 | `.deb`, `.rpm`, `.AppImage` | Build artifacts from `ubuntu-22.04-arm` | Pending ARM VM or physical install, launch, feature, and uninstall checks | No hosted install smoke test is claimed. |
| Ubuntu 24.04 x64 | `.deb`, `.AppImage` from the Ubuntu 22.04 x64 build | No separate build; compatibility is expected from the 22.04 baseline | Pending VM or physical install, launch, feature, and uninstall checks | Record any dependency gap before release. |
| Fedora latest x64 | `.rpm` from the Ubuntu 22.04 x64 build | Fedora container RPM inspection, `dnf install`, package and binary presence check, Xvfb headless launch smoke, and `dnf remove` | Pending full desktop feature checks on a VM or physical Fedora install | The CI smoke test covers package installability and startup, not the full GUI feature matrix. |

## Manual checklist

For each target that requires manual release validation, record results in issue
#14 before publishing a non-draft release:

- Installer run and uninstall.
- Launch and new diagram creation.
- `.ddb` save and open through the dialog.
- `.ddbpack` save and open.
- `.ddb` double-click association when the app is closed and already running.
- Excel export/import round-trip.
- SQL export for Oracle, MySQL, and PostgreSQL.
- EN/JA switching and Japanese IME input.
- Autosave restore.
- HiDPI or 150% scaling display.

## Deferred channels

Flatpak, AUR, and Snap are not first-party release channels yet. They remain
deferred until release asset naming is stable, required store or registry
credentials are available, and the relevant sandbox or packaging policy review is
complete.
