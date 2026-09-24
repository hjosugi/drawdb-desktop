//! Diagnostic logging (#13).
//!
//! Records from Rust (`log` macros), from the frontend bridge
//! (`src/desktop/logging.js`) and from panics are written by tauri-plugin-log
//! to rotated files in the OS log directory:
//!
//! - Windows: `%LOCALAPPDATA%\app.drawdb.desktop\logs`
//! - macOS: `~/Library/Logs/app.drawdb.desktop`
//! - Linux: `~/.local/share/app.drawdb.desktop/logs`
//!
//! Nothing is sent over the network. Users attach the files to bug reports
//! through the "Open Log Folder" menu item.

use tauri::{Manager, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use tauri_plugin_opener::OpenerExt;

/// Base name of the log files (`drawdb.log`, rotated copies keep a timestamp).
pub const LOG_FILE_NAME: &str = "drawdb";
/// Rotate once the active file reaches 2 MiB.
pub const MAX_LOG_FILE_BYTES: u128 = 2 * 1024 * 1024;
/// Rotated files kept in addition to the active file.
pub const KEPT_LOG_FILES: usize = 5;

pub fn level() -> log::LevelFilter {
    if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    }
}

pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::Stdout))
        .target(Target::new(TargetKind::LogDir {
            file_name: Some(LOG_FILE_NAME.to_string()),
        }))
        .level(level())
        // Dependencies are noisy at debug level; keep them at warnings.
        .level_for("tao", log::LevelFilter::Warn)
        .level_for("wry", log::LevelFilter::Warn)
        .level_for("sqlx", log::LevelFilter::Warn)
        .max_file_size(MAX_LOG_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(KEPT_LOG_FILES))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .build()
}

/// Formats a panic for the log. Kept separate from the hook for testing.
pub fn panic_record(message: &str, location: Option<String>, backtrace: &str) -> String {
    let location = location.unwrap_or_else(|| "unknown location".to_string());
    format!("panic at {location}: {message}\nbacktrace:\n{backtrace}")
}

fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone()
    } else {
        "non-string panic payload".to_string()
    }
}

/// Logs panics (message, location and backtrace) before the default hook
/// runs. Release builds use `panic = "abort"`, so this is the last chance to
/// record why the process is going away.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        let location = info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()));
        log::error!(
            "{}",
            panic_record(&panic_message(info.payload()), location, &backtrace)
        );
        log::logger().flush();
        previous(info);
    }));
}

/// Opens the log directory in the system file manager.
#[tauri::command]
pub fn open_log_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    log::info!("opening log directory");
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_panic_records_with_location_and_backtrace() {
        let record = panic_record(
            "index out of bounds",
            Some("src/lib.rs:42".into()),
            "0: drawdb_lib::run",
        );
        assert_eq!(
            record,
            "panic at src/lib.rs:42: index out of bounds\nbacktrace:\n0: drawdb_lib::run"
        );
        assert!(panic_record("boom", None, "").contains("unknown location"));
    }

    #[test]
    fn rotates_small_files_and_keeps_a_bounded_history() {
        assert_eq!(MAX_LOG_FILE_BYTES, 2_097_152);
        assert_eq!(KEPT_LOG_FILES, 5);
        assert!(level() >= log::LevelFilter::Info);
    }

    #[test]
    fn panic_hook_records_the_panic_message() {
        use std::sync::{Mutex, OnceLock};

        struct Capture(Mutex<Vec<String>>);
        impl log::Log for Capture {
            fn enabled(&self, _: &log::Metadata<'_>) -> bool {
                true
            }
            fn log(&self, record: &log::Record<'_>) {
                self.0.lock().unwrap().push(record.args().to_string());
            }
            fn flush(&self) {}
        }

        static CAPTURE: OnceLock<Capture> = OnceLock::new();
        let capture = CAPTURE.get_or_init(|| Capture(Mutex::new(Vec::new())));
        let _ = log::set_logger(capture);
        log::set_max_level(log::LevelFilter::Trace);

        install_panic_hook();
        let result = std::panic::catch_unwind(|| panic!("intentional test panic"));
        let _ = std::panic::take_hook();

        assert!(result.is_err());
        let records = capture.0.lock().unwrap();
        assert!(records
            .iter()
            .any(|record| record.contains("intentional test panic")
                && record.contains("src/logging.rs")));
    }
}
