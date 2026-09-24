# Contributing

drawDB Desktop is an integrated desktop fork of
[`drawdb-io/drawdb`](https://github.com/drawdb-io/drawdb). Changes are made and
tested directly in this repository; there is no overlay or manual patch step.

## Local checks

Use Node.js 20.19 or newer and the current stable Rust toolchain.

```sh
npm ci
npm run lint
npm run typecheck
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

## Error handling

Desktop code follows one error policy (`src/desktop/errors.js`):

- I/O and parsing code throws `DesktopError` with a stable code
  (`FILE_NOT_FOUND`, `PERMISSION_DENIED`, `INVALID_JSON`, `INVALID_DIAGRAM`,
  `UNKNOWN_FORMAT`, `ZIP_CORRUPT`, `PACK_INVALID`, `EXCEL_INVALID`,
  `SQL_NO_TABLES`, ...) or lets the platform error propagate unchanged.
- UI handlers never show raw exceptions. They call `notifyError(error, { title,
  kind })`, which classifies platform errors, shows the translated
  `errorCode.<CODE>` message with the technical detail, and records it in the
  log. Every code needs English and Japanese text in `src/i18n/desktop/`.
- Recoverable input problems are reported, not swallowed: a `.ddbpack` with a
  damaged manifest or unreadable entries imports what it can and lists the
  skipped entries in a warning.

## Updating drawDB upstream

The current upstream baseline and integration notes are recorded in
[`UPSTREAM.md`](UPSTREAM.md). Configure the remote once:

```sh
git remote add upstream https://github.com/drawdb-io/drawdb.git
git fetch upstream
```

Then import a reviewed upstream revision through the exact-tree snapshot
helper instead of copying files or merging credential-bearing historical
blobs:

```sh
git switch main
git fetch upstream
scripts/update-upstream-snapshot.sh upstream/main
```

When resolving conflicts, preserve the desktop integration in `src/desktop/`,
the `FilePathProvider` in `src/main.jsx`, the desktop hooks in `Workspace.jsx`
and `ControlPanel.jsx`, and the Tauri application in `src-tauri/`. Never bypass
GitHub Push Protection for upstream history. Run every
local check above, exercise the desktop validation matrix, and update the
baseline recorded in `UPSTREAM.md` in the same change.

## Pull requests

Keep changes focused, document user-visible behavior, and add regression tests
for fixes. Do not commit generated `dist/`, coverage, Cargo target, or Tauri
schema output.
