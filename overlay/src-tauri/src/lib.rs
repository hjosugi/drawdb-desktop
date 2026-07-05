use std::sync::Mutex;
use tauri::{Emitter, Manager};
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
}

fn is_openable_file_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".ddb") || lower.ends_with(".ddbpack") || lower.ends_with(".xlsx")
}

fn extract_file_arg(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| is_openable_file_path(a))
        .cloned()
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
    if app.state::<OpenFileQueue>().push(path.clone()) {
        emit_open_file(app, &path);
    }
}

#[tauri::command]
fn frontend_ready(state: tauri::State<'_, OpenFileQueue>) -> Vec<String> {
    state.mark_frontend_ready()
}

#[cfg(target_os = "macos")]
fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::Opened { urls } = event {
        for url in urls {
            if let Ok(path) = url.to_file_path() {
                let path = path.to_string_lossy().into_owned();
                if is_openable_file_path(&path) {
                    queue_open_file(app, path);
                }
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn handle_run_event(_app: &tauri::AppHandle, _event: tauri::RunEvent) {}

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1, description: "create_initial_tables",
        sql: "CREATE TABLE IF NOT EXISTS diagrams (id INTEGER PRIMARY KEY AUTOINCREMENT, diagram_id TEXT UNIQUE, name TEXT NOT NULL, database TEXT, last_modified TEXT NOT NULL, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_diagrams_last_modified ON diagrams(last_modified DESC); CREATE INDEX IF NOT EXISTS idx_diagrams_diagram_id ON diagrams(diagram_id); CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id TEXT UNIQUE, title TEXT NOT NULL, custom INTEGER NOT NULL DEFAULT 1, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_templates_custom ON templates(custom); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(p) = extract_file_arg(&argv) {
                queue_open_file(app, p);
            } else {
                show_main_window(app);
            }
        }));
    }
    builder
        .manage(OpenFileQueue::default())
        .invoke_handler(tauri::generate_handler![frontend_ready])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:drawdb.db", migrations())
                .build(),
        )
        .setup(|app| {
            let argv: Vec<String> = std::env::args().collect();
            if let Some(p) = extract_file_arg(&argv) {
                queue_open_file(app.handle(), p);
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

        assert_eq!(
            extract_file_arg(&args),
            Some("/tmp/schema.DDBPACK".to_string())
        );
    }

    #[test]
    fn ignores_unsupported_startup_args() {
        let args = vec![
            "drawdb-desktop".to_string(),
            "/tmp/schema.sql".to_string(),
            "--flag".to_string(),
        ];

        assert_eq!(extract_file_arg(&args), None);
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
    }
}
