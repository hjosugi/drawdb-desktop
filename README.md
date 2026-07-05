<p align="center">
  <img src="assets/icon.png" width="96" alt="drawDB Desktop icon">
</p>

# drawDB Desktop Overlay

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

RPM is a first-party Linux package. The release workflow downloads the Linux x64
RPM artifact and Fedora-install-and-headless-launch-smoke-tests it in CI with
`dnf`, D-Bus, and Xvfb; full GUI release validation remains tracked separately.

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

The setup script clones the base drawDB-App checkout, copies `overlay/`, installs the frontend and Rust dependencies listed in `package.json`, and leaves the app ready for the manual patch steps in `APPLY_PATCH.md`. Use `npm run setup:dry-run` to validate the setup plan without cloning or installing.

## Tests

```sh
npm test
```
