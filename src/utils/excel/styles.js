export const EXCEL_COLORS = {
  brand: "FF175E7A",
  headerText: "FFFFFFFF",
  labelText: "FF445566",
  border: "FFD0D7DE",
  zebra: "FFF3F6F8",
  yes: "FF1A7F37",
};

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_COLORS.brand } };
const HEADER_FONT = { bold: true, color: { argb: EXCEL_COLORS.headerText }, size: 11 };
export const TITLE_FONT = { bold: true, size: 14, color: { argb: EXCEL_COLORS.brand } };
export const LABEL_FONT = { bold: true, color: { argb: EXCEL_COLORS.labelText } };
const THIN = { style: "thin", color: { argb: EXCEL_COLORS.border } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const ZEBRA = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_COLORS.zebra } };
const YES_FONT = { color: { argb: EXCEL_COLORS.yes }, bold: true };

export function styleHeader(row) {
  row.height = 18;
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = BORDER;
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });
}

export function styleBodyRow(row, zebra) {
  row.eachCell((cell) => {
    cell.border = BORDER;
    if (zebra) cell.fill = ZEBRA;
    if (cell.value === "YES") cell.font = YES_FONT;
  });
}

export function setWidths(ws, widths) {
  widths.forEach((width, index) => {
    ws.getColumn(index + 1).width = width;
  });
}

