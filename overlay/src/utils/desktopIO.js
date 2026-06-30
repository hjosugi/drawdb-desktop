// Tauri 検知 + fs/dialog/event のラッパ
const isTauri = () =>
  typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

let _fs = null, _dlg = null, _evt = null;
async function fs()  { if (!_fs)  _fs  = await import("@tauri-apps/plugin-fs");     return _fs; }
async function dlg() { if (!_dlg) _dlg = await import("@tauri-apps/plugin-dialog"); return _dlg; }
async function evt() { if (!_evt) _evt = await import("@tauri-apps/api/event");     return _evt; }

const DDB_FILTERS  = [{ name: "drawDB Diagram", extensions: ["ddb", "json"] }];
const PACK_FILTERS = [{ name: "drawDB Project", extensions: ["ddbpack"] }];
const XLSX_FILTERS = [{ name: "Excel Workbook", extensions: ["xlsx"] }];
const SQL_FILTERS  = [{ name: "SQL Script", extensions: ["sql"] }];

export const desktopAvailable = isTauri;

export async function onOpenFile(handler) {
  if (!isTauri()) return () => {};
  const { listen } = await evt();
  return listen("open-file", (e) => handler(e.payload.path));
}

export async function pickOpen(kind = "ddb") {
  if (!isTauri()) return null;
  const { open } = await dlg();
  const m = { ddb: DDB_FILTERS, pack: PACK_FILTERS, xlsx: XLSX_FILTERS, sql: SQL_FILTERS };
  return await open({ multiple: false, filters: m[kind] ?? DDB_FILTERS });
}

export async function pickSave(defaultName, kind = "ddb") {
  if (!isTauri()) return null;
  const { save } = await dlg();
  const m = { ddb: DDB_FILTERS, pack: PACK_FILTERS, xlsx: XLSX_FILTERS, sql: SQL_FILTERS };
  return await save({ defaultPath: defaultName, filters: m[kind] ?? DDB_FILTERS });
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
  if (o.$format && o.$format !== "drawdb-file") throw new Error("Unknown .ddb format: " + o.$format);
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
