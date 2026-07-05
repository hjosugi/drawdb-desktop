<p align="center">
  <img src="assets/icon.png" width="96" alt="drawDB Desktop icon">
</p>

# drawDB Desktop Overlay

[English](README.md)

drawDBをTauriデスクトップ化するoverlayです。ローカルファイル、Excel、SQL、EN/JA i18nに対応します。

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
