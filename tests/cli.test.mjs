import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { makeShopDiagram } from "./fixtures/shopDiagram.mjs";
import { parseDdb, serializeDdb, validateDdbDiagram } from "../src/utils/ddb.js";

const CLI = "scripts/drawdb-cli.mjs";
let tempDirs = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "drawdb-cli-"));
  tempDirs.push(dir);
  return dir;
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("drawdb headless CLI", () => {
  it("exports .ddb to SQL, imports SQL back to .ddb, and validates the result", () => {
    const dir = tempDir();
    const input = join(dir, "shop.ddb");
    const sql = join(dir, "shop.sql");
    const out = join(dir, "shop-roundtrip.ddb");
    writeFileSync(input, serializeDdb(makeShopDiagram(), { now: new Date("2026-01-01T00:00:00Z") }));

    const exported = runCli(["export", "--to", "sql", "--dialect", "postgres", input, "-o", sql]);
    expect(exported.status).toBe(0);
    expect(readFileSync(sql, "utf8")).toContain('CREATE TABLE "users"');

    const imported = runCli(["import", "--from", "sql", "--dialect", "postgres", sql, "-o", out]);
    expect(imported.status).toBe(0);
    const diagram = parseDdb(readFileSync(out, "utf8"));
    expect(validateDdbDiagram(diagram).valid).toBe(true);
    expect(diagram.tables).toHaveLength(2);
    expect(diagram.relationships).toHaveLength(1);

    const validated = runCli(["validate", out]);
    expect(validated.status).toBe(0);
    expect(validated.stdout).toContain("valid .ddb");

    const mssql = join(dir, "shop-mssql.sql");
    const mssqlOut = join(dir, "shop-mssql.ddb");
    expect(runCli(["export", "--to", "sql", "--dialect", "sqlserver", input, "-o", mssql]).status).toBe(0);
    expect(readFileSync(mssql, "utf8")).toContain("CREATE TABLE [users]");
    expect(runCli(["import", "--from", "sql", "--dialect", "mssql", mssql, "-o", mssqlOut]).status).toBe(0);
    const fromMssql = parseDdb(readFileSync(mssqlOut, "utf8"));
    expect(fromMssql.tables.map((table) => table.name)).toEqual(["users", "orders"]);
    expect(fromMssql.relationships).toHaveLength(1);
  });

  it("exports .ddb to Excel and imports Excel back to .ddb", () => {
    const dir = tempDir();
    const input = join(dir, "shop.ddb");
    const xlsx = join(dir, "shop.xlsx");
    const out = join(dir, "shop-from-xlsx.ddb");
    writeFileSync(input, serializeDdb(makeShopDiagram(), { now: new Date("2026-01-01T00:00:00Z") }));

    const exported = runCli(["export", "--to", "xlsx", input, "-o", xlsx]);
    expect(exported.status).toBe(0);
    expect(existsSync(xlsx)).toBe(true);

    const imported = runCli(["import", "--from", "xlsx", "--dialect", "mysql", xlsx, "-o", out]);
    expect(imported.status).toBe(0);
    const diagram = parseDdb(readFileSync(out, "utf8"));
    expect(validateDdbDiagram(diagram).valid).toBe(true);
    expect(diagram.tables.map((table) => table.name)).toEqual(["users", "orders"]);
    expect(diagram.relationships[0]).toMatchObject({ deleteConstraint: "CASCADE" });
  });

  it("returns a nonzero exit code for invalid .ddb input", () => {
    const dir = tempDir();
    const input = join(dir, "bad.ddb");
    const bad = {
      name: "bad",
      tables: [{ id: 0, name: "users", fields: [{ id: 0, name: "id" }] }],
      relationships: [],
    };
    writeFileSync(input, JSON.stringify(bad));

    const result = runCli(["validate", input]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid .ddb diagram");
    expect(result.stderr).toContain("type is required");
  });
});
