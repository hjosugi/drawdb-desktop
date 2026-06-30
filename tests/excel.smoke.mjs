// Excel I/O smoke test (exceljs, in-memory round-trip — no Tauri/filesystem).
// Run with: node tests/excel.smoke.mjs   (requires `npm i exceljs`; exit 1 on failure)
import { buildWorkbook, workbookToDiagram } from "../overlay/src/utils/excelIO.js";

const diagram = {
  name: "Shop", database: "mysql",
  tables: [
    { id: 0, name: "users", comment: "Users table",
      fields: [
        { id:0, name:"id", type:"INT", size:"", notNull:true, primary:true, unique:false, increment:true, default:"", comment:"PK", check:"" },
        { id:1, name:"email", type:"VARCHAR", size:255, notNull:true, primary:false, unique:true, increment:false, default:"", comment:"", check:"" },
        { id:2, name:"created", type:"TIMESTAMP", size:"", notNull:true, primary:false, unique:false, increment:false, default:"CURRENT_TIMESTAMP", comment:"", check:"" },
      ],
      indices: [{ id:0, name:"idx_email", fields:["email"], unique:true }] },
    { id: 1, name: "orders", comment: "",
      fields: [
        { id:0, name:"id", type:"BIGINT", size:"", notNull:true, primary:true, unique:false, increment:true, default:"", comment:"", check:"" },
        { id:1, name:"user_id", type:"INT", size:"", notNull:true, primary:false, unique:false, increment:false, default:"", comment:"", check:"" },
        { id:2, name:"amount", type:"DECIMAL", size:"12,2", notNull:false, primary:false, unique:false, increment:false, default:"0.00", comment:"money", check:"" },
      ], indices: [] },
  ],
  relationships: [{ id:0, name:"fk_orders_user", startTableId:1, startFieldId:1, endTableId:0, endFieldId:0,
    cardinality:"one_to_many", updateConstraint:"NO ACTION", deleteConstraint:"CASCADE" }],
  enums: [{ name:"role", values:["admin","user"] }], types: [],
};

let fail = 0;
const check = (l, c) => { console.log((c ? "  PASS  " : "  FAIL  ") + l); if (!c) fail++; };

const wb = buildWorkbook(diagram);

// formatting assertions
const usersWs = wb.getWorksheet("users");
const hdr = usersWs.getRow(3);
check("header row bold", hdr.getCell(1).font?.bold === true);
check("header fill = brand", hdr.getCell(1).fill?.fgColor?.argb === "FF175E7A");
check("header has border", !!hdr.getCell(1).border?.bottom);
check("autofilter set", !!usersWs.autoFilter);
check("frozen panes", usersWs.views?.[0]?.state === "frozen");
check("column width applied", usersWs.getColumn(2).width === 26);
check("Summary sheet present", !!wb.getWorksheet("Summary"));
check("Enums sheet present", !!wb.getWorksheet("Enums"));

// in-memory round-trip via xlsx buffer
const buf = await wb.xlsx.writeBuffer();
const ExcelJS = (await import("exceljs")).default;
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.load(buf);
const back = workbookToDiagram(wb2, { database: "mysql", name: "Shop" });

check("import: 2 tables", back.tables.length === 2);
check("import: users 3 fields", back.tables[0].fields.length === 3);
check("import: id PK + autoinc", back.tables[0].fields[0].primary === true && back.tables[0].fields[0].increment === true);
check("import: email unique + notNull", back.tables[0].fields[1].unique === true && back.tables[0].fields[1].notNull === true);
check("import: users comment preserved", back.tables[0].comment === "Users table");
check("import: index preserved", back.tables[0].indices.length === 1 && back.tables[0].indices[0].unique === true);
check("import: amount DECIMAL(12,2)", back.tables[1].fields[2].type === "DECIMAL" && String(back.tables[1].fields[2].size) === "12,2");
check("import: 1 relationship CASCADE", back.relationships.length === 1 && back.relationships[0].deleteConstraint === "CASCADE");
check("import: enum role preserved", back.enums.length === 1 && back.enums[0].values.join(",") === "admin,user");

console.log(fail === 0 ? "\nEXCEL SMOKE TESTS PASSED" : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
