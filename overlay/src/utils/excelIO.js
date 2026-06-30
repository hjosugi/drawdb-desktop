// Excel I/O for drawDB schema (exceljs).
// Export: 1 sheet per table + Summary + Relationships + Enums/Types, with
//   styled headers (fill/bold/borders), column widths, autofilter and frozen panes.
// Import: drawDB-formatted workbooks round-trip exactly; arbitrary data workbooks
//   are reverse-engineered with type inference (Oracle / MySQL aware).
import ExcelJS from "exceljs";
import { readBinaryFile, writeBinaryFile } from "./desktopIO.js";

// ---- styling constants ----
const BRAND = "FF175E7A";
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const TITLE_FONT = { bold: true, size: 14, color: { argb: BRAND } };
const LABEL_FONT = { bold: true, color: { argb: "FF445566" } };
const THIN = { style: "thin", color: { argb: "FFD0D7DE" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const ZEBRA = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F6F8" } };
const YES_FONT = { color: { argb: "FF1A7F37" }, bold: true };

function styleHeader(row) {
  row.height = 18;
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = BORDER;
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });
}

function styleBodyRow(row, zebra) {
  row.eachCell((cell) => {
    cell.border = BORDER;
    if (zebra) cell.fill = ZEBRA;
    if (cell.value === "YES") cell.font = YES_FONT;
  });
}

function setWidths(ws, widths) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

// ---- export ----
// Pure: build a styled ExcelJS workbook from a diagram (no file I/O — CI-testable).
export function buildWorkbook(diagram) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "drawDB Desktop";
  wb.created = new Date();

  buildSummarySheet(wb, diagram);

  const used = new Set(["Summary", "Relationships", "Enums", "Types"]);
  (diagram.tables || []).forEach((t) => buildTableSheet(wb, t, diagram, used));

  buildRelationshipsSheet(wb, diagram);
  buildEnumsSheet(wb, diagram);
  buildTypesSheet(wb, diagram);
  return wb;
}

export async function exportDiagramToExcel(path, diagram) {
  const wb = buildWorkbook(diagram);
  const buf = await wb.xlsx.writeBuffer();
  await writeBinaryFile(path, new Uint8Array(buf));
  return { path, tables: (diagram.tables || []).length };
}

function buildSummarySheet(wb, diagram) {
  const ws = wb.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 7 }] });
  setWidths(ws, [4, 30, 9, 26, 6, 44]);
  ws.mergeCells("A1:F1");
  ws.getCell("A1").value = "drawDB Schema Export";
  ws.getCell("A1").font = TITLE_FONT;
  const meta = [
    ["Generated", new Date().toISOString()],
    ["Diagram", diagram.name || ""],
    ["Database", diagram.database || ""],
    ["Tables", (diagram.tables || []).length],
  ];
  meta.forEach((m, i) => {
    const r = ws.getRow(2 + i);
    r.getCell(1).value = m[0]; r.getCell(1).font = LABEL_FONT;
    r.getCell(2).value = m[1];
  });
  const header = ws.getRow(7);
  header.values = ["#", "Table", "Columns", "PK", "FKs", "Comment"];
  styleHeader(header);
  (diagram.tables || []).forEach((t, i) => {
    const pkCols = (t.fields || []).filter((f) => f.primary).map((f) => f.name).join(", ");
    const fkCnt = (diagram.relationships || []).filter((r) => r.startTableId === t.id).length;
    const row = ws.addRow([i + 1, t.name, (t.fields || []).length, pkCols, fkCnt, t.comment || ""]);
    styleBodyRow(row, i % 2 === 1);
  });
  ws.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7, column: 6 } };
}

function buildTableSheet(wb, t, diagram, used) {
  const sn = uniqueSheetName(t.name || "Table", used);
  const ws = wb.addWorksheet(sn, { views: [{ state: "frozen", ySplit: 3 }] });
  setWidths(ws, [4, 26, 16, 8, 8, 5, 8, 9, 18, 30, 30]);
  ws.mergeCells("A1:C1");
  ws.getCell("A1").value = `Table: ${t.name}`;
  ws.getCell("A1").font = TITLE_FONT;
  if (t.comment) {
    ws.getCell("D1").value = "Comment";
    ws.getCell("D1").font = LABEL_FONT;
    ws.mergeCells("E1:K1");
    ws.getCell("E1").value = t.comment;
  }
  // row 2 left blank as separator; header on row 3
  const header = ws.getRow(3);
  header.values = ["#", "Column", "Type", "Size", "NotNull", "PK", "Unique", "AutoInc", "Default", "Comment", "Check"];
  styleHeader(header);
  (t.fields || []).forEach((f, i) => {
    const row = ws.addRow([
      i + 1, f.name, f.type, f.size ?? "",
      bool(f.notNull), bool(f.primary), bool(f.unique), bool(f.increment),
      f.default ?? "", f.comment ?? "", f.check ?? "",
    ]);
    styleBodyRow(row, i % 2 === 1);
    if (f.primary) row.getCell(2).font = { bold: true };
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 11 } };

  if ((t.indices || []).length) {
    ws.addRow([]);
    const lbl = ws.addRow(["Indexes"]);
    lbl.getCell(1).font = TITLE_FONT;
    const ih = ws.addRow(["#", "Name", "Columns", "Unique"]);
    styleHeader(ih);
    t.indices.forEach((ix, i) => {
      const row = ws.addRow([i + 1, ix.name, (ix.fields || []).join(", "), bool(ix.unique)]);
      styleBodyRow(row, i % 2 === 1);
    });
  }
}

function buildRelationshipsSheet(wb, diagram) {
  const ws = wb.addWorksheet("Relationships", { views: [{ state: "frozen", ySplit: 1 }] });
  setWidths(ws, [4, 26, 22, 22, 22, 22, 16, 14, 14]);
  const header = ws.getRow(1);
  header.values = ["#", "Name", "FromTable", "FromColumn", "ToTable", "ToColumn", "Type", "OnUpdate", "OnDelete"];
  styleHeader(header);
  (diagram.relationships || []).forEach((r, i) => {
    const sT = (diagram.tables || []).find((t) => t.id === r.startTableId);
    const eT = (diagram.tables || []).find((t) => t.id === r.endTableId);
    const row = ws.addRow([
      i + 1, r.name || `fk_${i + 1}`,
      sT?.name ?? "", sT?.fields?.[r.startFieldId]?.name ?? "",
      eT?.name ?? "", eT?.fields?.[r.endFieldId]?.name ?? "",
      r.cardinality || "one_to_many",
      r.updateConstraint || "NO ACTION", r.deleteConstraint || "NO ACTION",
    ]);
    styleBodyRow(row, i % 2 === 1);
  });
  if ((diagram.relationships || []).length) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };
  }
}

function buildEnumsSheet(wb, diagram) {
  if (!(diagram.enums || []).length) return;
  const ws = wb.addWorksheet("Enums", { views: [{ state: "frozen", ySplit: 1 }] });
  setWidths(ws, [4, 26, 60]);
  const header = ws.getRow(1);
  header.values = ["#", "Name", "Values"];
  styleHeader(header);
  diagram.enums.forEach((en, i) => {
    const row = ws.addRow([i + 1, en.name, (en.values || []).join(", ")]);
    styleBodyRow(row, i % 2 === 1);
  });
}

function buildTypesSheet(wb, diagram) {
  if (!(diagram.types || []).length) return;
  const ws = wb.addWorksheet("Types", { views: [{ state: "frozen", ySplit: 1 }] });
  setWidths(ws, [4, 26, 80]);
  const header = ws.getRow(1);
  header.values = ["#", "Name", "Fields"];
  styleHeader(header);
  diagram.types.forEach((ty, i) => {
    const fs = (ty.fields || []).map((f) => `${f.name}:${f.type}${f.size ? `(${f.size})` : ""}`).join(", ");
    const row = ws.addRow([i + 1, ty.name, fs]);
    styleBodyRow(row, i % 2 === 1);
  });
}

// ---- import ----
export async function importExcelToDiagram(path, { database = "mysql" } = {}) {
  const bytes = await readBinaryFile(path);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(toArrayBuffer(bytes));
  return workbookToDiagram(wb, { database, name: stripExt(basename(path)) });
}

// Pure: parse a loaded ExcelJS workbook into a diagram (no file I/O — CI-testable).
export function workbookToDiagram(wb, { database = "mysql", name = "imported" } = {}) {
  const tables = [], relationships = [], enums = [], types = [];
  let tableId = 0;
  const skip = new Set(["Summary", "Relationships", "Enums", "Types"]);

  wb.eachSheet((ws) => {
    if (skip.has(ws.name)) return;
    const aoa = wsToAoa(ws);
    if (isDrawdbAoa(aoa)) tables.push(parseDrawdbSheet(aoa, ws.name, tableId++));
    else tables.push(inferTableFromData(aoa, ws.name, tableId++, database));
  });

  const relWs = wb.getWorksheet("Relationships");
  if (relWs) {
    const aoa = wsToAoa(relWs);
    for (let i = 1; i < aoa.length; i++) {
      const [, name, fromT, fromC, toT, toC, type, onUpd, onDel] = aoa[i];
      if (!fromT || !toT) continue;
      const sT = tables.find((t) => t.name === fromT);
      const eT = tables.find((t) => t.name === toT);
      if (!sT || !eT) continue;
      relationships.push({
        id: relationships.length, name: name || `fk_${relationships.length + 1}`,
        startTableId: sT.id, startFieldId: sT.fields.findIndex((f) => f.name === fromC),
        endTableId: eT.id, endFieldId: eT.fields.findIndex((f) => f.name === toC),
        cardinality: type || "one_to_many",
        updateConstraint: onUpd || "NO ACTION", deleteConstraint: onDel || "NO ACTION",
      });
    }
  }

  const enumWs = wb.getWorksheet("Enums");
  if (enumWs) {
    const aoa = wsToAoa(enumWs);
    for (let i = 1; i < aoa.length; i++) {
      const [, name, vals] = aoa[i];
      if (!name) continue;
      enums.push({ name, values: String(vals || "").split(",").map((s) => s.trim()).filter(Boolean) });
    }
  }

  return {
    name, database, tables, relationships,
    notes: [], areas: [], types, enums, transform: { zoom: 1, pan: { x: 0, y: 0 } },
  };
}

const isDrawdbAoa = (aoa) =>
  aoa.some((r) => Array.isArray(r) && r[1] === "Column" && r[2] === "Type");

function parseDrawdbSheet(aoa, sheetName, id) {
  let tableName = sheetName, comment = "";
  const title = aoa[0] || [];
  const c0 = String(title[0] ?? "");
  const mName = c0.match(/^Table:\s*(.+)$/); // new merged layout: "Table: <name>"
  if (mName) tableName = mName[1].trim() || sheetName;
  else if (c0 === "Table" && title[1]) tableName = String(title[1]); // legacy two-cell layout
  const ci = title.findIndex((v) => String(v) === "Comment");
  if (ci >= 0) {
    for (let k = ci + 1; k < title.length; k++) {
      if (title[k] !== "" && title[k] != null) { comment = String(title[k]); break; }
    }
  }

  const h = aoa.findIndex((r) => Array.isArray(r) && r[1] === "Column" && r[2] === "Type");
  const fields = [];
  let idx = 0;
  if (h >= 0) {
    for (let i = h + 1; i < aoa.length; i++) {
      const r = aoa[i];
      if (!r || r.length === 0 || r[0] === "" || r[0] === "Indexes") break;
      if (!r[1]) continue;
      fields.push({
        id: idx++, name: String(r[1]),
        type: String(r[2] || "VARCHAR").toUpperCase(),
        size: r[3] !== "" && r[3] != null ? (Number(r[3]) || r[3]) : "",
        notNull: parseBool(r[4]), primary: parseBool(r[5]),
        unique: parseBool(r[6]), increment: parseBool(r[7]),
        default: r[8] ?? "", comment: r[9] ?? "", check: r[10] ?? "",
      });
    }
  }

  const indices = [];
  const ixHeader = aoa.findIndex((r) => Array.isArray(r) && r[0] === "Indexes");
  if (ixHeader >= 0) {
    for (let i = ixHeader + 2; i < aoa.length; i++) {
      const r = aoa[i];
      if (!r || !r[1]) break;
      indices.push({
        id: indices.length, name: r[1],
        fields: String(r[2] || "").split(",").map((s) => s.trim()).filter(Boolean),
        unique: parseBool(r[3]),
      });
    }
  }
  return mkTable(id, tableName, fields, indices, comment);
}

function inferTableFromData(aoa, name, id, database) {
  if (aoa.length === 0) return mkTable(id, name, [], [], "");
  const headers = (aoa[0] || []).map((h) => String(h ?? "").trim());
  const rows = aoa.slice(1, Math.min(aoa.length, 501));
  const fields = [];
  headers.forEach((h, ci) => {
    if (!h) return;
    const sample = rows.map((r) => r?.[ci]).filter((v) => v !== undefined && v !== null && v !== "");
    const inferred = inferType(sample, database);
    fields.push({
      id: fields.length, name: sanitizeColName(h),
      type: inferred.type, size: inferred.size,
      notNull: sample.length === rows.length && rows.length > 0,
      primary: ci === 0 && /^(id|.+_id)$/i.test(h),
      unique: false, increment: false,
      default: "", comment: h, check: "",
    });
  });
  return mkTable(id, name, fields, [], "");
}

function inferType(samples, db) {
  if (samples.length === 0) return { type: "VARCHAR", size: 255 };
  let allInt = true, allNum = true, allBool = true, allDate = true;
  let maxLen = 0, maxIntDigits = 0, maxDec = 0;
  for (const v of samples) {
    const s = String(v);
    maxLen = Math.max(maxLen, s.length);
    if (allBool && !["0", "1", "true", "false", "TRUE", "FALSE"].includes(s)) allBool = false;
    if (allInt && !/^-?\d+$/.test(s)) allInt = false;
    if (allNum && !/^-?\d+(\.\d+)?$/.test(s)) allNum = false;
    if (allDate && isNaN(Date.parse(s))) allDate = false;
    if (allNum && /\./.test(s)) {
      const [a, b] = s.split(".");
      maxIntDigits = Math.max(maxIntDigits, a.replace("-", "").length);
      maxDec = Math.max(maxDec, b.length);
    } else if (allInt) {
      maxIntDigits = Math.max(maxIntDigits, s.replace("-", "").length);
    }
  }
  if (allBool && samples.length) return db === "oracle" ? { type: "NUMBER", size: 1 } : { type: "BOOLEAN", size: "" };
  if (allInt) {
    if (db === "oracle") return { type: "NUMBER", size: Math.max(1, maxIntDigits) };
    if (maxIntDigits <= 4) return { type: "SMALLINT", size: "" };
    if (maxIntDigits <= 9) return { type: "INT", size: "" };
    return { type: "BIGINT", size: "" };
  }
  if (allNum) {
    if (db === "oracle") return { type: "NUMBER", size: `${maxIntDigits + maxDec},${maxDec}` };
    return { type: "DECIMAL", size: `${maxIntDigits + maxDec},${maxDec}` };
  }
  if (allDate) return { type: db === "oracle" ? "TIMESTAMP" : "DATETIME", size: "" };
  const size = nextPow2(Math.max(8, Math.min(4000, maxLen * 2)));
  return db === "oracle" ? { type: "VARCHAR2", size } : { type: "VARCHAR", size };
}

// ---- worksheet -> array-of-arrays ----
function wsToAoa(ws) {
  const aoa = [];
  const last = ws.rowCount;
  for (let r = 1; r <= last; r++) {
    const row = ws.getRow(r);
    const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
    aoa.push(vals.map(normalizeCell));
  }
  return aoa;
}

function normalizeCell(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString();
    if (typeof v.text === "string") return v.text;
    if ("result" in v) return v.result ?? "";
    if (Array.isArray(v.richText)) return v.richText.map((rt) => rt.text).join("");
    if ("hyperlink" in v) return v.text ?? v.hyperlink;
    return String(v);
  }
  return v;
}

function toArrayBuffer(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

// ---- helpers ----
function mkTable(id, name, fields, indices, comment) {
  return {
    id, name: sanitizeTableName(name),
    x: 20 + (id % 5) * 240, y: 20 + Math.floor(id / 5) * 220,
    fields, indices, comment, color: "#175e7a",
  };
}
const sanitizeColName = (s) => String(s).trim().replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1").slice(0, 64) || "col";
const sanitizeTableName = (s) => String(s).trim().replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1").slice(0, 64) || "tbl";
const stripExt = (n) => n.replace(/\.[^.]+$/, "");
const basename = (p) => p.split(/[\\/]/).pop();
const bool = (b) => (b ? "YES" : "NO");
const parseBool = (v) => v === true || v === 1 || v === "YES" || v === "TRUE" || v === "true" || v === "Y";
const nextPow2 = (n) => { let p = 8; while (p < n) p *= 2; return p; };
function uniqueSheetName(name, used) {
  const base = String(name).replace(/[[\]:*?/\\]/g, "_").slice(0, 31) || "Sheet";
  let n = base, i = 2;
  while (used.has(n)) { n = (base.slice(0, 28) + "_" + i++).slice(0, 31); }
  used.add(n);
  return n;
}
