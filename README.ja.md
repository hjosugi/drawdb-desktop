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

RPM は first-party の Linux パッケージです。release workflow は Linux x64 RPM 成果物をダウンロードし、Fedora コンテナ上で `dnf`、D-Bus、Xvfb によるインストールと headless launch smoke test を CI 実行します。GUI を含むリリース検証は別途記録します。

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

セットアップスクリプトはベースの drawDB-App を clone し、`overlay/` をコピーし、`package.json` にまとめた frontend / Rust 依存を導入します。その後 `APPLY_PATCH.md` の手動パッチを適用してください。clone や install を行わずに手順だけ確認する場合は `npm run setup:dry-run` を使います。

## テスト

```sh
npm test
```
