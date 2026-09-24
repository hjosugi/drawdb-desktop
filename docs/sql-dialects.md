<!-- i18n: language-switcher -->
[English](sql-dialects.md) | [日本語](sql-dialects.ja.md)

# Desktop SQL dialects

The desktop "Desktop Files" menu and the headless CLI use their own DDL
exporters and importers in `src/data/exportSQL/` and `src/data/importSQL/`.
They are separate from upstream drawDB's generators in `src/utils/` because they
produce deterministic, round-trippable DDL (named constraints, `COMMENT ON`,
explicit foreign keys) for the `.ddb` workflow.

## Export: dialect definitions

`src/data/exportSQL/core.js` owns the statement order and the shared pieces:

1. Header comments (dialect label, diagram name, timestamp) and `preamble`
   statements.
2. Composite types (`compositeType`) and other type statements
   (`typeDefinitions`, for example PostgreSQL `CREATE TYPE ... AS ENUM`).
3. One `CREATE TABLE` per table: columns, primary key, collected `CHECK`
   constraints, and either inline `KEY` lines or separate `CREATE INDEX`
   statements; then `COMMENT ON` statements when the dialect uses them.
4. `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` for every resolvable
   relationship, filtered by the referential actions the dialect supports.
5. `trailer` statements.

A dialect module only describes what differs:

| Key | Purpose |
| --- | --- |
| `label` | Name in the generated header comment |
| `quoteIdent`, `quoteLiteral` | Identifier and string-literal quoting |
| `preamble`, `trailer` | Statements before the first / after the last object |
| `compositeType(type)` | DDL for a drawDB composite type, or omitted |
| `typeDefinitions(diagram, context)` | Extra type statements (enums) |
| `createContext(diagram)` | Precomputed lookups passed to `column` |
| `column(field, table, context)` | Returns `{ sql, checks }` for one column |
| `primaryKey(table, columns)` | Table-level primary key clause |
| `indexes` | `"inline"` (`KEY` lines) or `"statements"` (`CREATE INDEX`) |
| `comments` / `commentStatements` | `"inline"` or `"statements"` plus the generator |
| `tableSuffix(table)` | Text after the closing parenthesis (MySQL table options) |
| `foreignKeyName(source, target, index)` | Name for unnamed relationships |
| `foreignKeyActions` | Accepted `ON DELETE` / `ON UPDATE` actions (`"all"` or a list) |

## Import: shared parser helpers

`src/data/importSQL/common.js` provides comment stripping, identifier
patterns for a quoting style (`identifierPattern`), qualified-name unquoting,
quote-aware top-level comma splitting, column lists, string-literal decoding,
`ON DELETE` / `ON UPDATE` extraction, `COMMENT ON` and `CREATE INDEX`
application, table construction with grid placement, and relationship
resolution. Dialect parsers keep only their `CREATE TABLE` / `ALTER TABLE`
patterns and type normalization. All three parsers accept inline column
`REFERENCES`, table-level `FOREIGN KEY`, and `ALTER TABLE ... ADD CONSTRAINT`
foreign keys.

## Adding a dialect

1. Create `src/data/exportSQL/<dialect>.js` exporting a frozen dialect
   definition and `to<Dialect>(diagram) => generateDdl(diagram, definition)`.
2. Create `src/data/importSQL/<dialect>.js` using the helpers above; start
   from the closest existing parser.
3. Register both in `src/desktop/useDesktopFileMenu.jsx` (`exportSqlText`,
   `importSql`, menu entries), `detectSqlDialect` in `src/desktop/diagram.js`,
   and `scripts/drawdb-cli.mjs`.
4. Add the dialect to `tests/export-sql.regression.test.mjs` and
   `tests/import-sql.regression.test.mjs` and review the new snapshots, and add a
   round-trip case to `tests/sql.test.mjs`.

## Why not node-sql-parser?

Upstream drawDB's Import dialog parses DDL with `node-sql-parser` (plus
`oracle-sql-parser` for Oracle), and it stays available in the desktop app. It
was evaluated as the engine for the desktop parsers and not adopted:

- `node-sql-parser` has no Oracle grammar ("Oracle is not supported
  currently"), so Oracle would still need a second parser.
- One statement outside its grammar aborts the whole script. For example the
  `DELIMITER //` lines that `mysqldump` emits make `astify` throw, while the
  desktop parsers skip statements they do not model and still import the
  tables.
- The desktop exporters and importers are designed as a pair and pinned by
  golden tests (`tests/*-sql.regression.test.mjs`); switching engines would
  change round-trip results without adding coverage for the DDL they emit.

It parses the MySQL and PostgreSQL DDL produced by these exporters without
errors, so it remains a reasonable option if the desktop parsers are ever
replaced.
