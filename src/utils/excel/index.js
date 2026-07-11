import ExcelJS from "exceljs";
import { readBinaryFile, writeBinaryFile } from "../desktopIO.js";
import { buildWorkbook } from "./build.js";
import { basename, stripExt, toArrayBuffer } from "./helpers.js";
import { workbookToDiagram } from "./parse.js";

export { SAMPLE_ROW_LIMIT } from "./constants.js";
export { buildWorkbook } from "./build.js";
export { inferColumnType, inferTableFromData, workbookToDiagram } from "./parse.js";

export async function exportDiagramToExcel(path, diagram) {
  const wb = buildWorkbook(diagram);
  const buffer = await wb.xlsx.writeBuffer();
  await writeBinaryFile(path, new Uint8Array(buffer));
  return { path, tables: (diagram.tables || []).length };
}

export async function importExcelToDiagram(path, { database = "mysql" } = {}) {
  const bytes = await readBinaryFile(path);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(toArrayBuffer(bytes));
  return workbookToDiagram(wb, { database, name: stripExt(basename(path)) });
}

