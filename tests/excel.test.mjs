import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildWorkbook, workbookToDiagram } from "../overlay/src/utils/excelIO.js";
import { makeShopDiagram } from "./fixtures/shopDiagram.mjs";

describe("Excel I/O", () => {
  it("builds a styled workbook and round-trips through exceljs", async () => {
    const wb = buildWorkbook(makeShopDiagram());

    const usersWs = wb.getWorksheet("users");
    const header = usersWs.getRow(3);
    expect(header.getCell(1).font?.bold).toBe(true);
    expect(header.getCell(1).fill?.fgColor?.argb).toBe("FF175E7A");
    expect(header.getCell(1).border?.bottom).toBeTruthy();
    expect(usersWs.autoFilter).toBeTruthy();
    expect(usersWs.views?.[0]?.state).toBe("frozen");
    expect(usersWs.getColumn(2).width).toBe(26);
    expect(wb.getWorksheet("Summary")).toBeTruthy();
    expect(wb.getWorksheet("Enums")).toBeTruthy();

    const buffer = await wb.xlsx.writeBuffer();
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buffer);
    const back = workbookToDiagram(loaded, { database: "mysql", name: "Shop" });

    expect(back.tables).toHaveLength(2);
    expect(back.tables[0].fields).toHaveLength(4);
    expect(back.tables[0].fields[0]).toMatchObject({ primary: true, increment: true });
    expect(back.tables[0].fields[1]).toMatchObject({ unique: true, notNull: true });
    expect(back.tables[0].comment).toBe("Users table");
    expect(back.tables[0].indices[0]).toMatchObject({ unique: true, fields: ["email"] });
    expect(back.tables[1].fields[2]).toMatchObject({ type: "DECIMAL", size: "12,2" });
    expect(back.relationships[0]).toMatchObject({ deleteConstraint: "CASCADE" });
    expect(back.enums[0]).toEqual({ name: "role", values: ["admin", "user"] });
  });

  it("infers a diagram from arbitrary spreadsheet data", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("raw orders");
    ws.addRow(["id", "total", "is_paid", "created_at", "customer name"]);
    ws.addRow([1, "12.34", "true", "2024-01-02", "Ada"]);
    ws.addRow([2, "56.70", "false", "2024-02-03", "Grace"]);

    const postgres = workbookToDiagram(wb, { database: "postgres", name: "Imported" });
    const table = postgres.tables[0];
    expect(table.name).toBe("raw_orders");
    expect(table.fields.map((field) => field.name)).toEqual(["id", "total", "is_paid", "created_at", "customer_name"]);
    expect(table.fields[0]).toMatchObject({ type: "SMALLINT", primary: true, notNull: true });
    expect(table.fields[1]).toMatchObject({ type: "DECIMAL", size: "4,2" });
    expect(table.fields[2]).toMatchObject({ type: "BOOLEAN" });
    expect(table.fields[3]).toMatchObject({ type: "DATETIME" });
    expect(table.fields[4]).toMatchObject({ type: "VARCHAR", size: 16 });

    const oracle = workbookToDiagram(wb, { database: "oracle", name: "Imported" });
    expect(oracle.tables[0].fields[1]).toMatchObject({ type: "NUMBER", size: "4,2" });
    expect(oracle.tables[0].fields[2]).toMatchObject({ type: "NUMBER", size: 1 });
    expect(oracle.tables[0].fields[3]).toMatchObject({ type: "TIMESTAMP" });
  });
});
