# package.json に追加する依存 (dependencies to add)

`npm install` 後、ベースの drawDB-App の `package.json` に以下を追加します。
（`setup.sh` / `setup.ps1` が自動で行います。）

```json
{
  "dependencies": {
    "jszip": "^3.10.1",
    "exceljs": "^4.4.0",
    "@tauri-apps/cli": "2.9.6",
    "@tauri-apps/api": "2.9.1",
    "@tauri-apps/plugin-fs": "2.4.3",
    "@tauri-apps/plugin-dialog": "2.4.0",
    "@tauri-apps/plugin-sql": "2.3.0",
    "@tauri-apps/plugin-opener": "2.5.4"
  }
}
```

## 備考
- **exceljs** … Excel 入出力（書式付き）。v2.0 までは `xlsx` (SheetJS) を使用していましたが、
  セル書式（塗り・太字・罫線・列幅・オートフィルタ・ウィンドウ枠固定）に対応するため
  `exceljs` に切り替えました（T8）。`xlsx` は不要なので削除して構いません。
- **@tauri-apps/api** … `@tauri-apps/api/event` を `desktopIO.js` で使用します。
- **@tauri-apps/plugin-opener** … ローカル履歴の保存先フォルダを OS のファイルマネージャで開くために使用します。
- インストール一括コマンド:
  ```bash
  npm install jszip exceljs @tauri-apps/cli@2.9.6 @tauri-apps/api@2.9.1 @tauri-apps/plugin-fs@2.4.3 \
    @tauri-apps/plugin-dialog@2.4.0 @tauri-apps/plugin-sql@2.3.0 @tauri-apps/plugin-opener@2.5.4
  npm pkg set scripts.tauri=tauri
  npm uninstall xlsx   # 旧依存（あれば）
  ```
