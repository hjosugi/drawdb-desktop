import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  alignDiagram,
  compareDiagrams,
  migrationScript,
  resolveDialect,
} from "../src/desktop/schemaDiff.js";
import { makeShopDiagram } from "./fixtures/shopDiagram.mjs";
import { fromMySQL } from "../src/data/importSQL/mysqlEnhanced.js";
import { toMySQL } from "../src/data/exportSQL/mysqlEnhanced.js";

const field = (id, name, type, extra = {}) => ({
  id, name, type, size: "", notNull: false, primary: false, unique: false,
  increment: false, default: "", comment: "", check: "", ...extra,
});

function evolved() {
  const next = structuredClone(makeShopDiagram());
  next.tables[0].fields.push(field(4, "nickname", "VARCHAR", { size: 30 }));
  next.tables[0].fields[1].size = 100; // email VARCHAR(255) -> VARCHAR(100)
  next.tables[1].fields.splice(2, 1); // drop orders.amount
  next.tables.push({ id: 2, name: "tags", fields: [field(0, "id", "INT", { primary: true, notNull: true })], indices: [] });
  return next;
}

describe("schema comparison", () => {
  it("lists added, removed, and modified elements with destructive warnings", () => {
    const result = compareDiagrams(makeShopDiagram(), evolved(), { database: "postgresql" });
    const summary = result.changes.map((change) =>
      `${change.action}:${change.kind}:${change.table}:${change.name}${change.property ? `.${change.property}` : ""}`);

    expect(summary).toEqual([
      "removed:field:orders:amount",
      "added:table:tags:tags",
      "modified:field:users:email.size",
      "added:field:users:nickname",
    ]);
    expect(result.destructive.map((change) => change.name)).toEqual(["amount", "email"]);
  });

  it("generates reversible PostgreSQL and MySQL migrations", () => {
    const postgres = compareDiagrams(makeShopDiagram(), evolved(), { database: "postgresql" });
    expect(postgres.sql.up).toContain('ALTER TABLE "users" ALTER COLUMN "email" TYPE VARCHAR(100);');
    expect(postgres.sql.up).toContain('ALTER TABLE "users" ADD COLUMN "nickname" VARCHAR(30);');
    expect(postgres.sql.up).toContain('ALTER TABLE "orders" DROP COLUMN "amount";');
    expect(postgres.sql.up).toMatch(/CREATE TABLE IF NOT EXISTS "tags"/);
    expect(postgres.sql.down).toContain('DROP TABLE "tags";');
    expect(postgres.sql.down).toContain('ALTER TABLE "orders" ADD COLUMN "amount" DECIMAL(12,2)');

    const mysql = compareDiagrams(makeShopDiagram(), evolved(), { database: "mysql" });
    expect(mysql.dialect).toBe("mysql");
    expect(mysql.sql.up).toContain("ALTER TABLE `users` ADD COLUMN `nickname`");
    expect(mysql.sql.up).toContain("ALTER TABLE `orders` DROP COLUMN `amount`;");
  });

  it("reports no changes for identical schemas and ignores layout moves", () => {
    const moved = structuredClone(makeShopDiagram());
    moved.tables[0].x = 999;
    moved.tables[1].color = "#ff0000";
    const result = compareDiagrams(makeShopDiagram(), moved);

    expect(result.changes).toEqual([]);
    expect(result.sql).toEqual({ up: "", down: "" });
  });

  it("matches schemas imported separately by table and column name", () => {
    // Positional ids from SQL import: inserting a table shifts every id.
    const before = fromMySQL(toMySQL(makeShopDiagram()));
    const extended = makeShopDiagram();
    extended.tables.unshift({ id: 9, name: "audit", fields: [field(0, "id", "INT")], indices: [] });
    const after = fromMySQL(toMySQL(extended));
    const result = compareDiagrams(before, after, { database: "mysql" });

    expect(result.changes.map((change) => `${change.action}:${change.kind}:${change.name}`))
      .toEqual(["added:table:audit"]);
  });

  it("detects renames when ids are stable", () => {
    const renamed = structuredClone(makeShopDiagram());
    renamed.tables[1].fields[2].name = "total";
    const result = compareDiagrams(makeShopDiagram(), renamed, { database: "postgresql" });

    expect(result.changes).toEqual([
      expect.objectContaining({ action: "modified", kind: "field", property: "name", from: "amount", to: "total" }),
    ]);
    expect(result.sql.up).toContain('RENAME COLUMN "amount" TO "total"');
  });

  it("keeps relationship endpoints valid after aligning ids", () => {
    const before = makeShopDiagram();
    const after = structuredClone(before);
    after.tables.reverse().forEach((table, index) => {
      table.id = `t${index}`;
    });
    after.relationships[0].startTableId = "t0";
    after.relationships[0].endTableId = "t1";
    const aligned = alignDiagram(before, after);

    expect(aligned.tables.map((table) => table.id).sort()).toEqual([0, 1]);
    expect(aligned.relationships[0]).toMatchObject({ startTableId: 1, endTableId: 0, id: 0 });
    expect(compareDiagrams(before, after).changes).toEqual([]);
  });

  it("maps diagram databases to generator dialects", () => {
    expect(resolveDialect("postgres")).toBe("postgresql");
    expect(resolveDialect("mssql")).toBe("transactsql");
    expect(resolveDialect("oracle")).toBe("oraclesql");
    expect(resolveDialect("generic")).toBe("postgresql");
  });

  it("writes a runnable migration file with the down script commented out", () => {
    const text = migrationScript({ up: "ALTER TABLE a ADD b INT;", down: "ALTER TABLE a DROP b;" }, {
      dialect: "mysql",
      fromLabel: "v1.ddb",
      toLabel: "current diagram",
      now: new Date("2026-01-01T00:00:00Z"),
    });

    expect(text).toContain("-- Up\nALTER TABLE a ADD b INT;");
    expect(text).toContain("-- Down\n-- ALTER TABLE a DROP b;");
    expect(text).toContain("-- From: v1.ddb");
  });
});

describe("schema comparison UI wiring", () => {
  it("offers current-vs-file and file-vs-file comparisons with a SQL save action", () => {
    const fileMenu = readFileSync("src/desktop/useDesktopFileMenu.jsx", "utf8");
    const viewer = readFileSync("src/components/SchemaDiffViewer.jsx", "utf8");

    expect(fileMenu).toContain('tr("menu.compareWithFile"), function: compareWithFile');
    expect(fileMenu).toContain('tr("menu.compareFiles"), function: compareFiles');
    expect(fileMenu).toContain("<SchemaDiffViewer");
    expect(viewer).toContain("compareDiagrams(comparison.from, comparison.to, { database: dialect })");
    expect(viewer).toContain('role="alert"');
    for (const action of ["added", "removed", "modified"]) {
      expect(viewer).toMatch(new RegExp(`${action}: "bg-(green|red|yellow)-50`));
    }
  });
});
