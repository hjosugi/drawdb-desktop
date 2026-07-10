# package.json に追加する依存 (dependencies to add)

`npm install` 後、ベースの drawDB-App の `package.json` に以下を追加します。
（`setup.sh` / `setup.ps1` が自動で行います。）

```json
{
  "dependencies": {
    "jszip": "^3.10.1",
    "exceljs": "^4.4.0",
    "@tauri-apps/cli": "2.11.4",
    "@tauri-apps/api": "2.11.1",
    "@tauri-apps/plugin-fs": "2.5.1",
    "@tauri-apps/plugin-dialog": "2.7.1",
    "@tauri-apps/plugin-sql": "2.4.0",
    "@tauri-apps/plugin-opener": "2.5.4",
    "@tauri-apps/plugin-window-state": "2.4.1",
    "@tauri-apps/plugin-process": "2.3.1",
    "@tauri-apps/plugin-updater": "2.10.1"
  }
}
```

## 備考
- **exceljs** … Excel 入出力（書式付き）。v2.0 までは `xlsx` (SheetJS) を使用していましたが、
  セル書式（塗り・太字・罫線・列幅・オートフィルタ・ウィンドウ枠固定）に対応するため
  `exceljs` に切り替えました（T8）。`xlsx` は不要なので削除して構いません。
- **@tauri-apps/api** … `@tauri-apps/api/event` を `desktopIO.js` で使用します。
- **@tauri-apps/plugin-opener** … ローカル履歴の保存先フォルダを OS のファイルマネージャで開くために使用します。
- **@tauri-apps/plugin-window-state** … Tauri の標準プラグインでウィンドウのサイズ・位置・最大化状態を保存/復元します。
- **@tauri-apps/plugin-updater** … GitHub Releases の `latest.json` から更新確認・ダウンロード・インストールを行います。
- **@tauri-apps/plugin-process** … 更新適用後にアプリを再起動するために使用します。
- インストール一括コマンド:
  ```bash
  npm install jszip exceljs @tauri-apps/cli@2.11.4 @tauri-apps/api@2.11.1 @tauri-apps/plugin-fs@2.5.1 \
    @tauri-apps/plugin-dialog@2.7.1 @tauri-apps/plugin-sql@2.4.0 @tauri-apps/plugin-opener@2.5.4 \
    @tauri-apps/plugin-window-state@2.4.1 @tauri-apps/plugin-process@2.3.1 @tauri-apps/plugin-updater@2.10.1
  npm pkg set scripts.tauri=tauri
  npm uninstall xlsx   # 旧依存（あれば）
  ```
