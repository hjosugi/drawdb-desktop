# package.json に追加する依存 (dependencies to add)

`npm install` 後、ベースの drawDB-App の `package.json` に以下を追加します。
（`setup.sh` / `setup.ps1` が自動で行います。）

```json
{
  "dependencies": {
    "jszip": "^3.10.1",
    "exceljs": "^4.4.0",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-fs": "^2.0.0",
    "@tauri-apps/plugin-dialog": "^2.0.0",
    "@tauri-apps/plugin-single-instance": "^2.0.0",
    "@tauri-apps/plugin-sql": "^2.0.0"
  }
}
```

## 備考
- **exceljs** … Excel 入出力（書式付き）。v2.0 までは `xlsx` (SheetJS) を使用していましたが、
  セル書式（塗り・太字・罫線・列幅・オートフィルタ・ウィンドウ枠固定）に対応するため
  `exceljs` に切り替えました（T8）。`xlsx` は不要なので削除して構いません。
- **@tauri-apps/api** … `@tauri-apps/api/event` を `desktopIO.js` で使用します。
- インストール一括コマンド:
  ```bash
  npm install jszip exceljs @tauri-apps/api @tauri-apps/plugin-fs \
    @tauri-apps/plugin-dialog @tauri-apps/plugin-single-instance @tauri-apps/plugin-sql
  npm uninstall xlsx   # 旧依存（あれば）
  ```
