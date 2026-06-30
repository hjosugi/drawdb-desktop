#!/usr/bin/env bash
set -e
PROJ="drawDB-Desktop"
REPO="https://github.com/khsuzan/drawDB-App.git"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "==> Cloning $REPO"
[ ! -d "$PROJ" ] && git clone "$REPO" "$PROJ"

echo "==> Applying overlay"
cp -r "$SCRIPT_DIR/overlay/." "$PROJ/"
cd "$PROJ"

echo "==> npm install"
npm i
npm i jszip exceljs @tauri-apps/api @tauri-apps/plugin-fs @tauri-apps/plugin-dialog @tauri-apps/plugin-single-instance @tauri-apps/plugin-sql
npm uninstall xlsx || true

echo "==> cargo add"
( cd src-tauri && cargo add tauri-plugin-fs && cargo add tauri-plugin-dialog && cargo add tauri-plugin-single-instance && cargo add tauri-plugin-sql --features sqlite )

echo "==> Apply manual patches per src/patches/PATCHES.md, then run: npm run tauri build"
