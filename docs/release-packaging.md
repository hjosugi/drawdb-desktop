# Release packaging policy

This project publishes GitHub Release artifacts from `.github/workflows/release.yml`.
The workflow supports conditional Windows Authenticode signing, macOS Developer
ID signing/notarization, and Tauri updater artifact signing when the maintainer
has configured the required GitHub Actions secrets. Microsoft Store, Flathub,
Snap Store, and AUR publication need separate credentials and are not claimed by
CI. See
[`validation-matrix.md`](validation-matrix.md) for the current split between CI
coverage and manual release validation.

The tagged release path pins the upstream drawDB-App commit used by the CI
overlay-build gate. Update both workflows together after validating a newer
upstream revision; workflow dispatch can override `base_ref` for an explicit
compatibility build.

## OS code signing

Windows bundles use `bundle.windows.signCommand`, which calls
`overlay/src-tauri/scripts/sign-windows.ps1` during Tauri bundling. The script is
credential-gated:

- Azure Artifact Signing path: set `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
  `AZURE_CLIENT_SECRET`, `AZURE_ARTIFACT_SIGNING_ENDPOINT`,
  `AZURE_ARTIFACT_SIGNING_ACCOUNT`, and
  `AZURE_ARTIFACT_SIGNING_CERT_PROFILE`. The release workflow installs Tauri's
  documented `artifact-signing-cli`, signs through the configured account and
  certificate profile, and verifies with `signtool verify /pa`.
- Local/enterprise certificate path: provide a certificate in the runner's
  certificate store and set `WINDOWS_CERTIFICATE_THUMBPRINT`.
- If neither configuration is present, the script logs that Windows signing is
  skipped and leaves the bundle unsigned so non-release CI remains usable.

macOS bundles set `bundle.macOS.hardenedRuntime: true` and use
`entitlements.plist` with the JavaScriptCore JIT entitlement needed by WKWebView
on Apple Silicon. Tauri signs and notarizes on macOS runners when the usual
Apple environment variables are present:

- Certificate: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`.
- Apple ID notarization: `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.
- App Store Connect API notarization: `APPLE_API_ISSUER`, `APPLE_API_KEY`, and
  `APPLE_API_PRIVATE_KEY`. The workflow writes the private key to a protected
  runner-temporary file and exports `APPLE_API_KEY_PATH` only for the build.

Maintainers still need the external account setup: Azure Artifact Signing or an
OV/EV Authenticode certificate for Windows, and Apple Developer Program access
with a Developer ID Application certificate for macOS. Before publishing a
non-draft release, verify `signtool verify /pa` for Windows artifacts and
`xcrun stapler validate` for macOS `.app`/`.dmg` artifacts.

## Auto-updater artifacts

`overlay/src-tauri/tauri.conf.json` enables `bundle.createUpdaterArtifacts` and
points the updater at:

```text
https://github.com/hjosugi/drawdb-desktop/releases/latest/download/latest.json
```

The public updater key is committed in the Tauri config. Keep the matching
private key out of the repository and store its content in the
`TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret. If the private key is
password-protected, also set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

`release.yml` uses `tauri-apps/tauri-action@v1` with `uploadUpdaterJson: true`
and `updaterJsonPreferNsis: true`, so the draft GitHub Release receives the
platform bundles, `.sig` files, and `latest.json`. Before publishing a release,
verify an older installed build can detect, download, verify, install, and
restart into the new version on Windows, macOS, and Linux AppImage.

## Release artifacts

| Platform | Architecture | Formats | CI source |
| --- | --- | --- | --- |
| Windows | x64 | NSIS `.exe`, MSI `.msi` | `windows-latest` |
| Windows | ARM64 | NSIS `.exe` | `windows-11-arm` |
| macOS | Intel | `.dmg`, `.app` | `macos-latest` + `x86_64-apple-darwin` |
| macOS | Apple Silicon | `.dmg`, `.app` | `macos-latest` + `aarch64-apple-darwin` |
| Linux | x64 | `.deb`, `.rpm`, `.AppImage` | `ubuntu-22.04` |
| Linux | ARM64 | `.deb`, `.rpm`, `.AppImage` | `ubuntu-22.04-arm` |

## Windows WebView2 runtime policy

Windows installers explicitly set Tauri
`bundle.windows.webviewInstallMode` to `{ "type": "offlineInstaller" }`.
This applies to both NSIS and MSI output from the shared Tauri configuration.

The policy favors clean Windows 10 installability over smaller downloads:

- A Windows 10 machine without the Microsoft Edge WebView2 Runtime should be
  able to install and launch drawDB from the downloaded installer without a
  separate WebView2 runtime download during installation.
- The Windows artifacts are expected to be larger because Tauri embeds the
  Evergreen WebView2 Runtime offline installer.
- The app still uses the system Evergreen WebView2 Runtime after installation so
  runtime security updates remain managed by Microsoft; the project does not
  pin a fixed WebView2 runtime version.

## Desktop security policy

The Tauri desktop shell ships with an explicit CSP in
`overlay/src-tauri/tauri.conf.json`; it must not be set to `null`. The policy is
intentionally local-first: scripts are app-local, styles allow inline CSS for
the existing UI, images allow local/data/blob/asset URLs, IPC is limited to the
Tauri IPC endpoints, and `object-src`, `base-uri`, and `frame-ancestors` are
disabled.

The default capability file is limited to dialog/open/save, local filesystem
operations needed for user-selected diagrams and local history, opener reveal,
and the SQLite plugin. Filesystem scope should stay within user document,
desktop, downloads, `~/drawDB`, and app config/data locations unless a release
issue documents why a broader path is required.

Linux builds stay on Ubuntu 22.04 as the glibc baseline for compatibility with
older supported distributions. The RPM bundle uses the Tauri `bundle.linux.rpm`
metadata in `overlay/src-tauri/tauri.conf.json`, including runtime dependencies
for WebKitGTK, GTK, AppIndicator, and librsvg. The Linux x64 RPM is a first-party
artifact and the release workflow downloads the `ubuntu-22.04` x64 artifact after
the build matrix, inspects the `.rpm`, installs it with `dnf` in a Fedora
container, verifies the installed package and binary, runs a bounded Xvfb launch
smoke test, and removes it.

## Linux file associations

The Linux `.deb` and `.rpm` packages are expected to register drawDB as the
default-capable editor for `.ddb` and `.ddbpack` files:

- `bundle.fileAssociations` uses drawDB-owned MIME types:
  `application/x-drawdb` and `application/x-drawdbpack`.
- `overlay/src-tauri/linux/app.drawdb.desktop.xml` defines the shared MIME
  database globs for `*.ddb` and `*.ddbpack`.
- The Tauri Linux package `files` maps install that MIME XML, AppStream
  metadata, and hicolor mimetype icons into `.deb`, `.rpm`, and `.AppImage`
  layouts.
- `.deb` and `.rpm` post-install/post-remove hooks refresh the shared MIME,
  desktop, and hicolor icon caches when the host distribution provides those
  cache tools.
- `overlay/src-tauri/linux/drawdb.desktop.hbs` keeps `MimeType=` aligned with
  the Tauri file associations and sets `Exec={{exec}} %F` so file managers pass
  selected local files through argv.

Manual release validation for installed `.deb` and `.rpm` packages should
include:

```sh
xdg-mime query filetype sample.ddb
xdg-mime query filetype sample.ddbpack
xdg-mime query default application/x-drawdb
xdg-mime query default application/x-drawdbpack
grep '^Exec=' /usr/share/applications/drawDB.desktop
```

The expected MIME filetype values are `application/x-drawdb` and
`application/x-drawdbpack`; the expected default handler is `drawDB.desktop`.
The `Exec=` line must keep `%F`. Complete release sign-off still requires
double-click testing on Ubuntu GNOME and Fedora KDE with the app closed and with
an existing drawDB instance already running.

AppImage remains a portable artifact and does not automatically install or claim
system file associations by itself. The AppImage includes the same desktop,
MIME, mimetype icon, and AppStream metadata for integration tools, but users must
integrate it with Gear Lever, appimaged, or an equivalent desktop integration
tool before `xdg-mime default drawDB.desktop application/x-drawdb
application/x-drawdbpack` can be expected to persist. Any manual AppImage
desktop entry must preserve `%F` in `Exec=` for file-manager opens.

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
For Windows 10, include a clean VM without WebView2 Runtime already installed and
verify both NSIS and MSI reach first launch from the installer alone.
