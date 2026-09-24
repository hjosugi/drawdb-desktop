<!-- i18n: language-switcher -->
[English](README.md) | [日本語](README.ja.md)

<p align="center">
  <img src="assets/icon.png" width="96" alt="drawDB Desktop icon">
</p>

# drawDB Desktop

[English](README.md)

[drawDB](https://github.com/drawdb-io/drawdb) を Tauri でデスクトップ化した統合版です。
アプリ本体、デスクトップ機能、Tauri backend を同じリポジトリで管理し、別リポジトリへの
overlay コピーや手動 patch なしで直接 build できます。

## デスクトップ機能

- diff しやすい決定的 JSON の `.ddb` ファイル
- `.ddbpack` プロジェクト import / export
- Excel `.xlsx` import / export
- Oracle / MySQL / PostgreSQL DDL import / export
- 圧縮ローカル履歴、保持設定、破損 `.ddb` からの復旧
- macOS のネイティブメニューバー（アプリ / ファイル / 編集 / 表示 / ウインドウ /
  ヘルプ）と標準ショートカット。Windows / Linux は drawDB のウインドウ内メニューを
  唯一のメニューバーとし、Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S / Ctrl+W
  （Linux は Ctrl+Q も）をアプリ内で処理。両メニューは同じコマンドを呼び出します。
- 最近使ったファイル（直近 10 件の `.ddb` / `.ddbpack` を再起動後も保持。存在しない
  ファイルは表示で区別し、選択時に履歴から削除）
- Windows / macOS / Linux のファイル関連付けと single-instance open-file
- autosave と「保存 / 保存せず終了 / キャンセル」の終了確認（Cmd+Q 等を含む）
- ローテーション付きローカルログ（panic のバックトレースとフロントエンドのエラーも記録）。
  「ログフォルダを開く」から取り出し可能（[`docs/logging.ja.md`](docs/logging.ja.md)）
- 署名付き Tauri updater、起動時確認、手動更新確認
- デスクトップ固有メッセージの英語 / 日本語対応

## ダウンロード

GitHub Actions は次の成果物を build します。パッケージ方針は
[`docs/release-packaging.md`](docs/release-packaging.md)、自動・実機検証状況は
[`docs/validation-matrix.md`](docs/validation-matrix.md) を参照してください。

| Platform | Architecture | Format |
| --- | --- | --- |
| Windows | x64 | NSIS `.exe`, MSI `.msi` |
| Windows | ARM64 | NSIS `.exe` |
| macOS | Intel, Apple Silicon | `.dmg`, `.app` |
| Linux | x64, ARM64 | `.deb`, `.rpm`, `.AppImage` |

Windows installer は WebView2 Runtime offline installer を同梱します。Linux の
`.deb` / `.rpm` は `.ddb` / `.ddbpack` の MIME metadata を登録し、Linux x64 RPM は
Fedora 上で install / headless launch smoke test を CI 実行します。AppImage の関連付けは
Gear Lever、appimaged 等での統合が必要です。

updater 対応 Release には `TAURI_SIGNING_PRIVATE_KEY`（暗号化鍵の場合は
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）が必要です。Windows Authenticode と Apple
Developer ID / notarization は各 platform の認証情報がある場合に実行します。

## 開発

必要環境は Node.js 20.19+、npm、Rust/Cargo、各 OS の Tauri build prerequisites です。

```sh
npm ci
npm run desktop:dev
```

production build もリポジトリ root から直接実行します。

```sh
npm run desktop:build
```

取り込んだ本家 commit と追従方法は [`UPSTREAM.md`](UPSTREAM.md) に記録しています。

## ヘッドレス CLI

UI を起動せずに `.ddb` の検証・変換ができます。詳細は
[`docs/headless-cli.md`](docs/headless-cli.md) を参照してください。

```sh
node scripts/drawdb-cli.mjs validate schema.ddb
node scripts/drawdb-cli.mjs export --to sql --dialect postgres schema.ddb -o schema.sql
node scripts/drawdb-cli.mjs export --to xlsx schema.ddb -o tables.xlsx
node scripts/drawdb-cli.mjs import --from sql --dialect mysql schema.sql -o schema.ddb
```

## 検証

```sh
npm run lint
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

## ライセンス

統合アプリは AGPL-3.0-only です。元々 0BSD で公開したデスクトップ固有コードについては
[`NOTICE`](NOTICE) と [`LICENSE-ORIGINAL-CODE`](LICENSE-ORIGINAL-CODE) を参照してください。
