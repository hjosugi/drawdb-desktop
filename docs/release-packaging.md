# Release packaging policy

This project publishes GitHub Release artifacts from `.github/workflows/release.yml`.
The workflow deliberately builds unsigned installers; code signing, notarization,
Microsoft Store, Flathub, Snap Store, and AUR publication need separate maintainer
credentials and are not claimed by CI. See
[`validation-matrix.md`](validation-matrix.md) for the current split between CI
coverage and manual release validation.

## Release artifacts

| Platform | Architecture | Formats | CI source |
| --- | --- | --- | --- |
| Windows | x64 | NSIS `.exe`, MSI `.msi` | `windows-latest` |
| Windows | ARM64 | NSIS `.exe` | `windows-11-arm` |
| macOS | Intel | `.dmg`, `.app` | `macos-latest` + `x86_64-apple-darwin` |
| macOS | Apple Silicon | `.dmg`, `.app` | `macos-latest` + `aarch64-apple-darwin` |
| Linux | x64 | `.deb`, `.rpm`, `.AppImage` | `ubuntu-22.04` |
| Linux | ARM64 | `.deb`, `.rpm`, `.AppImage` | `ubuntu-22.04-arm` |

Linux builds stay on Ubuntu 22.04 as the glibc baseline for compatibility with
older supported distributions. The RPM bundle uses the Tauri `bundle.linux.rpm`
metadata in `overlay/src-tauri/tauri.conf.json`, including runtime dependencies
for WebKitGTK, GTK, AppIndicator, and librsvg. The Linux x64 RPM is a first-party
artifact and the release workflow downloads the `ubuntu-22.04` x64 artifact after
the build matrix, inspects the `.rpm`, installs it with `dnf` in a Fedora
container, verifies the installed package and binary, runs a bounded Xvfb launch
smoke test, and removes it.

## Linux distribution policy

| Channel | Policy |
| --- | --- |
| RPM | Supported as a first-party GitHub Release artifact. CI Fedora-install-and-headless-launch-smoke-tests the Linux x64 RPM with `dnf`, D-Bus, and Xvfb; maintainers should still complete the full desktop feature matrix during manual Fedora release validation. |
| Flatpak | Deferred. A Flathub submission should wait until the desktop patches are merged into a maintained app repo and a runtime sandbox review is done. |
| AUR | Deferred. A PKGBUILD can wrap the GitHub Release artifacts after release asset names stabilize. |
| Snap | Deferred. Snap publication requires store credentials and confinement review; use AppImage/RPM/DEB until there is user demand. |

## Manual release verification

Before publishing a non-draft release, download the workflow artifacts and record
the real-device matrix in issue #14. At minimum, verify install, launch, file
save/open, `.ddbpack`, file association, Excel round-trip, SQL export, EN/JA
switching, autosave restore, HiDPI display, and uninstall on each supported OS.
