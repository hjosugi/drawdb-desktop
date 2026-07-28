<!-- i18n: language-switcher -->
[English](headless-cli.md) | [日本語](headless-cli.ja.md)

# Headless CLI

`scripts/drawdb-cli.mjs` converts drawDB files without starting Tauri or the
browser UI. It is intended for CI jobs that need to validate diagrams or
regenerate SQL and Excel artifacts from versioned `.ddb` files.

Run it directly during development:

```sh
node scripts/drawdb-cli.mjs validate schema.ddb
node scripts/drawdb-cli.mjs export --to sql --dialect postgres schema.ddb -o schema.sql
node scripts/drawdb-cli.mjs export --to xlsx schema.ddb -o tables.xlsx
node scripts/drawdb-cli.mjs import --from sql --dialect mysql schema.sql -o schema.ddb
node scripts/drawdb-cli.mjs import --from xlsx tables.xlsx -o schema.ddb
```

The package also declares a `drawdb` bin, so installed package consumers can use
the same subcommands as `drawdb export`, `drawdb import`, and `drawdb validate`.

## Formats and Dialects

| Direction | Format | Notes |
| --- | --- | --- |
| `.ddb` to SQL | `--to sql` | Requires `--dialect mysql`, `--dialect oracle`, or `--dialect postgres`. |
| `.ddb` to Excel | `--to xlsx` | Uses the styled workbook builder from `src/utils/excel/build.js`. |
| SQL to `.ddb` | `--from sql` | Requires a SQL dialect; imports the supported DDL subset used by the existing SQL tests. |
| Excel to `.ddb` | `--from xlsx` | Uses workbook parsing and the 500-row type inference sample limit. |
| `.ddb` validation | `validate` | Checks table/field shape and relationship references. |

The CLI prints a concise success message on stdout. Parse, option, and
validation failures are printed to stderr with exit code `1`, which keeps it
usable as a CI gate.

