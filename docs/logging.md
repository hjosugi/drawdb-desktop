<!-- i18n: language-switcher -->
[English](logging.md) | [日本語](logging.ja.md)

# Logs and crash reports

drawDB Desktop writes diagnostic logs to local files so problems on a user's
machine can be investigated without reproducing them first. Nothing is sent
over the network.

## Where the logs are

Choose **File > Desktop Files > Open Log Folder** (on macOS also
**Help > Open Log Folder**). The folder is:

| OS | Folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%\app.drawdb.desktop\logs` |
| macOS | `~/Library/Logs/app.drawdb.desktop` |
| Linux | `~/.local/share/app.drawdb.desktop/logs` |

The active file is `drawdb.log`. It rotates at 2 MiB and the five most recent
rotated files are kept, so the folder stays below roughly 12 MiB.

## What is recorded

- Rust-side warnings and errors (for example failures to persist Recent Files
  or to grant filesystem access), at `info` level in release builds and `debug`
  in development builds.
- Rust panics, including the message, source location, and a backtrace. Release
  builds are stripped, so backtrace frames may show addresses only; the message
  and location are always present.
- Frontend `console.error` and `console.warn` calls, uncaught exceptions, and
  unhandled promise rejections, forwarded through `tauri-plugin-log`.

## Privacy policy

- Diagram contents, table or column definitions, and SQL/Excel file contents are
  never logged.
- Home-directory prefixes in messages are replaced with `~` (for example
  `/home/alice/db/shop.ddb` becomes `~/db/shop.ddb`) so account names are not
  written to disk. The rest of a path is kept because it is usually needed to
  diagnose file errors; review the file before attaching it to a public issue.
- Each frontend record is truncated to 4,000 characters.

## Crash reporting services

Remote crash reporting (for example Sentry) is intentionally not bundled. It
would require an account, a DSN, a privacy policy, and an in-app opt-in consent
flow. Until those exist, bug reports should attach the local log files; the
**Help > Report a Bug** menu opens the GitHub issue chooser.
