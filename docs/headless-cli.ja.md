<!-- i18n: language-switcher -->
[English](headless-cli.md) | [日本語](headless-cli.ja.md)

# ヘッドレスCLI

`scripts/drawdb-cli.mjs`は、drawDBファイルをTauriやブラウザUIを起動せずに変換します。これは、ダイアグラムの検証やバージョン管理された`.ddb`ファイルからSQLやExcelの成果物を再生成する必要があるCIジョブ向けです。

開発中に直接実行します：

```sh
node scripts/drawdb-cli.mjs validate schema.ddb
node scripts/drawdb-cli.mjs export --to sql --dialect postgres schema.ddb -o schema.sql
node scripts/drawdb-cli.mjs export --to xlsx schema.ddb -o tables.xlsx
node scripts/drawdb-cli.mjs import --from sql --dialect mysql schema.sql -o schema.ddb
node scripts/drawdb-cli.mjs import --from xlsx tables.xlsx -o schema.ddb
```

このパッケージはまた、`drawdb`バイナリも宣言しているため、インストールされたパッケージの利用者は`drawdb export`、`drawdb import`、`drawdb validate`といったサブコマンドを使用できます。

## フォーマットと方言

| 方向 | フォーマット | 備考 |
| --- | --- | --- |
| `.ddb`からSQLへ | `--to sql` | `--dialect mysql`、`--dialect oracle`、または`--dialect postgres`が必要です。 |
| `.ddb`からExcelへ | `--to xlsx` | `src/utils/excel/build.js`のスタイル付きワークブックビルダーを使用します。 |
| SQLから`.ddb`へ | `--from sql` | SQL方言が必要です。既存のSQLテストで使用されているDDLのサポートされたサブセットをインポートします。 |
| Excelから`.ddb`へ | `--from xlsx` | ワークブックの解析と500行の型推論サンプル制限を使用します。 |
| `.ddb`の検証 | `validate` | テーブル/フィールドの形状とリレーションシップの参照をチェックします。 |

CLIは標準出力に簡潔な成功メッセージを出力します。パース、オプション、検証の失敗は標準エラー出力に出力され、終了コード`1`を返します。これにより、CIゲートとしても利用可能です。