use tauri::{Emitter, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

#[derive(Clone, serde::Serialize)]
struct OpenFilePayload { path: String }

fn extract_file_arg(args: &[String]) -> Option<String> {
    args.iter().skip(1).find(|a| {
        let l = a.to_lowercase();
        l.ends_with(".ddb") || l.ends_with(".ddbpack") || l.ends_with(".xlsx")
    }).cloned()
}

fn emit_open_file(app: &tauri::AppHandle, path: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show(); let _ = w.set_focus(); let _ = w.unminimize();
    }
    let _ = app.emit("open-file", OpenFilePayload { path: path.to_string() });
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
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(p) = extract_file_arg(&argv) { emit_open_file(app, &p); }
            else if let Some(w) = app.get_webview_window("main") {
                let _ = w.show(); let _ = w.set_focus(); let _ = w.unminimize();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default()
            .add_migrations("sqlite:drawdb.db", migrations()).build())
        .setup(|app| {
            let argv: Vec<String> = std::env::args().collect();
            if let Some(p) = extract_file_arg(&argv) {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(700));
                    emit_open_file(&handle, &p);
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
