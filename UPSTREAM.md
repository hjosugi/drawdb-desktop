# Upstream tracking

This repository is an integrated desktop fork of
[`drawdb-io/drawdb`](https://github.com/drawdb-io/drawdb). It no longer builds
by copying an overlay onto a second checkout.

The integration baseline is upstream commit
`b24ad20b6588b9b99609e8a03b87efa7b28cf245` (2026-07-07). The repository
history records that commit as a merge parent so later upstream updates have a
real merge base.

## Updating from upstream

```sh
git remote add upstream https://github.com/drawdb-io/drawdb.git
git fetch upstream
git switch main
git merge --no-ff upstream/main
npm ci
npm run lint
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings
```

Resolve conflicts by preserving the desktop integration in `src/desktop/`, the
`FilePathProvider` wrapper in `src/main.jsx`, the desktop hooks used by
`Workspace.jsx` and `ControlPanel.jsx`, and the Tauri application in
`src-tauri/`. Update this baseline note after the merge is verified.
