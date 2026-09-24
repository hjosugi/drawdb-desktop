// @ts-check
// Tauri 検知 + fs/dialog/event のラッパ
import { t } from "../i18n/index.js";

const isTauri = () =>
  typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

let _fs = null, _dlg = null, _evt = null, _core = null, _win = null;
async function fs()  { if (!_fs)  _fs  = await import("@tauri-apps/plugin-fs");     return _fs; }
async function dlg() { if (!_dlg) _dlg = await import("@tauri-apps/plugin-dialog"); return _dlg; }
async function evt() { if (!_evt) _evt = await import("@tauri-apps/api/event");     return _evt; }
async function core() { if (!_core) _core = await import("@tauri-apps/api/core");   return _core; }
async function win() { if (!_win) _win = await import("@tauri-apps/api/window");     return _win; }

function filters(kind) {
  const m = {
    ddb: [{ name: t("file.drawdbDiagram"), extensions: ["ddb", "json"] }],
    pack: [{ name: t("file.drawdbProject"), extensions: ["ddbpack"] }],
    xlsx: [{ name: t("file.excelWorkbook"), extensions: ["xlsx"] }],
    sql: [{ name: t("file.sqlScript"), extensions: ["sql"] }],
  };
  return m[kind] ?? m.ddb;
}

export const desktopAvailable = isTauri;
export {
  assertValidDdbDiagram,
  normalizeDdbPayload,
  parseDdb,
  serializeDdb,
  stableJsonValue,
  stableStringify,
  validateDdbDiagram,
} from "./ddb.js";

export async function onOpenFile(handler) {
  if (!isTauri()) return () => {};
  const { listen } = await evt();
  const unlisten = await listen("open-file", (e) => {
    if (e.payload?.path) void Promise.resolve(handler(e.payload.path));
  });
  const { invoke } = await core();
  const pending = await invoke("frontend_ready");
  for (const path of Array.isArray(pending) ? pending : []) {
    if (path) await handler(path);
  }
  return unlisten;
}

export async function onAppExitRequested(handler) {
  if (!isTauri()) return () => {};
  const { listen } = await evt();
  return listen("app-exit-requested", () => {
    void Promise.resolve(handler());
  });
}

export async function pickOpen(kind = "ddb", title = undefined) {
  if (!isTauri()) return null;
  const { open } = await dlg();
  return await open({ multiple: false, filters: filters(kind), ...(title ? { title } : {}) });
}

export async function pickSave(defaultName, kind = "ddb") {
  if (!isTauri()) return null;
  const { save } = await dlg();
  return await save({ defaultPath: defaultName, filters: filters(kind) });
}

export async function onCloseRequested(handler) {
  if (!isTauri()) return () => {};
  const { getCurrentWindow } = await win();
  return await getCurrentWindow().onCloseRequested(handler);
}

export async function closeCurrentWindow() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await win();
  await getCurrentWindow().close();
}

export async function requestAppExit() {
  if (!isTauri()) return;
  const { invoke } = await core();
  await invoke("request_app_exit");
}

export async function showDesktopError(message, title = t("error.title")) {
  if (!isTauri()) return;
  // Every user-facing failure is also recorded in the desktop log file.
  console.error(`${title}: ${message}`);
  const { message: showMessage } = await dlg();
  await showMessage(String(message), { title, kind: "error" });
}

export async function showDesktopWarning(message, title = t("error.title")) {
  if (!isTauri()) return;
  console.warn(`${title}: ${message}`);
  const { message: showMessage } = await dlg();
  await showMessage(String(message), { title, kind: "warning" });
}

/**
 * File kind used to classify read errors.
 * @param {string} path
 * @returns {"ddb" | "pack" | "xlsx" | "sql"}
 */
export function fileKind(path) {
  const lower = String(path).toLowerCase();
  if (lower.endsWith(".ddbpack")) return "pack";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".sql")) return "sql";
  return "ddb";
}

export async function confirmCloseWithUnsavedChanges() {
  if (!isTauri()) return "cancel";
  const { message } = await dlg();
  const save = t("close.saveAndExit");
  const discard = t("close.discardAndExit");
  const cancel = t("close.cancel");
  const result = await message(t("close.unsavedMessage"), {
    title: t("close.unsavedTitle"),
    kind: "warning",
    buttons: { yes: save, no: discard, cancel },
  });
  if (result === save) return "save";
  if (result === discard) return "discard";
  return "cancel";
}

export async function readTextFile(path)   { const { readTextFile } = await fs(); return readTextFile(path); }
export async function writeTextFile(p, t)  { const { writeTextFile } = await fs(); return writeTextFile(p, t); }
export async function readBinaryFile(p)    { const { readFile } = await fs(); return readFile(p); }
export async function writeBinaryFile(p,b) { const { writeFile } = await fs(); return writeFile(p, b); }
export async function fileExists(path)     { const { exists } = await fs(); return exists(path); }

export function makeAutoSaver(writer, wait = 800) {
  let timer = null, pending = null, active = null, lastError = null;
  const run = async () => {
    if (active) return active;
    active = (async () => {
      while (pending != null) {
        const data = pending; pending = null;
        try {
          await writer(data);
          lastError = null;
        } catch (e) {
          lastError = e;
          console.error("autoSaver:", e);
        }
      }
    })().finally(() => { active = null; });
    return active;
  };
  return {
    schedule(data) { pending = data; clearTimeout(timer); timer = setTimeout(run, wait); },
    async flush() {
      clearTimeout(timer);
      await run();
      if (lastError) throw lastError;
    },
    hasPending() { return pending != null || active != null; },
  };
}
