// @ts-check
import { RESERVED_SHEET_NAMES, SAMPLE_ROW_LIMIT } from "./constants.js";
import { mkTable, nextPow2, parseBool, sanitizeColName } from "./helpers.js";

// Pure: parse a loaded ExcelJS workbook into a diagram (no file I/O).
export function workbookToDiagram(wb, { database = "mysql", name = "imported" } = {}) {
  const tables = [];
  const relationships = [];
  const enums = [];
  const types = [];
  let tableId = 0;

  wb.eachSheet((ws) => {
    if (RESERVED_SHEET_NAMES.has(ws.name)) return;
    const aoa = wsToAoa(ws);
    if (isDrawdbAoa(aoa)) tables.push(parseDrawdbSheet(aoa, ws.name, tableId++));
    else tables.push(inferTableFromData(aoa, ws.name, tableId++, database));
  });

  const relWs = wb.getWorksheet("Relationships");
  if (relWs) {
    const aoa = wsToAoa(relWs);
    for (let i = 1; i < aoa.length; i++) {
      const [, name, fromTable, fromColumn, toTable, toColumn, type, onUpdate, onDelete] = aoa[i];
      if (!fromTable || !toTable) continue;
      const startTable = tables.find((table) => table.name === fromTable);
      const endTable = tables.find((table) => table.name === toTable);
      if (!startTable || !endTable) continue;
      relationships.push({
        id: relationships.length,
        name: name || `fk_${relationships.length + 1}`,
        startTableId: startTable.id,
        startFieldId: startTable.fields.findIndex((field) => field.name === fromColumn),
        endTableId: endTable.id,
        endFieldId: endTable.fields.findIndex((field) => field.name === toColumn),
        cardinality: type || "one_to_many",
        updateConstraint: onUpdate || "NO ACTION",
        deleteConstraint: onDelete || "NO ACTION",
      });
    }
  }

  const enumWs = wb.getWorksheet("Enums");
  if (enumWs) {
    const aoa = wsToAoa(enumWs);
    for (let i = 1; i < aoa.length; i++) {
      const [, enumName, values] = aoa[i];
      if (!enumName) continue;
      enums.push({
        name: enumName,
        values: String(values || "").split(",").map((value) => value.trim()).filter(Boolean),
      });
    }
  }

  return {
    name,
    database,
    tables,
    relationships,
    notes: [],
    areas: [],
    types,
    enums,
    transform: { zoom: 1, pan: { x: 0, y: 0 } },
  };
}

const isDrawdbAoa = (aoa) =>
  aoa.some((row) => Array.isArray(row) && row[1] === "Column" && row[2] === "Type");

function parseDrawdbSheet(aoa, sheetName, id) {
  let tableName = sheetName;
  let comment = "";
  const title = aoa[0] || [];
  const firstCell = String(title[0] ?? "");
  const nameMatch = firstCell.match(/^Table:\s*(.+)$/);
  if (nameMatch) tableName = nameMatch[1].trim() || sheetName;
  else if (firstCell === "Table" && title[1]) tableName = String(title[1]);
  const commentIndex = title.findIndex((value) => String(value) === "Comment");
  if (commentIndex >= 0) {
    for (let index = commentIndex + 1; index < title.length; index++) {
      if (title[index] !== "" && title[index] != null) {
        comment = String(title[index]);
        break;
      }
    }
  }

  const headerIndex = aoa.findIndex((row) => Array.isArray(row) && row[1] === "Column" && row[2] === "Type");
  const fields = [];
  let fieldId = 0;
  if (headerIndex >= 0) {
    for (let i = headerIndex + 1; i < aoa.length; i++) {
      const row = aoa[i];
      if (!row || row.length === 0 || row[0] === "" || row[0] === "Indexes") break;
      if (!row[1]) continue;
      fields.push({
        id: fieldId++,
        name: String(row[1]),
        type: String(row[2] || "VARCHAR").toUpperCase(),
        size: row[3] !== "" && row[3] != null ? (Number(row[3]) || row[3]) : "",
        notNull: parseBool(row[4]),
        primary: parseBool(row[5]),
        unique: parseBool(row[6]),
        increment: parseBool(row[7]),
        default: row[8] ?? "",
        comment: row[9] ?? "",
        check: row[10] ?? "",
      });
    }
  }

  const indices = [];
  const indexHeader = aoa.findIndex((row) => Array.isArray(row) && row[0] === "Indexes");
  if (indexHeader >= 0) {
    for (let i = indexHeader + 2; i < aoa.length; i++) {
      const row = aoa[i];
      if (!row || !row[1]) break;
      indices.push({
        id: indices.length,
        name: row[1],
        fields: String(row[2] || "").split(",").map((value) => value.trim()).filter(Boolean),
        unique: parseBool(row[3]),
      });
    }
  }
  return mkTable(id, tableName, fields, indices, comment);
}

export function inferTableFromData(aoa, name, id, database) {
  if (aoa.length === 0) return mkTable(id, name, [], [], "");
  const headers = (aoa[0] || []).map((header) => String(header ?? "").trim());
  const rows = aoa.slice(1, SAMPLE_ROW_LIMIT + 1);
  const fields = [];
  headers.forEach((header, columnIndex) => {
    if (!header) return;
    const sample = rows
      .map((row) => row?.[columnIndex])
      .filter((value) => value !== undefined && value !== null && value !== "");
    const inferred = inferColumnType(sample, database);
    fields.push({
      id: fields.length,
      name: sanitizeColName(header),
      type: inferred.type,
      size: inferred.size,
      notNull: sample.length === rows.length && rows.length > 0,
      primary: columnIndex === 0 && /^(id|.+_id)$/i.test(header),
      unique: false,
      increment: false,
      default: "",
      comment: header,
      check: "",
    });
  });
  return mkTable(id, name, fields, [], "");
}

export function inferColumnType(samples, database) {
  if (samples.length === 0) return { type: "VARCHAR", size: 255 };
  let allInt = true;
  let allNum = true;
  let allBool = true;
  let allDate = true;
  let maxLen = 0;
  let maxIntDigits = 0;
  let maxDec = 0;
  for (const value of samples) {
    const text = String(value);
    maxLen = Math.max(maxLen, text.length);
    if (allBool && !["0", "1", "true", "false", "TRUE", "FALSE"].includes(text)) allBool = false;
    if (allInt && !/^-?\d+$/.test(text)) allInt = false;
    if (allNum && !/^-?\d+(\.\d+)?$/.test(text)) allNum = false;
    if (allDate && Number.isNaN(Date.parse(text))) allDate = false;
    if (allNum && /\./.test(text)) {
      const [integerPart, decimalPart] = text.split(".");
      maxIntDigits = Math.max(maxIntDigits, integerPart.replace("-", "").length);
      maxDec = Math.max(maxDec, decimalPart.length);
    } else if (allInt) {
      maxIntDigits = Math.max(maxIntDigits, text.replace("-", "").length);
    }
  }
  if (allBool) return database === "oracle" ? { type: "NUMBER", size: 1 } : { type: "BOOLEAN", size: "" };
  if (allInt) {
    if (database === "oracle") return { type: "NUMBER", size: Math.max(1, maxIntDigits) };
    if (maxIntDigits <= 4) return { type: "SMALLINT", size: "" };
    if (maxIntDigits <= 9) return { type: "INT", size: "" };
    return { type: "BIGINT", size: "" };
  }
  if (allNum) {
    const size = `${maxIntDigits + maxDec},${maxDec}`;
    return database === "oracle" ? { type: "NUMBER", size } : { type: "DECIMAL", size };
  }
  if (allDate) return { type: database === "oracle" ? "TIMESTAMP" : "DATETIME", size: "" };
  const size = nextPow2(Math.max(8, Math.min(4000, maxLen * 2)));
  return database === "oracle" ? { type: "VARCHAR2", size } : { type: "VARCHAR", size };
}

function wsToAoa(ws) {
  const aoa = [];
  const last = ws.rowCount;
  for (let rowIndex = 1; rowIndex <= last; rowIndex++) {
    const row = ws.getRow(rowIndex);
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    aoa.push(values.map(normalizeCell));
  }
  return aoa;
}

function normalizeCell(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    if (typeof value.text === "string") return value.text;
    if ("result" in value) return value.result ?? "";
    if (Array.isArray(value.richText)) return value.richText.map((item) => item.text).join("");
    if ("hyperlink" in value) return value.text ?? value.hyperlink;
    return String(value);
  }
  return value;
}

