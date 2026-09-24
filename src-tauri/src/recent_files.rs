//! Persistent "Recent Files" list.
//!
//! The list lives in the Rust process instead of WebView storage because the
//! filesystem scope granted by native dialogs and OS file associations is not
//! persisted across restarts. Keeping the list here lets the backend re-grant
//! access only to paths that the user previously opened or saved, instead of
//! letting the frontend widen its own filesystem scope.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, Runtime};
use tauri_plugin_fs::FsExt;

/// Maximum number of remembered paths.
pub const MAX_RECENT_FILES: usize = 10;
/// Event emitted with the refreshed list whenever it changes.
pub const RECENT_FILES_CHANGED_EVENT: &str = "recent-files-changed";
const STORE_FILE_NAME: &str = "recent-files.json";
const STORE_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFileEntry {
    pub path: String,
    /// Milliseconds since the Unix epoch.
    pub opened_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFileView {
    pub path: String,
    pub name: String,
    pub opened_at: u64,
    pub exists: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct RecentFileStore {
    version: u32,
    files: Vec<RecentFileEntry>,
}

/// Structured command error. `code` is stable and mapped to translated text by
/// the frontend; `message` is diagnostic detail only.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RecentFileError {
    pub code: &'static str,
    pub message: String,
}

impl RecentFileError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Only drawDB documents are tracked. Excel workbooks are imports, not
/// documents that are saved back, so they are intentionally excluded.
pub fn is_recent_file_candidate(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".ddb") || lower.ends_with(".ddbpack")
}

/// Key used for de-duplication. Windows and default macOS volumes are case
/// insensitive, and Windows accepts both separators.
fn path_key(path: &str) -> String {
    if cfg!(any(windows, target_os = "macos")) {
        path.replace('\\', "/").to_lowercase()
    } else {
        path.to_string()
    }
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RecentFileList {
    entries: Vec<RecentFileEntry>,
}

impl RecentFileList {
    pub fn from_entries(entries: Vec<RecentFileEntry>) -> Self {
        let mut list = Self::default();
        // Oldest first so that the newest entries win de-duplication and order.
        let mut ordered = entries;
        ordered.sort_by_key(|entry| entry.opened_at);
        for entry in ordered {
            if is_recent_file_candidate(&entry.path) && !entry.path.trim().is_empty() {
                list.add(entry.path, entry.opened_at);
            }
        }
        list
    }

    pub fn entries(&self) -> &[RecentFileEntry] {
        &self.entries
    }

    /// Moves `path` to the front, removing duplicates and trimming the list.
    pub fn add(&mut self, path: String, opened_at: u64) {
        let key = path_key(&path);
        self.entries.retain(|entry| path_key(&entry.path) != key);
        self.entries.insert(0, RecentFileEntry { path, opened_at });
        self.entries.truncate(MAX_RECENT_FILES);
    }

    pub fn remove(&mut self, path: &str) -> bool {
        let key = path_key(path);
        let before = self.entries.len();
        self.entries.retain(|entry| path_key(&entry.path) != key);
        before != self.entries.len()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Returns the stored spelling of `path` when it is remembered.
    pub fn find(&self, path: &str) -> Option<&RecentFileEntry> {
        let key = path_key(path);
        self.entries
            .iter()
            .find(|entry| path_key(&entry.path) == key)
    }

    pub fn views(&self, exists: impl Fn(&str) -> bool) -> Vec<RecentFileView> {
        self.entries
            .iter()
            .map(|entry| RecentFileView {
                path: entry.path.clone(),
                name: file_name(&entry.path),
                opened_at: entry.opened_at,
                exists: exists(&entry.path),
            })
            .collect()
    }
}

pub fn parse_store(text: &str) -> RecentFileList {
    match serde_json::from_str::<RecentFileStore>(text) {
        Ok(store) => RecentFileList::from_entries(store.files),
        Err(error) => {
            log::warn!("ignoring unreadable recent files store: {error}");
            RecentFileList::default()
        }
    }
}

pub fn serialize_store(list: &RecentFileList) -> String {
    serde_json::to_string_pretty(&RecentFileStore {
        version: STORE_VERSION,
        files: list.entries.clone(),
    })
    .expect("recent file store is always serializable")
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn path_exists(path: &str) -> bool {
    Path::new(path).is_file()
}

/// Managed state: the list plus the JSON file that persists it.
pub struct RecentFiles {
    store_path: Option<PathBuf>,
    list: Mutex<RecentFileList>,
}

impl RecentFiles {
    pub fn load(store_path: Option<PathBuf>) -> Self {
        let list = store_path
            .as_deref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .map(|text| parse_store(&text))
            .unwrap_or_default();
        Self {
            store_path,
            list: Mutex::new(list),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, RecentFileList> {
        self.list.lock().expect("recent files lock poisoned")
    }

    fn persist(&self, list: &RecentFileList) -> Result<(), RecentFileError> {
        let Some(path) = self.store_path.as_deref() else {
            return Ok(());
        };
        let write = || -> std::io::Result<()> {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let temporary = path.with_extension("json.tmp");
            std::fs::write(&temporary, serialize_store(list))?;
            std::fs::rename(&temporary, path)
        };
        write().map_err(|error| {
            log::error!("failed to persist recent files: {error}");
            RecentFileError::new("RECENT_FILES_WRITE_FAILED", error.to_string())
        })
    }

    pub fn views(&self) -> Vec<RecentFileView> {
        self.lock().views(path_exists)
    }

    pub fn snapshot(&self) -> RecentFileList {
        self.lock().clone()
    }

    fn update(
        &self,
        change: impl FnOnce(&mut RecentFileList) -> bool,
    ) -> Result<Vec<RecentFileView>, RecentFileError> {
        let mut list = self.lock();
        if change(&mut list) {
            self.persist(&list)?;
        }
        Ok(list.views(path_exists))
    }
}

pub fn init<R: Runtime>(app: &tauri::AppHandle<R>) -> RecentFiles {
    let store_path = app
        .path()
        .app_config_dir()
        .map(|dir| dir.join(STORE_FILE_NAME))
        .map_err(|error| log::error!("recent files disabled: {error}"))
        .ok();
    RecentFiles::load(store_path)
}

fn notify<R: Runtime>(app: &tauri::AppHandle<R>, views: &[RecentFileView]) {
    if let Err(error) = app.emit(RECENT_FILES_CHANGED_EVENT, views) {
        log::warn!("failed to emit recent files change: {error}");
    }
}

#[tauri::command]
pub fn recent_files_list(state: tauri::State<'_, RecentFiles>) -> Vec<RecentFileView> {
    state.views()
}

/// Remembers a document the user just opened or saved. The path must already
/// be accessible through a native dialog or OS file association.
#[tauri::command]
pub fn recent_files_add(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecentFiles>,
    path: String,
) -> Result<Vec<RecentFileView>, RecentFileError> {
    if !is_recent_file_candidate(&path) {
        return Err(RecentFileError::new(
            "RECENT_FILE_UNSUPPORTED",
            "only .ddb and .ddbpack documents are remembered",
        ));
    }
    if !app.fs_scope().is_allowed(&path) {
        return Err(RecentFileError::new(
            "RECENT_FILE_NOT_PERMITTED",
            "the path was not opened or saved through drawDB",
        ));
    }
    let views = state.update(|list| {
        list.add(path, now_millis());
        true
    })?;
    notify(&app, &views);
    Ok(views)
}

/// Re-grants filesystem access to a remembered document before the frontend
/// reads it. Missing files are removed from the list.
#[tauri::command]
pub fn recent_files_prepare_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecentFiles>,
    path: String,
) -> Result<String, RecentFileError> {
    let stored = state
        .snapshot()
        .find(&path)
        .map(|entry| entry.path.clone())
        .ok_or_else(|| {
            RecentFileError::new(
                "RECENT_FILE_NOT_PERMITTED",
                "the path is not in the recent files list",
            )
        })?;
    if !path_exists(&stored) {
        let views = state.update(|list| list.remove(&stored))?;
        notify(&app, &views);
        return Err(RecentFileError::new(
            "RECENT_FILE_NOT_FOUND",
            "the file no longer exists",
        ));
    }
    app.fs_scope()
        .allow_file(&stored)
        .map_err(|error| RecentFileError::new("RECENT_FILE_NOT_PERMITTED", error.to_string()))?;
    Ok(stored)
}

#[tauri::command]
pub fn recent_files_remove(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecentFiles>,
    path: String,
) -> Result<Vec<RecentFileView>, RecentFileError> {
    let views = state.update(|list| list.remove(&path))?;
    notify(&app, &views);
    Ok(views)
}

#[tauri::command]
pub fn recent_files_clear(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecentFiles>,
) -> Result<Vec<RecentFileView>, RecentFileError> {
    let views = state.update(|list| {
        let changed = !list.entries().is_empty();
        list.clear();
        changed
    })?;
    notify(&app, &views);
    Ok(views)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(list: &RecentFileList) -> Vec<&str> {
        list.entries()
            .iter()
            .map(|entry| entry.path.as_str())
            .collect()
    }

    #[test]
    fn adds_newest_first_and_deduplicates() {
        let mut list = RecentFileList::default();
        list.add("/docs/a.ddb".into(), 1);
        list.add("/docs/b.ddbpack".into(), 2);
        list.add("/docs/a.ddb".into(), 3);

        assert_eq!(paths(&list), vec!["/docs/a.ddb", "/docs/b.ddbpack"]);
        assert_eq!(list.entries()[0].opened_at, 3);
    }

    #[test]
    fn keeps_at_most_ten_entries() {
        let mut list = RecentFileList::default();
        for index in 0..15 {
            list.add(format!("/docs/{index}.ddb"), index);
        }

        assert_eq!(list.entries().len(), MAX_RECENT_FILES);
        assert_eq!(list.entries()[0].path, "/docs/14.ddb");
        assert_eq!(list.entries()[9].path, "/docs/5.ddb");
    }

    #[test]
    fn removes_and_clears_entries() {
        let mut list = RecentFileList::default();
        list.add("/docs/a.ddb".into(), 1);
        list.add("/docs/b.ddb".into(), 2);

        assert!(list.remove("/docs/a.ddb"));
        assert!(!list.remove("/docs/missing.ddb"));
        assert_eq!(paths(&list), vec!["/docs/b.ddb"]);
        list.clear();
        assert!(list.entries().is_empty());
    }

    #[test]
    fn only_tracks_drawdb_documents() {
        assert!(is_recent_file_candidate("/docs/a.DDB"));
        assert!(is_recent_file_candidate("C:\\docs\\a.ddbpack"));
        assert!(!is_recent_file_candidate("/docs/a.xlsx"));
        assert!(!is_recent_file_candidate("/docs/a.sql"));
    }

    #[test]
    fn round_trips_store_and_drops_invalid_entries() {
        let mut list = RecentFileList::default();
        list.add("/docs/a.ddb".into(), 10);
        list.add("/docs/b.ddbpack".into(), 20);
        let restored = parse_store(&serialize_store(&list));
        assert_eq!(restored, list);

        let tampered = r#"{"version":1,"files":[
            {"path":"/etc/passwd","openedAt":5},
            {"path":"/docs/a.ddb","openedAt":1},
            {"path":"/docs/a.ddb","openedAt":7},
            {"path":"","openedAt":9}
        ]}"#;
        let parsed = parse_store(tampered);
        assert_eq!(paths(&parsed), vec!["/docs/a.ddb"]);
        assert_eq!(parsed.entries()[0].opened_at, 7);
    }

    #[test]
    fn ignores_corrupt_store() {
        assert!(parse_store("{not json").entries().is_empty());
    }

    #[test]
    fn reports_file_names_and_existence() {
        let mut list = RecentFileList::default();
        list.add("/docs/present.ddb".into(), 1);
        list.add("/docs/gone.ddb".into(), 2);
        let views = list.views(|path| path.ends_with("present.ddb"));

        assert_eq!(views[0].name, "gone.ddb");
        assert!(!views[0].exists);
        assert_eq!(views[1].name, "present.ddb");
        assert!(views[1].exists);
    }

    #[test]
    fn persists_to_disk_and_reloads() {
        let dir = std::env::temp_dir().join(format!(
            "drawdb-recent-files-test-{}-{}",
            std::process::id(),
            now_millis()
        ));
        let store = dir.join(STORE_FILE_NAME);
        let recent = RecentFiles::load(Some(store.clone()));
        recent
            .update(|list| {
                list.add("/docs/a.ddb".into(), 1);
                true
            })
            .expect("persist");

        let reloaded = RecentFiles::load(Some(store));
        assert_eq!(paths(&reloaded.snapshot()), vec!["/docs/a.ddb"]);
        let _ = std::fs::remove_dir_all(dir);
    }
}
