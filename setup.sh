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
npm i jszip exceljs @tauri-apps/cli@2.9.6 @tauri-apps/api@2.9.1 @tauri-apps/plugin-fs@2.4.3 @tauri-apps/plugin-dialog@2.4.0 @tauri-apps/plugin-sql@2.3.0
npm pkg set scripts.tauri=tauri
npm uninstall xlsx || true

echo "==> cargo add"
( cd src-tauri && cargo add tauri-plugin-fs && cargo add tauri-plugin-dialog && cargo add tauri-plugin-single-instance && cargo add tauri-plugin-sql --features sqlite )

echo "==> Apply manual patches per src/patches/PATCHES.md, then run: npm run tauri build"
