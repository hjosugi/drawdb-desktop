<!-- i18n: language-switcher -->
[English](sql-dialects.md) | [日本語](sql-dialects.ja.md)

# デスクトップ版 SQL ダイアレクト

「デスクトップファイル」メニューとヘッドレス CLI は、`src/data/exportSQL/` と
`src/data/importSQL/` にある独自の DDL エクスポーター / インポーターを使います。
`.ddb` ワークフロー向けに決定的で往復可能な DDL（名前付き制約、`COMMENT ON`、
明示的な外部キー）を出力するため、upstream drawDB の `src/utils/` の生成器とは別です。

## エクスポート: ダイアレクト定義

`src/data/exportSQL/core.js` が文の順序と共通処理を担当します。

1. ヘッダコメント（ダイアレクト名、ダイアグラム名、日時）と `preamble`。
2. 複合型（`compositeType`）とその他の型定義（`typeDefinitions`。例: PostgreSQL の
   `CREATE TYPE ... AS ENUM`）。
3. テーブルごとの `CREATE TABLE`: カラム、主キー、集約した `CHECK` 制約、インライン
   `KEY` 行または別文の `CREATE INDEX`。ダイアレクトが使う場合は `COMMENT ON` 文。
4. 解決可能な全リレーションの `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`
   （ダイアレクトが対応する参照動作のみ出力）。
5. `trailer`。

ダイアレクトモジュールは差分だけを記述します。

| キー | 役割 |
| --- | --- |
| `label` | 生成ヘッダに出す名前 |
| `quoteIdent`, `quoteLiteral` | 識別子と文字列リテラルのクォート |
| `preamble`, `trailer` | 最初のオブジェクトの前 / 最後の後に出す文 |
| `compositeType(type)` | drawDB 複合型の DDL（不要なら省略） |
| `typeDefinitions(diagram, context)` | 追加の型定義文（ENUM など） |
| `createContext(diagram)` | `column` に渡す事前計算済みの参照表 |
| `column(field, table, context)` | 1 カラム分の `{ sql, checks }` |
| `primaryKey(table, columns)` | テーブルレベルの主キー句 |
| `indexes` | `"inline"`（`KEY` 行）または `"statements"`（`CREATE INDEX`） |
| `comments` / `commentStatements` | `"inline"` または `"statements"` と生成関数 |
| `tableSuffix(table)` | 閉じ括弧の後ろの文字列（MySQL のテーブルオプション） |
| `foreignKeyName(source, target, index)` | 名前のないリレーションの制約名 |
| `foreignKeyActions` | 受け付ける `ON DELETE` / `ON UPDATE`（`"all"` または一覧） |

## インポート: 共通パーサヘルパー

`src/data/importSQL/common.js` は、コメント除去、クォート方式ごとの識別子パターン
（`identifierPattern`）、修飾名のクォート解除、クォートを考慮したトップレベルのカンマ
分割、カラム一覧、文字列リテラルのデコード、`ON DELETE` / `ON UPDATE` の抽出、
`COMMENT ON` と `CREATE INDEX` の適用、グリッド配置付きのテーブル生成、リレーションの
解決を提供します。各ダイアレクトのパーサは `CREATE TABLE` / `ALTER TABLE` のパターンと
型の正規化だけを持ちます。3 ダイアレクトとも、カラム定義内の `REFERENCES`（インライン
FK）、テーブルレベルの `FOREIGN KEY`、`ALTER TABLE ... ADD CONSTRAINT` の外部キーを
取り込みます。

## ダイアレクトの追加手順

1. `src/data/exportSQL/<dialect>.js` に凍結したダイアレクト定義と
   `to<Dialect>(diagram) => generateDdl(diagram, definition)` を実装します。
2. `src/data/importSQL/<dialect>.js` を上記ヘルパーで実装します（最も近い既存パーサを
   起点にします）。
3. `src/desktop/useDesktopFileMenu.jsx`（`exportSqlText`、`importSql`、メニュー項目）、
   `src/desktop/diagram.js` の `detectSqlDialect`、`scripts/drawdb-cli.mjs` に登録します。
4. `tests/export-sql.regression.test.mjs` と `tests/import-sql.regression.test.mjs` に
   追加して新しいスナップショットを確認し、`tests/sql.test.mjs` に往復テストを追加します。

## node-sql-parser を採用しない理由

upstream drawDB のインポートダイアログは `node-sql-parser`（Oracle は
`oracle-sql-parser`）で DDL を解析しており、デスクトップ版でも引き続き利用できます。
デスクトップ版パーサのエンジンとして評価しましたが、次の理由で採用していません。

- `node-sql-parser` には Oracle の文法がなく（"Oracle is not supported currently"）、
  Oracle には別のパーサが結局必要になる。
- 文法外の文が 1 つあるとスクリプト全体が失敗する。例えば `mysqldump` が出力する
  `DELIMITER //` 行で `astify` が例外になるが、デスクトップ版パーサは扱わない文を
  読み飛ばしてテーブルを取り込める。
- デスクトップ版のエクスポーターとインポーターは対で設計され、ゴールデンテスト
  （`tests/*-sql.regression.test.mjs`）で挙動を固定している。エンジンを替えると、
  出力する DDL のカバレッジを増やさないまま往復結果が変わる。

なお、これらのエクスポーターが出力する MySQL / PostgreSQL の DDL は
`node-sql-parser` でもエラーなく解析できるため、将来パーサを置き換える場合の候補には
なります。
