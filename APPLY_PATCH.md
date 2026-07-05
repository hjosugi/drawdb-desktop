# 手動マージ手順

先に `npm run setup` (または `./setup.sh` / `.\setup.ps1`) でベースアプリに overlay を適用してください。依存パッケージの一覧は `package.json` の `drawdbDesktopSetup` に集約されています。

1. src/main.jsx → overlay/src/patches/PATCHES.md セクション1
2. src/components/Workspace.jsx → PATCHES_FULL.md セクション1
3. src/components/EditorHeader/ControlPanel.jsx → PATCHES_FULL.md セクション2
4. ビルド: `npm run tauri build`
