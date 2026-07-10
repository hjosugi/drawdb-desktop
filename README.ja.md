<p align="center">
  <img src="assets/icon.png" width="96" alt="drawDB Desktop icon">
</p>

# drawDB Desktop Overlay

[English](README.md)

drawDBをTauriデスクトップ化するoverlayです。ローカルファイル、Excel、SQL、EN/JA i18nに対応します。

## ダウンロード

リリース成果物は GitHub Actions でビルドします。パッケージ方針は
[`docs/release-packaging.md`](docs/release-packaging.md)、現在の CI / 手動検証範囲は
[`docs/validation-matrix.md`](docs/validation-matrix.md) を参照してください。

| Platform | Architectures | Formats |
| --- | --- | --- |
| Windows | x64 | NSIS `.exe`, MSI `.msi` |
| Windows | ARM64 | NSIS `.exe` |
| macOS | Intel, Apple Silicon | `.dmg`, `.app` |
| Linux | x64, ARM64 | `.deb`, `.rpm`, `.AppImage` |

Windows の NSIS / MSI インストーラーは WebView2 Runtime の offline installer
を同梱します。Windows 成果物のサイズは大きくなりますが、WebView2 未導入の
クリーンな Windows 10 でも、別途ランタイムをダウンロードせずに drawDB を
インストールして起動できる方針です。

デスクトップアプリは Tauri の署名付き updater を設定済みです。Release build
は GitHub Releases に `latest.json` を公開し、アプリは起動時と File メニューから
その endpoint を確認します。updater 対応 Release を公開する前に、maintainer は
`TAURI_SIGNING_PRIVATE_KEY` と、暗号化鍵を使う場合は
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` を GitHub Actions Secrets に登録してください。

Release build には OS 署名のフックも入っています。Windows Authenticode 署名は
Azure Artifact Signing の Secrets または runner 上の証明書 thumbprint を使い、
macOS は hardened runtime と Tauri の Developer ID 署名 / notarization 用環境変数を
使います。

RPM は first-party の Linux パッケージです。release workflow は Linux x64 RPM 成果物をダウンロードし、Fedora コンテナ上で `dnf`、D-Bus、Xvfb によるインストールと headless launch smoke test を CI 実行します。GUI を含むリリース検証は別途記録します。
Linux の `.deb` / `.rpm` には `.ddb` と `.ddbpack` 用の drawDB MIME
metadata を含めます。AppImage は portable artifact のため、Gear Lever、
appimaged、または同等のツールで統合しない限り、ファイル関連付けは自動登録されません。

Flatpak、AUR、Snap の公開は、Release の成果物名が安定し、必要なストア/レジストリ認証情報と各パッケージ方針レビューを用意できるまで延期します。

## セットアップ

必要なもの: git、Node.js 18+、npm、Rust/Cargo。

```sh
npm run setup
```

互換用ラッパーも同じ Node セットアップスクリプトを呼び出します。

```sh
./setup.sh
```

```powershell
.\setup.ps1
```

セットアップスクリプトは CI 検証済み commit に固定した drawDB-App を clone し、`overlay/` をコピーし、
`package.json` にまとめた frontend / Rust 依存を導入して、Release に必須の updater UI を
自動統合します。残りの機能統合は `APPLY_PATCH.md` を参照してください。clone や install を
行わずに手順だけ確認する場合は `npm run setup:dry-run` を使います。

## ヘッドレス CLI

デスクトップアプリを起動せずに、CI で `.ddb` の検証や変換を実行できます。詳細は
[`docs/headless-cli.md`](docs/headless-cli.md) を参照してください。

```sh
node scripts/drawdb-cli.mjs validate schema.ddb
node scripts/drawdb-cli.mjs export --to sql --dialect postgres schema.ddb -o schema.sql
node scripts/drawdb-cli.mjs export --to xlsx schema.ddb -o tables.xlsx
node scripts/drawdb-cli.mjs import --from sql --dialect mysql schema.sql -o schema.ddb
```

## テスト

```sh
npm test
```
