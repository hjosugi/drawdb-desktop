// Tauri 検知 + fs/dialog/event のラッパ
import { t } from "../i18n/index.js";

const isTauri = () =>
  typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

let _fs = null, _dlg = null, _evt = null;
async function fs()  { if (!_fs)  _fs  = await import("@tauri-apps/plugin-fs");     return _fs; }
async function dlg() { if (!_dlg) _dlg = await import("@tauri-apps/plugin-dialog"); return _dlg; }
async function evt() { if (!_evt) _evt = await import("@tauri-apps/api/event");     return _evt; }

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

export async function onOpenFile(handler) {
  if (!isTauri()) return () => {};
  const { listen } = await evt();
  return listen("open-file", (e) => handler(e.payload.path));
}

export async function pickOpen(kind = "ddb") {
  if (!isTauri()) return null;
  const { open } = await dlg();
  return await open({ multiple: false, filters: filters(kind) });
}

export async function pickSave(defaultName, kind = "ddb") {
  if (!isTauri()) return null;
  const { save } = await dlg();
  return await save({ defaultPath: defaultName, filters: filters(kind) });
}

export async function readTextFile(path)   { const { readTextFile } = await fs(); return readTextFile(path); }
export async function writeTextFile(p, t)  { const { writeTextFile } = await fs(); return writeTextFile(p, t); }
export async function readBinaryFile(p)    { const { readFile } = await fs(); return readFile(p); }
export async function writeBinaryFile(p,b) { const { writeFile } = await fs(); return writeFile(p, b); }
export async function fileExists(path)     { const { exists } = await fs(); return exists(path); }

export function serializeDdb(d) {
  return JSON.stringify({
    $format: "drawdb-file", $version: 1,
    diagramId: d.diagramId, name: d.name, database: d.database,
    lastModified: new Date().toISOString(),
    tables: d.tables ?? [], relationships: d.relationships ?? [],
    notes: d.notes ?? [], areas: d.areas ?? [],
    types: d.types ?? [], enums: d.enums ?? [],
    transform: d.transform ?? { zoom: 1, pan: { x: 0, y: 0 } },
  }, null, 2);
}
export function parseDdb(text) {
  const o = JSON.parse(text);
  if (o.$format && o.$format !== "drawdb-file") {
    throw new Error(t("error.unknownDdbFormat", { format: o.$format }));
  }
  return o;
}

export function makeAutoSaver(writer, wait = 800) {
  let timer = null, pending = null, inflight = false;
  const run = async () => {
    if (inflight || pending == null) return;
    const data = pending; pending = null; inflight = true;
    try { await writer(data); } catch (e) { console.error("autoSaver:", e); }
    finally { inflight = false; }
    if (pending != null) run();
  };
  return {
    schedule(data) { pending = data; clearTimeout(timer); timer = setTimeout(run, wait); },
    async flush() { clearTimeout(timer); await run(); },
  };
}
