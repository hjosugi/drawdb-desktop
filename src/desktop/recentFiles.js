// @ts-check
import { useEffect, useState } from "react";

// Recent documents are persisted by the Tauri backend (see
// src-tauri/src/recent_files.rs) so it can re-grant filesystem access to them
// after a restart without widening the frontend's own scope.

export const RECENT_FILES_CHANGED_EVENT = "recent-files-changed";
export const MAX_RECENT_FILES = 10;

const isTauri = () =>
  typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

async function invoke(command, args) {
  const core = await import("@tauri-apps/api/core");
  return core.invoke(command, args);
}

export function isRecentFileCandidate(path) {
  return /\.(ddb|ddbpack)$/i.test(String(path || ""));
}

export function normalizeRecentFiles(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry.path === "string" && entry.path)
    .slice(0, MAX_RECENT_FILES)
    .map((entry) => ({
      path: entry.path,
      name: typeof entry.name === "string" && entry.name
        ? entry.name
        : fileName(entry.path),
      openedAt: Number(entry.openedAt) || 0,
      exists: entry.exists !== false,
    }));
}

export function fileName(path) {
  return String(path).split(/[\\/]/).filter(Boolean).pop() || String(path);
}

export function parentFolderName(path) {
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : "";
}

/**
 * Builds the children of the in-app "Recent Files" submenu.
 *
 * @param {Array<{path: string, name: string, exists: boolean}>} files
 * @param {{ t: (key: string) => string, onOpen: (path: string) => void, onClear: () => void }} options
 */
export function recentFilesMenuItems(files, { t, onOpen, onClear }) {
  const entries = normalizeRecentFiles(files);
  if (entries.length === 0) {
    return [{ name: t("recent.empty"), disabled: true, function: () => {} }];
  }
  return [
    ...entries.map((entry) => ({
      name: entry.name,
      label: entry.exists ? parentFolderName(entry.path) : t("recent.missing"),
      title: entry.path,
      function: () => onOpen(entry.path),
    })),
    { divider: true },
    { name: t("recent.clear"), function: onClear },
  ];
}

export async function listRecentFiles() {
  if (!isTauri()) return [];
  return normalizeRecentFiles(await invoke("recent_files_list"));
}

/**
 * Remembers a document that was opened or saved. Failures never interrupt the
 * file operation that triggered them.
 */
export async function recordRecentFile(path) {
  if (!isTauri() || !isRecentFileCandidate(path)) return null;
  try {
    return normalizeRecentFiles(await invoke("recent_files_add", { path }));
  } catch (error) {
    console.warn("drawDB could not remember recent file:", error);
    return null;
  }
}

/**
 * Asks the backend to re-grant access to a remembered document and returns
 * its stored path. Rejects with `{ code: "RECENT_FILE_NOT_FOUND" }` (and the
 * entry is dropped) when the file no longer exists.
 */
export async function prepareRecentFile(path) {
  if (!isTauri()) return null;
  return invoke("recent_files_prepare_open", { path });
}

export async function removeRecentFile(path) {
  if (!isTauri()) return [];
  return normalizeRecentFiles(await invoke("recent_files_remove", { path }));
}

export async function clearRecentFiles() {
  if (!isTauri()) return [];
  return normalizeRecentFiles(await invoke("recent_files_clear"));
}

export async function onRecentFilesChanged(handler) {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen(RECENT_FILES_CHANGED_EVENT, (event) => {
    handler(normalizeRecentFiles(event.payload));
  });
}

export function useRecentFiles() {
  const [files, setFiles] = useState([]);

  useEffect(() => {
    if (!isTauri()) return () => {};
    let disposed = false;
    let unlisten = null;

    void (async () => {
      try {
        const stop = await onRecentFilesChanged((next) => {
          if (!disposed) setFiles(next);
        });
        if (disposed) stop();
        else unlisten = stop;
        const initial = await listRecentFiles();
        if (!disposed) setFiles(initial);
      } catch (error) {
        console.warn("drawDB could not load recent files:", error);
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return files;
}
