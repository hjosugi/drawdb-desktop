# Contributing

drawDB Desktop is an integrated desktop fork of
[`drawdb-io/drawdb`](https://github.com/drawdb-io/drawdb). Changes are made and
tested directly in this repository; there is no overlay or manual patch step.

## Local checks

Use Node.js 20.19 or newer and the current stable Rust toolchain.

```sh
npm ci
npm run lint
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

Run `npm run desktop:dev` for interactive desktop testing. Changes to file
opening, close/quit handling, installers, updater behavior, or native dialogs
must also follow the relevant rows in
[`docs/validation-matrix.md`](docs/validation-matrix.md).

## Updating drawDB upstream

The current upstream baseline and integration notes are recorded in
[`UPSTREAM.md`](UPSTREAM.md). Configure the remote once:

```sh
git remote add upstream https://github.com/drawdb-io/drawdb.git
git fetch upstream
```

Then merge a reviewed upstream revision instead of copying files:

```sh
git switch main
git fetch upstream
git merge --no-ff upstream/main
```

When resolving conflicts, preserve the desktop integration in `src/desktop/`,
the `FilePathProvider` in `src/main.jsx`, the desktop hooks in `Workspace.jsx`
and `ControlPanel.jsx`, and the Tauri application in `src-tauri/`. Run every
local check above, exercise the desktop validation matrix, and update the
baseline recorded in `UPSTREAM.md` in the same change.

## Pull requests

Keep changes focused, document user-visible behavior, and add regression tests
for fixes. Do not commit generated `dist/`, coverage, Cargo target, or Tauri
schema output.
