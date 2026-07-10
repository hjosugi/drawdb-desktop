<p align="center">
  <img src="assets/icon.png" width="96" alt="drawDB Desktop icon">
</p>

# drawDB Desktop Overlay

[![CI](https://github.com/hjosugi/drawdb-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/hjosugi/drawdb-desktop/actions/workflows/ci.yml)

[日本語](README.ja.md)

Tauri overlay for drawDB with local files, Excel, SQL, and EN/JA i18n.

## Downloads

Release artifacts are built by GitHub Actions. See
[`docs/release-packaging.md`](docs/release-packaging.md) for the packaging
policy and [`docs/validation-matrix.md`](docs/validation-matrix.md) for current
CI/manual verification coverage.

| Platform | Architectures | Formats |
| --- | --- | --- |
| Windows | x64 | NSIS `.exe`, MSI `.msi` |
| Windows | ARM64 | NSIS `.exe` |
| macOS | Intel, Apple Silicon | `.dmg`, `.app` |
| Linux | x64, ARM64 | `.deb`, `.rpm`, `.AppImage` |

Windows NSIS and MSI installers bundle the WebView2 Runtime offline installer.
This makes Windows artifacts larger, but a clean Windows 10 machine without
WebView2 should be able to install and launch drawDB without a separate runtime
download step.

The desktop app is configured for Tauri's signed updater. Release builds publish
`latest.json` to GitHub Releases and the app checks that endpoint on startup and
from the File menu. Maintainers must set `TAURI_SIGNING_PRIVATE_KEY` and, if the
key is encrypted, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as GitHub Actions
secrets before publishing updater-enabled releases.

Release builds also include guarded OS signing hooks. Windows Authenticode
signing uses Azure Artifact Signing secrets or a runner certificate thumbprint;
macOS uses Tauri's Developer ID signing/notarization environment variables with
hardened runtime enabled.

RPM is a first-party Linux package. The release workflow downloads the Linux x64
RPM artifact and Fedora-install-and-headless-launch-smoke-tests it in CI with
`dnf`, D-Bus, and Xvfb; full GUI release validation remains tracked separately.
Linux `.deb` and `.rpm` packages include drawDB MIME metadata for `.ddb` and
`.ddbpack`. AppImage is portable and does not auto-register file associations
unless the user integrates it with Gear Lever, appimaged, or an equivalent tool.

Flatpak, AUR, and Snap publishing are deferred until release asset names are
stable, the required store/registry credentials are available, and the relevant
packaging policy review is complete.

## Setup

Requirements: git, Node.js 18+, npm, and Rust/Cargo.

```sh
npm run setup
```

The compatibility wrappers call the same Node setup script:

```sh
./setup.sh
```

```powershell
.\setup.ps1
```

The setup script clones the pinned, CI-tested base drawDB-App revision, copies `overlay/`, installs
the frontend and Rust dependencies listed in `package.json`, and automatically
wires the release-critical updater UI. The remaining feature integrations are
documented in `APPLY_PATCH.md`. Use `npm run setup:dry-run` to validate the setup
plan without cloning or installing.

## Headless CLI

Use the CLI for CI-safe `.ddb` validation and conversion without starting the
desktop app. See [`docs/headless-cli.md`](docs/headless-cli.md) for details.

```sh
node scripts/drawdb-cli.mjs validate schema.ddb
node scripts/drawdb-cli.mjs export --to sql --dialect postgres schema.ddb -o schema.sql
node scripts/drawdb-cli.mjs export --to xlsx schema.ddb -o tables.xlsx
node scripts/drawdb-cli.mjs import --from sql --dialect mysql schema.sql -o schema.ddb
```

## Tests

```sh
npm test
```

## License

0BSD. You can use, copy, modify, and distribute this project for almost any purpose.
