import ExcelJS from "exceljs";
import { RESERVED_SHEET_NAMES } from "./constants.js";
import { bool, uniqueSheetName } from "./helpers.js";
import { LABEL_FONT, TITLE_FONT, setWidths, styleBodyRow, styleHeader } from "./styles.js";

// Pure: build a styled ExcelJS workbook from a diagram (no file I/O).
export function buildWorkbook(diagram) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "drawDB Desktop";
  wb.created = new Date();

  buildSummarySheet(wb, diagram);

  const used = new Set(RESERVED_SHEET_NAMES);
  (diagram.tables || []).forEach((table) => buildTableSheet(wb, table, diagram, used));

  buildRelationshipsSheet(wb, diagram);
  buildEnumsSheet(wb, diagram);
  buildTypesSheet(wb, diagram);
  return wb;
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
  meta.forEach((entry, index) => {
    const row = ws.getRow(2 + index);
    row.getCell(1).value = entry[0];
    row.getCell(1).font = LABEL_FONT;
    row.getCell(2).value = entry[1];
  });
  const header = ws.getRow(7);
  header.values = ["#", "Table", "Columns", "PK", "FKs", "Comment"];
  styleHeader(header);
  (diagram.tables || []).forEach((table, index) => {
    const pkCols = (table.fields || []).filter((field) => field.primary).map((field) => field.name).join(", ");
    const fkCount = (diagram.relationships || []).filter((rel) => rel.startTableId === table.id).length;
    const row = ws.addRow([
      index + 1,
      table.name,
      (table.fields || []).length,
      pkCols,
      fkCount,
      table.comment || "",
    ]);
    styleBodyRow(row, index % 2 === 1);
  });
  ws.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7, column: 6 } };
}

function buildTableSheet(wb, table, diagram, used) {
  const sheetName = uniqueSheetName(table.name || "Table", used);
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 3 }] });
  setWidths(ws, [4, 26, 16, 8, 8, 5, 8, 9, 18, 30, 30]);
  ws.mergeCells("A1:C1");
  ws.getCell("A1").value = `Table: ${table.name}`;
  ws.getCell("A1").font = TITLE_FONT;
  if (table.comment) {
    ws.getCell("D1").value = "Comment";
    ws.getCell("D1").font = LABEL_FONT;
    ws.mergeCells("E1:K1");
    ws.getCell("E1").value = table.comment;
  }

  const header = ws.getRow(3);
  header.values = ["#", "Column", "Type", "Size", "NotNull", "PK", "Unique", "AutoInc", "Default", "Comment", "Check"];
  styleHeader(header);
  (table.fields || []).forEach((field, index) => {
    const row = ws.addRow([
      index + 1,
      field.name,
      field.type,
      field.size ?? "",
      bool(field.notNull),
      bool(field.primary),
      bool(field.unique),
      bool(field.increment),
      field.default ?? "",
      field.comment ?? "",
      field.check ?? "",
    ]);
    styleBodyRow(row, index % 2 === 1);
    if (field.primary) row.getCell(2).font = { bold: true };
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 11 } };

  if ((table.indices || []).length) {
    ws.addRow([]);
    const label = ws.addRow(["Indexes"]);
    label.getCell(1).font = TITLE_FONT;
    const indexHeader = ws.addRow(["#", "Name", "Columns", "Unique"]);
    styleHeader(indexHeader);
    table.indices.forEach((indexSpec, index) => {
      const row = ws.addRow([
        index + 1,
        indexSpec.name,
        (indexSpec.fields || []).join(", "),
        bool(indexSpec.unique),
      ]);
      styleBodyRow(row, index % 2 === 1);
    });
  }
}

function buildRelationshipsSheet(wb, diagram) {
  const ws = wb.addWorksheet("Relationships", { views: [{ state: "frozen", ySplit: 1 }] });
  setWidths(ws, [4, 26, 22, 22, 22, 22, 16, 14, 14]);
  const header = ws.getRow(1);
  header.values = ["#", "Name", "FromTable", "FromColumn", "ToTable", "ToColumn", "Type", "OnUpdate", "OnDelete"];
  styleHeader(header);
  (diagram.relationships || []).forEach((relationship, index) => {
    const startTable = (diagram.tables || []).find((table) => table.id === relationship.startTableId);
    const endTable = (diagram.tables || []).find((table) => table.id === relationship.endTableId);
    const row = ws.addRow([
      index + 1,
      relationship.name || `fk_${index + 1}`,
      startTable?.name ?? "",
      startTable?.fields?.[relationship.startFieldId]?.name ?? "",
      endTable?.name ?? "",
      endTable?.fields?.[relationship.endFieldId]?.name ?? "",
      relationship.cardinality || "one_to_many",
      relationship.updateConstraint || "NO ACTION",
      relationship.deleteConstraint || "NO ACTION",
    ]);
    styleBodyRow(row, index % 2 === 1);
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
  diagram.enums.forEach((enumSpec, index) => {
    const row = ws.addRow([index + 1, enumSpec.name, (enumSpec.values || []).join(", ")]);
    styleBodyRow(row, index % 2 === 1);
  });
}

function buildTypesSheet(wb, diagram) {
  if (!(diagram.types || []).length) return;
  const ws = wb.addWorksheet("Types", { views: [{ state: "frozen", ySplit: 1 }] });
  setWidths(ws, [4, 26, 80]);
  const header = ws.getRow(1);
  header.values = ["#", "Name", "Fields"];
  styleHeader(header);
  diagram.types.forEach((typeSpec, index) => {
    const fields = (typeSpec.fields || [])
      .map((field) => `${field.name}:${field.type}${field.size ? `(${field.size})` : ""}`)
      .join(", ");
    const row = ws.addRow([index + 1, typeSpec.name, fields]);
    styleBodyRow(row, index % 2 === 1);
  });
}

