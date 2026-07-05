import { describe, expect, it } from "vitest";
import { toOracle } from "../overlay/src/data/exportSQL/oracle.js";
import { toMySQL } from "../overlay/src/data/exportSQL/mysqlEnhanced.js";
import { toPostgres } from "../overlay/src/data/exportSQL/postgres.js";

function makeEdgeDiagram() {
  return {
    name: "Edges",
    tables: [
      {
        id: 0,
        name: "type_samples",
        fields: [
          { id: 0, name: "name", type: "CHAR", size: 12, notNull: false, primary: false, unique: false, increment: false, default: "guest", comment: "", check: "length(name) > 0" },
          { id: 1, name: "enabled", type: "BOOLEAN", size: "", notNull: true, primary: false, unique: false, increment: false, default: "true", comment: "", check: "" },
          { id: 2, name: "payload", type: "JSON", size: "", notNull: false, primary: false, unique: false, increment: false, default: "NULL", comment: "", check: "" },
          { id: 3, name: "token", type: "UUID", size: "", notNull: false, primary: false, unique: false, increment: false, default: "", comment: "", check: "" },
          { id: 4, name: "choice", type: "SET", size: "", notNull: false, primary: false, unique: false, increment: false, default: "", comment: "", check: "", values: ["a", "b"] },
          { id: 5, name: "fallback", type: "CUSTOM_TYPE", size: "", notNull: false, primary: false, unique: false, increment: false, default: "", comment: "", check: "" },
          { id: 6, name: "raw", type: "VARBINARY", size: 16, notNull: false, primary: false, unique: false, increment: false, default: "", comment: "", check: "" },
          { id: 7, name: "status", type: "named_status", size: "", notNull: false, primary: false, unique: false, increment: false, default: "new", comment: "", check: "" },
        ],
        indices: [{ id: 0, name: "idx_name", fields: ["name"], unique: false }],
        comment: "",
      },
    ],
    relationships: [
      { id: 0, name: "fk_missing", startTableId: 0, startFieldId: 0, endTableId: 999, endFieldId: 0, deleteConstraint: "NO ACTION", updateConstraint: "NO ACTION" },
    ],
    enums: [{ name: "named_status", values: ["new", "done"] }],
    types: [
      {
        name: "address_type",
        fields: [{ id: 0, name: "street", type: "VARCHAR", size: 50 }],
      },
    ],
  };
}

describe("SQL exporter edge cases", () => {
  it("covers type, default, check, enum, and invalid relationship branches", () => {
    const diagram = makeEdgeDiagram();

    expect(toMySQL(diagram)).toEqual(expect.stringContaining("`choice` SET('a','b')"));
    expect(toMySQL(diagram)).toEqual(expect.stringContaining("`fallback` VARCHAR"));
    expect(toMySQL(diagram)).toEqual(expect.stringContaining("`enabled` BOOLEAN NOT NULL DEFAULT true"));
    expect(toMySQL(diagram)).not.toContain("fk_missing");

    expect(toOracle(diagram)).toEqual(expect.stringContaining('CREATE OR REPLACE TYPE "address_type" AS OBJECT'));
    expect(toOracle(diagram)).toEqual(expect.stringContaining('"enabled" NUMBER(1) DEFAULT 1 NOT NULL'));
    expect(toOracle(diagram)).toEqual(expect.stringContaining('CONSTRAINT "chk_type_samples_name" CHECK (length(name) > 0)'));
    expect(toOracle(diagram)).not.toContain("fk_missing");

    expect(toPostgres(diagram)).toEqual(expect.stringContaining('CREATE TYPE "named_status" AS ENUM'));
    expect(toPostgres(diagram)).toEqual(expect.stringContaining('"status" "named_status" DEFAULT \'new\''));
    expect(toPostgres(diagram)).toEqual(expect.stringContaining('CONSTRAINT "chk_type_samples_name" CHECK (length(name) > 0)'));
    expect(toPostgres(diagram)).not.toContain("fk_missing");
  });
});
