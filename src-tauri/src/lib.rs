mod logging;
mod recent_files;

use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;
use tauri_plugin_sql::{Migration, MigrationKind};

#[derive(Clone, serde::Serialize)]
struct OpenFilePayload {
    path: String,
}

#[derive(Default)]
struct OpenFileQueue(Mutex<OpenFileState>);

#[derive(Default)]
struct OpenFileState {
    frontend_ready: bool,
    pending: Vec<String>,
}

impl OpenFileQueue {
    fn push(&self, path: String) -> bool {
        let mut state = self.0.lock().expect("open file state lock poisoned");
        if state.frontend_ready {
            true
        } else {
            state.pending.push(path);
            false
        }
    }

    fn mark_frontend_ready(&self) -> Vec<String> {
        let mut state = self.0.lock().expect("open file state lock poisoned");
        state.frontend_ready = true;
        std::mem::take(&mut state.pending)
    }

    fn is_frontend_ready(&self) -> bool {
        self.0
            .lock()
            .expect("open file state lock poisoned")
            .frontend_ready
    }
}

fn is_openable_file_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".ddb") || lower.ends_with(".ddbpack") || lower.ends_with(".xlsx")
}

fn extract_file_args(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| is_openable_file_path(a))
        .cloned()
        .collect()
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.unminimize();
    }
}

fn emit_open_file(app: &tauri::AppHandle, path: &str) {
    show_main_window(app);
    let _ = app.emit(
        "open-file",
        OpenFilePayload {
            path: path.to_string(),
        },
    );
}

fn queue_open_file(app: &tauri::AppHandle, path: String) {
    show_main_window(app);
    // Dialog selections are added to the fs scope automatically, but paths
    // delivered by Finder/Explorer, the Dock, or the single-instance callback
    // are not. Grant only this already extension-validated file.
    if let Err(error) = app.fs_scope().allow_file(&path) {
        log::error!("failed to grant filesystem scope for an opened file: {error}");
        return;
    }
    if app.state::<OpenFileQueue>().push(path.clone()) {
        emit_open_file(app, &path);
    }
}

#[tauri::command]
fn frontend_ready(state: tauri::State<'_, OpenFileQueue>) -> Vec<String> {
    state.mark_frontend_ready()
}

#[tauri::command]
fn request_app_exit(app: tauri::AppHandle) {
    app.exit(0);
}

fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path = path.to_string_lossy().into_owned();
                    if is_openable_file_path(&path) {
                        queue_open_file(app, path);
                    }
                }
            }
        }
        tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } if app.state::<OpenFileQueue>().is_frontend_ready()
            && app.get_webview_window("main").is_some() =>
        {
            api.prevent_exit();
            let _ = app.emit("app-exit-requested", ());
        }
        _ => {}
    }
}

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1, description: "create_initial_tables",
        sql: "CREATE TABLE IF NOT EXISTS diagrams (id INTEGER PRIMARY KEY AUTOINCREMENT, diagram_id TEXT UNIQUE, name TEXT NOT NULL, database TEXT, last_modified TEXT NOT NULL, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_diagrams_last_modified ON diagrams(last_modified DESC); CREATE INDEX IF NOT EXISTS idx_diagrams_diagram_id ON diagrams(diagram_id); CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id TEXT UNIQUE, title TEXT NOT NULL, custom INTEGER NOT NULL DEFAULT 1, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_templates_custom ON templates(custom); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::install_panic_hook();
    // Register logging first so records from the other plugins' setup are kept.
    let mut builder = tauri::Builder::default().plugin(logging::plugin());
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
                let paths = extract_file_args(&argv);
                if paths.is_empty() {
                    show_main_window(app);
                } else {
                    for path in paths {
                        queue_open_file(app, path);
                    }
                }
            }))
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_state_flags(
                        tauri_plugin_window_state::StateFlags::SIZE
                            | tauri_plugin_window_state::StateFlags::POSITION
                            | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                    )
                    .build(),
            );
    }
    builder
        .manage(OpenFileQueue::default())
        .invoke_handler(tauri::generate_handler![
            frontend_ready,
            request_app_exit,
            recent_files::recent_files_list,
            recent_files::recent_files_add,
            recent_files::recent_files_prepare_open,
            recent_files::recent_files_remove,
            recent_files::recent_files_clear,
            logging::open_log_dir
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:drawdb.db", migrations())
                .build(),
        )
        .setup(|app| {
            log::info!(
                "drawDB {} starting on {} {}",
                app.package_info().version,
                std::env::consts::OS,
                std::env::consts::ARCH
            );
            app.manage(recent_files::init(app.handle()));
            let argv: Vec<String> = std::env::args().collect();
            for path in extract_file_args(&argv) {
                queue_open_file(app.handle(), path);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            handle_run_event(app, event);
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_supported_file_args_case_insensitively() {
        let args = vec![
            "drawdb-desktop".to_string(),
            "--flag".to_string(),
            "/tmp/schema.DDBPACK".to_string(),
        ];

        assert_eq!(extract_file_args(&args), vec!["/tmp/schema.DDBPACK"]);
    }

    #[test]
    fn ignores_unsupported_startup_args() {
        let args = vec![
            "drawdb-desktop".to_string(),
            "/tmp/schema.sql".to_string(),
            "--flag".to_string(),
        ];

        assert!(extract_file_args(&args).is_empty());
    }

    #[test]
    fn preserves_all_files_from_multi_file_desktop_entries() {
        let args = vec![
            "drawdb-desktop".to_string(),
            "/tmp/a.ddb".to_string(),
            "/tmp/b.ddbpack".to_string(),
        ];

        assert_eq!(
            extract_file_args(&args),
            vec!["/tmp/a.ddb", "/tmp/b.ddbpack"]
        );
    }

    #[test]
    fn queues_until_frontend_ready_then_emits_immediately() {
        let queue = OpenFileQueue::default();

        assert!(!queue.push("/tmp/a.ddb".to_string()));
        assert!(!queue.push("/tmp/b.ddbpack".to_string()));
        assert_eq!(
            queue.mark_frontend_ready(),
            vec!["/tmp/a.ddb".to_string(), "/tmp/b.ddbpack".to_string()]
        );
        assert!(queue.push("/tmp/c.xlsx".to_string()));
        assert!(queue.mark_frontend_ready().is_empty());
        assert!(queue.is_frontend_ready());
    }
}
