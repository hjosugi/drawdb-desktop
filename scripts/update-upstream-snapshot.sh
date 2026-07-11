#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "The working tree must be clean before importing upstream." >&2
  exit 1
fi

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "Missing upstream remote. See UPSTREAM.md." >&2
  exit 1
fi

target_ref="${1:-upstream/main}"
git fetch upstream

target_commit="$(git rev-parse --verify "${target_ref}^{commit}")"
target_tree="$(git rev-parse "${target_commit}^{tree}")"
baseline_merge="$(
  git log \
    --first-parent \
    --merges \
    --grep='^chore: record drawDB upstream snapshot ' \
    -1 \
    --format='%H'
)"

if [[ -z "${baseline_merge}" ]]; then
  echo "No upstream snapshot merge was found on the current branch." >&2
  exit 1
fi

previous_snapshot="$(git rev-parse "${baseline_merge}^2")"
previous_upstream="$(
  git show -s --format='%B' "${previous_snapshot}" \
    | sed -n 's/^Upstream-Commit: //p' \
    | tail -n 1
)"

if [[ "${target_commit}" == "${previous_upstream}" ]]; then
  echo "Already tracking upstream ${target_commit}."
  exit 0
fi

snapshot_commit="$(
  git commit-tree "${target_tree}" -p "${previous_snapshot}" <<EOF
chore: snapshot drawDB upstream ${target_commit:0:12}

This commit contains the exact upstream tree without importing upstream's
historical blobs. See UPSTREAM.md for the security rationale.

Upstream-Repository: https://github.com/drawdb-io/drawdb
Upstream-Commit: ${target_commit}
EOF
)"

git merge \
  --no-ff \
  "${snapshot_commit}" \
  -m "chore: record drawDB upstream snapshot ${target_commit:0:12}"

echo "Imported upstream ${target_commit}."
echo "Run the validation suite and update UPSTREAM.md before pushing."
