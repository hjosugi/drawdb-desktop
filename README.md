<p align="center">
  <img src="assets/icon.png" width="96" alt="drawDB Desktop icon">
</p>

# drawDB Desktop Overlay

[日本語](README.ja.md)

Tauri overlay for drawDB with local files, Excel, SQL, and EN/JA i18n.

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
