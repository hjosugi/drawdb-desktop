# Upstream tracking

This repository is an integrated desktop fork of
[`drawdb-io/drawdb`](https://github.com/drawdb-io/drawdb). It no longer builds
by copying an overlay onto a second checkout.

The integration baseline is upstream commit
`b24ad20b6588b9b99609e8a03b87efa7b28cf245` (2026-07-07). The repository
records an exact-tree snapshot of that commit as a merge parent.

The official repository's older history contains a credential-shaped value
that GitHub Push Protection rejects even though it is not present in the
current tree. Do not bypass Push Protection or merge the official history
directly. Snapshot commits contain the exact reviewed upstream tree, an
`Upstream-Commit` trailer, and no historical upstream blobs. Each new snapshot
uses the previous snapshot as its parent, providing a safe three-way merge base
for the delta between upstream revisions.

## Updating from upstream

```sh
git remote add upstream https://github.com/drawdb-io/drawdb.git
git fetch upstream
git switch main
scripts/update-upstream-snapshot.sh upstream/main
npm ci
npm run lint
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings
```

Before merging, inspect the official range and verify the fetched target. The
snapshot helper refuses dirty worktrees and an unchanged baseline. After it
creates the snapshot merge, resolve conflicts by preserving the desktop
integration in `src/desktop/`, the `FilePathProvider` wrapper in `src/main.jsx`,
the desktop hooks used by `Workspace.jsx` and `ControlPanel.jsx`, and the Tauri
application in `src-tauri/`. Update this baseline note after the merge is
verified.

Run `npm run desktop:dev` for interactive desktop testing. Changes to file
opening, close/quit handling, installers, updater behavior, or native dialogs
must also follow the relevant rows in
[`docs/validation-matrix.md`](docs/validation-matrix.md).

For an audit of a snapshot, fetch its official `Upstream-Commit` and compare
trees. A correctly created snapshot produces no diff:

```sh
snapshot="$(git log --first-parent --merges --grep='^chore: record drawDB upstream snapshot ' -1 --format='%P' | awk '{print $2}')"
official="$(git show -s --format='%B' "$snapshot" | sed -n 's/^Upstream-Commit: //p' | tail -n 1)"
git diff --exit-code "$official" "$snapshot"
```
