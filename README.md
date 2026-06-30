# drawDB Desktop

[khsuzan/drawDB-App](https://github.com/khsuzan/drawDB-App)（drawDB を Tauri 2.0 でデスクトップ化したフォーク）に対する
**オーバーレイ**です。ローカルファイル保存・Excel 入出力・Oracle/MySQL/PostgreSQL の SQL ダイアレクトを追加します。

> このリポジトリは「上書き適用するオーバーレイ + セットアップ + CI」を保持します。
> 完全なアプリは `setup.sh` / `setup.ps1` がベースの drawDB-App を clone してオーバーレイを重ねて構築します。

## 同梱機能

| 機能 | 実装 |
|---|---|
| `.ddb` 単一ファイル保存 / 自動保存（debounce 800ms） | `overlay/src/utils/desktopIO.js` |
| `.ddbpack` プロジェクト ZIP（複数ダイアグラム＋テンプレ） | `overlay/src/utils/ddbpack.js` |
| **Excel 入出力（書式付き：塗り/太字/罫線/列幅/オートフィルタ/枠固定）** | `overlay/src/utils/excelIO.js`（exceljs） |
| **Oracle / MySQL / PostgreSQL の SQL export + import** | `overlay/src/data/{exportSQL,importSQL}/*` |
| Windows `.ddb`/`.ddbpack`/`.xlsx` ダブルクリック起動 + single-instance | `overlay/src-tauri/src/lib.rs` |
| SQLite 永続化（オプション） | `overlay/src/data/sqlBackend.js` + lib.rs migrations |
| **アイコン一式生成（png/ico/icns + Store ロゴ）** | `scripts/generate_icons.py` |
| **クロスプラットフォーム CI/CD（Win/macOS/Linux）** | `.github/workflows/` |

太字は v2.1 で追加・強化した項目（T4 / T5 / T6 / T8）。

## クイックスタート（このリポジトリの検証）

```bash
npm install          # exceljs を入れる
npm test             # 設定検証 + SQL 3方言 + Excel ラウンドトリップ
npm run icons        # 既定アイコンを overlay/src-tauri/icons に生成（要 Pillow）
```

## デスクトップアプリのビルド

```bash
bash setup.sh                 # Linux / macOS（ベース clone → オーバーレイ適用 → ビルド）
# または
powershell -ExecutionPolicy Bypass -File .\setup.ps1   # Windows
```

成果物（例）: `src-tauri/target/release/bundle/` 配下に `.exe` / `.msi` / `.dmg` / `.AppImage` / `.deb`。

手動マージが必要な3ファイル（File メニュー配線）は `overlay/src/patches/PATCHES_FULL.md` を参照。
詳細な引き継ぎは [`HANDOVER.md`](./HANDOVER.md)。

## リリース（GitHub Actions）

`v*` タグを push すると `.github/workflows/release.yml` が Win/macOS(Intel+ARM)/Linux を並列ビルドし、
ドラフト Release を作成します。`workflow_dispatch` でベースリポジトリ（`base_repo`）を指定可能。

## ライセンス

AGPL-3.0（ベース drawDB に準拠）。再配布時は派生ソースの公開義務があります。
