import { describe, expect, it, vi } from "vitest";
import {
  ddbFingerprint,
  ddbToDatabaseRow,
  detectSqlDialect,
  normalizeEditorDatabase,
  upsertDdbDiagram,
} from "../src/desktop/diagram.js";
import { appRouteUrl } from "../src/desktop/navigation.js";
import { shouldOpenExternally } from "../src/desktop/externalLinks.js";
import {
  flushDesktopFile,
  openDesktopPath,
  registerDesktopRuntime,
} from "../src/desktop/runtime.js";
import { parseDdb, validateDdbDiagram } from "../src/utils/ddb.js";
import { ddbDiagramIsValid } from "../src/utils/validateSchema.js";
import { toPostgres } from "../src/data/exportSQL/postgres.js";
import { buildWorkbook } from "../src/utils/excel/build.js";

function memoryTable(initial = []) {
  const rows = initial.map((row, index) => ({ id: index + 1, ...row }));
  return {
    rows,
    where(key) {
      return {
        equals(value) {
          return {
            async first() {
              return rows.find((row) => row[key] === value);
            },
          };
        },
      };
    },
    async add(row) {
      const id = rows.length + 1;
      rows.push({ id, ...row });
      return id;
    },
    async update(id, patch) {
      const index = rows.findIndex((row) => row.id === id);
      rows[index] = { ...rows[index], ...patch };
    },
  };
}

const diagram = {
  diagramId: "diagram-1",
  name: "String IDs",
  database: "postgres",
  tables: [
    { id: "users", name: "users", fields: [{ id: "user-id", name: "id", type: "UUID" }] },
    { id: "orders", name: "orders", fields: [{ id: "owner-id", name: "owner_id", type: "UUID" }] },
  ],
  relationships: [{
    id: "fk-owner",
    startTableId: "orders",
    startFieldId: "owner-id",
    endTableId: "users",
    endFieldId: "user-id",
  }],
  notes: [],
  areas: [],
  types: [],
  enums: [],
  transform: { zoom: 1.5, pan: { x: 10, y: 20 } },
};

describe("integrated desktop diagram adapter", () => {
  it("accepts current drawDB string IDs and legacy row aliases", () => {
    expect(validateDdbDiagram(diagram)).toEqual({ valid: true, errors: [] });

    const parsed = parseDdb(JSON.stringify({
      diagramId: "legacy-1",
      title: "Legacy",
      database: "oracle",
      tables: diagram.tables,
      references: diagram.relationships,
      subjectAreas: [{ id: 0, name: "Area" }],
      pan: { x: 4, y: 5 },
      zoom: 2,
    }));

    expect(parsed).toMatchObject({
      diagramId: "legacy-1",
      name: "Legacy",
      title: "Legacy",
      relationships: diagram.relationships,
      areas: [{ id: 0, name: "Area" }],
      subjectAreas: [{ id: 0, name: "Area" }],
      transform: { pan: { x: 4, y: 5 }, zoom: 2 },
    });
  });

  it("writes files accepted by the upstream drawDB .ddb importer", () => {
    const payload = parseDdb(JSON.stringify({
      name: "Portable",
      tables: [],
      relationships: [],
      notes: [],
      areas: [],
    }));

    expect(ddbDiagramIsValid(payload)).toBe(true);
    expect(payload).toMatchObject({ title: "Portable", subjectAreas: [] });
  });

  it("maps file payloads to the integrated Dexie row shape", () => {
    const row = ddbToDatabaseRow(diagram, { now: new Date("2026-07-11T00:00:00Z") });

    expect(row.database).toBe("postgresql");
    expect(row.references).toEqual(diagram.relationships);
    expect(row.pan).toEqual({ x: 10, y: 20 });
    expect(row.zoom).toBe(1.5);
    expect(row.lastModified).toEqual(new Date("2026-07-11T00:00:00Z"));
  });

  it("creates then updates by indexed external diagramId", async () => {
    const table = memoryTable();
    const created = await upsertDdbDiagram(table, diagram);
    const updated = await upsertDdbDiagram(table, { ...diagram, name: "Updated" });

    expect(created.created).toBe(true);
    expect(updated.created).toBe(false);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].name).toBe("Updated");
  });

  it("generates an ID for legacy files and keeps fingerprints timestamp-free", async () => {
    const table = memoryTable();
    const created = await upsertDdbDiagram(table, { ...diagram, diagramId: undefined }, {
      createId: () => "generated-id",
      now: new Date("2026-07-11T00:00:00Z"),
    });

    expect(created.diagramId).toBe("generated-id");
    expect(ddbFingerprint(diagram)).toBe(ddbFingerprint({ ...diagram, lastModified: "2030-01-01" }));
  });

  it("normalizes database aliases and detects supported SQL dialects", () => {
    expect(normalizeEditorDatabase("oracle")).toBe("oraclesql");
    expect(normalizeEditorDatabase("postgres")).toBe("postgresql");
    expect(detectSqlDialect("CREATE TABLE t (id BIGSERIAL PRIMARY KEY);")).toBe("postgres");
    expect(detectSqlDialect("CREATE TABLE t (id NUMBER GENERATED ALWAYS AS IDENTITY);")).toBe("oracle");
    expect(detectSqlDialect("CREATE TABLE `t` (`id` INT AUTO_INCREMENT);")).toBe("mysql");
  });

  it("exports current string-based field IDs to SQL and Excel relationships", () => {
    const sql = toPostgres(diagram);
    const workbook = buildWorkbook(diagram);
    const relationshipRow = workbook.getWorksheet("Relationships").getRow(2).values;

    expect(sql).toContain('FOREIGN KEY ("owner_id") REFERENCES "users" ("id")');
    expect(relationshipRow).toEqual(expect.arrayContaining(["orders", "owner_id", "users", "id"]));
  });
});

describe("desktop runtime bridge", () => {
  it("routes hash-based desktop windows", () => {
    expect(appRouteUrl("/editor", { href: "tauri://localhost/#/" })).toBe("tauri://localhost/#/editor");
  });

  it("registers open and flush handlers with deterministic cleanup", async () => {
    const open = vi.fn();
    const flush = vi.fn();
    const unregister = registerDesktopRuntime({ open, flush });

    await openDesktopPath("/tmp/schema.ddb");
    await flushDesktopFile();
    expect(open).toHaveBeenCalledWith("/tmp/schema.ddb");
    expect(flush).toHaveBeenCalledOnce();

    unregister();
    await expect(openDesktopPath("/tmp/other.ddb")).rejects.toThrow("not ready");
  });

  it("keeps app routes internal and delegates web links to the system", () => {
    const location = {
      href: "http://tauri.localhost/#/editor",
      origin: "http://tauri.localhost",
    };

    expect(shouldOpenExternally("http://tauri.localhost/#/templates", location)).toBe(false);
    expect(shouldOpenExternally("https://drawdb-io.github.io/docs", location)).toBe(true);
    expect(shouldOpenExternally("mailto:drawdb@example.com", location)).toBe(true);
  });
});
