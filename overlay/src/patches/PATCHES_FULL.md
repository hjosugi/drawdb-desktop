# 全パッチコード（コピペ用）

## Workspace.jsx 追加分

```jsx
import { useContext, useEffect, useRef } from "react";
import { FilePathContext } from "../context/FilePathContext";
import {
  desktopAvailable, writeTextFile, readTextFile, onOpenFile,
  serializeDdb, parseDdb, makeAutoSaver,
} from "../utils/desktopIO";
import { importFromPack } from "../utils/ddbpack";
import { importExcelToDiagram } from "../utils/excelIO";

const { path: filePath, kind: fileKind, setFile } = useContext(FilePathContext);

const fileSaver = useRef(makeAutoSaver(async (payload) => {
  if (!filePath || fileKind !== "ddb") return;
  await writeTextFile(filePath, serializeDdb(payload));
}, 800));

// 既存 save() の DB 更新後
if (desktopAvailable() && filePath && fileKind === "ddb") {
  fileSaver.current.schedule(currentDiagram);
}

useEffect(() => {
  if (!desktopAvailable()) return;
  let unlisten = null;
  (async () => {
    unlisten = await onOpenFile(async (path) => {
      try {
        const lower = path.toLowerCase();
        if (lower.endsWith(".ddbpack")) {
          await importFromPack(path, { merge: true });
        } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
          const d = await importExcelToDiagram(path, { database: "mysql" });
          const id = await db.diagrams.add({ ...d, lastModified: new Date() });
          loadDiagram(id);
        } else {
          const text = await readTextFile(path);
          const data = parseDdb(text);
          const existing = data.diagramId
            ? await db.diagrams.where("diagramId").equals(data.diagramId).first() : null;
          const row = { ...data, lastModified: new Date() };
          const id = existing
            ? (await db.diagrams.update(existing.id, row), existing.id)
            : await db.diagrams.add(row);
          loadDiagram(id);
        }
        setFile(path);
      } catch (e) { console.error("open-file failed", e); }
    });
  })();
  return () => { try { unlisten && unlisten(); } catch {} };
}, []);

useEffect(() => {
  const onBeforeUnload = () => fileSaver.current.flush();
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => window.removeEventListener("beforeunload", onBeforeUnload);
}, []);
```

## ControlPanel.jsx 追加分

```jsx
import {
  desktopAvailable, pickOpen, pickSave,
  readTextFile, writeTextFile,
  serializeDdb, parseDdb,
} from "../../utils/desktopIO";
import { exportAllToPack, importFromPack } from "../../utils/ddbpack";
import { exportDiagramToExcel, importExcelToDiagram } from "../../utils/excelIO";
import { toOracle } from "../../data/exportSQL/oracle";
import { toMySQL } from "../../data/exportSQL/mysqlEnhanced";
import { toPostgres } from "../../data/exportSQL/postgres";
import { fromOracle } from "../../data/importSQL/oracle";
import { fromMySQL } from "../../data/importSQL/mysqlEnhanced";
import { fromPostgres } from "../../data/importSQL/postgres";
import { FilePathContext } from "../../context/FilePathContext";

async function openDdb() {
  const p = await pickOpen("ddb"); if (!p) return;
  const text = await readTextFile(p);
  const data = parseDdb(text);
  const existing = data.diagramId
    ? await db.diagrams.where("diagramId").equals(data.diagramId).first() : null;
  const row = { ...data, lastModified: new Date() };
  const id = existing
    ? (await db.diagrams.update(existing.id, row), existing.id)
    : await db.diagrams.add(row);
  loadDiagram(id);
  filePathCtx.setFile(p);
}
async function saveDdb() {
  if (filePathCtx.path && filePathCtx.kind === "ddb")
    await writeTextFile(filePathCtx.path, serializeDdb(currentDiagram));
  else await saveAsDdb();
}
async function saveAsDdb() {
  const p = await pickSave(`${currentDiagram.name || "diagram"}.ddb`, "ddb");
  if (!p) return;
  await writeTextFile(p, serializeDdb(currentDiagram));
  filePathCtx.setFile(p);
}
async function openExcel() {
  const p = await pickOpen("xlsx"); if (!p) return;
  const d = await importExcelToDiagram(p, { database: currentDiagram.database || "mysql" });
  const id = await db.diagrams.add({ ...d, lastModified: new Date() });
  loadDiagram(id);
}
async function exportExcel() {
  const p = await pickSave(`${currentDiagram.name || "diagram"}.xlsx`, "xlsx");
  if (!p) return;
  await exportDiagramToExcel(p, currentDiagram);
}
function detectDialect(text) {
  // PostgreSQL first (SERIAL/BYTEA/JSONB/AS ENUM are PG-specific; COMMENT ON is
  // shared with Oracle so it must not be the deciding signal).
  if (/\b(SERIAL|BIGSERIAL|SMALLSERIAL|BYTEA|JSONB)\b|AS\s+ENUM|nextval\(|::[a-z]/i.test(text))
    return { db: "postgres", parse: fromPostgres };
  if (/VARCHAR2|NUMBER\s*\(|GENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY/i.test(text))
    return { db: "oracle", parse: fromOracle };
  return { db: "mysql", parse: fromMySQL }; // backtick-quoted, AUTO_INCREMENT, ENGINE=
}
async function openSqlDdl() {
  const p = await pickOpen("sql"); if (!p) return;
  const text = await readTextFile(p);
  const { db, parse } = detectDialect(text);
  const parsed = parse(text);
  const diag = {
    name: p.replace(/^.*[\\/]/, "").replace(/\.sql$/i, ""),
    database: db,
    ...parsed, notes: [], areas: [], types: [], enums: [],
    transform: { zoom: 1, pan: { x: 0, y: 0 } },
  };
  const id = await db.diagrams.add({ ...diag, lastModified: new Date() });
  loadDiagram(id);
}
async function exportSql(toFn, dialect) {
  const p = await pickSave(`${currentDiagram.name || "diagram"}_${dialect}.sql`, "sql");
  if (!p) return;
  await writeTextFile(p, toFn(currentDiagram));
}
async function exportPack() {
  const p = await pickSave("drawdb-project.ddbpack", "pack");
  if (!p) return;
  await exportAllToPack(p);
}
async function importPack() {
  const p = await pickOpen("pack");
  if (!p) return;
  await importFromPack(p, { merge: true });
}

const fileMenuExtras = desktopAvailable() ? {
  "Open .ddb…": { function: openDdb, shortcut: "Ctrl+O" },
  "Save":       { function: saveDdb, shortcut: "Ctrl+S" },
  "Save As .ddb…": { function: saveAsDdb, shortcut: "Ctrl+Shift+S" },
  "Open Excel (.xlsx)…":  { function: openExcel },
  "Export Excel (.xlsx)…":{ function: exportExcel },
  "Open SQL (Oracle/MySQL/PostgreSQL)…": { function: openSqlDdl },
  "Export SQL Oracle…":     { function: () => exportSql(toOracle, "oracle") },
  "Export SQL MySQL…":      { function: () => exportSql(toMySQL,  "mysql") },
  "Export SQL PostgreSQL…": { function: () => exportSql(toPostgres, "postgres") },
  "Export Project (.ddbpack)…":{ function: exportPack },
  "Import Project (.ddbpack)…":{ function: importPack },
} : {};
```
