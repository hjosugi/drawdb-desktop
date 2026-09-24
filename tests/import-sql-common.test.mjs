import { describe, expect, it } from "vitest";
import { normalizeConstraintAction, stripSqlComments } from "../src/data/importSQL/common.js";

describe("SQL import parser helpers", () => {
  it("strips line and block comments without touching quoted literals or identifiers", () => {
    const stripped = stripSqlComments(`
      -- remove this line
      CREATE TABLE "keep--identifier" (
        note VARCHAR(255) DEFAULT '-- keep literal',
        code VARCHAR(255) DEFAULT '/* keep literal */',
        /* remove this block */
        \`tick--identifier\` INT
      );
    `);

    expect(stripped).not.toContain("remove this line");
    expect(stripped).not.toContain("remove this block");
    expect(stripped).toContain('"keep--identifier"');
    expect(stripped).toContain("'-- keep literal'");
    expect(stripped).toContain("'/* keep literal */'");
    expect(stripped).toContain("`tick--identifier`");
  });

  it("normalizes optional referential actions", () => {
    expect(normalizeConstraintAction(" set   null ")).toBe("SET NULL");
    expect(normalizeConstraintAction()).toBe("NO ACTION");
  });
});

describe("shared SQL import helpers", () => {
  it("builds identifier patterns for each quoting style", async () => {
    const { identifierPattern } = await import("../src/data/importSQL/common.js");
    const bracket = new RegExp(`^${identifierPattern(["[", '"']).qualified}$`);
    const backtick = new RegExp(`^${identifierPattern(["`"]).ident}$`);

    expect(bracket.test("[dbo].[Order Items]")).toBe(true);
    expect(bracket.test('"sales"."orders"')).toBe(true);
    expect(bracket.test("db.dbo.orders")).toBe(true);
    expect(backtick.test("`odd``name`")).toBe(true);
    expect(backtick.test("plain$name")).toBe(true);
  });

  it("unquotes qualified identifiers without splitting quoted dots", async () => {
    const { unquoteIdentifier } = await import("../src/data/importSQL/common.js");

    expect(unquoteIdentifier('"sales"."order.items"')).toBe("order.items");
    expect(unquoteIdentifier("[dbo].[a]]b]")).toBe("a]b");
    expect(unquoteIdentifier("`x``y`", { qualified: false })).toBe("x`y");
    expect(unquoteIdentifier("schema.plain")).toBe("plain");
    expect(unquoteIdentifier("'literal'")).toBe("'literal'");
  });

  it("splits on top-level commas only", async () => {
    const { splitColumnList, splitTopLevel } = await import("../src/data/importSQL/common.js");

    expect(splitTopLevel("a INT DEFAULT 'x,y', b NUMERIC(10,2), \"c,d\" INT, [e,f] INT").map((part) => part.trim()))
      .toEqual(["a INT DEFAULT 'x,y'", "b NUMERIC(10,2)", '"c,d" INT', "[e,f] INT"]);
    expect(splitColumnList('"a", "b,c"')).toEqual(["a", "b,c"]);
  });

  it("decodes literals, value lists, and referential actions", async () => {
    const { parseStringList, referentialActions, stripStringLiteral } = await import("../src/data/importSQL/common.js");

    expect(stripStringLiteral(" 'it''s' ")).toBe("it's");
    expect(stripStringLiteral("42")).toBe("42");
    expect(parseStringList("'a,b', 'it''s', ''")).toEqual(["a,b", "it's"]);
    expect(referentialActions("REFERENCES t(id) ON DELETE SET NULL ON UPDATE CASCADE")).toEqual({
      deleteConstraint: "SET NULL",
      updateConstraint: "CASCADE",
    });
    expect(referentialActions("ON DELETE RESTRICT ON UPDATE CASCADE", {
      allowedDelete: ["CASCADE", "SET NULL"],
      update: false,
    })).toEqual({ deleteConstraint: "NO ACTION", updateConstraint: "NO ACTION" });
  });
});

describe("dialect parsers built on the shared helpers", () => {
  it("keeps commas inside Oracle string defaults in one column", async () => {
    const { fromOracle } = await import("../src/data/importSQL/oracle.js");
    const result = fromOracle(`
      CREATE TABLE "notes" (
        "id" NUMBER(10) NOT NULL,
        "tags" VARCHAR2(50) DEFAULT 'a,b',
        CONSTRAINT "pk_notes" PRIMARY KEY ("id")
      );
    `);

    expect(result.tables[0].fields.map((field) => [field.name, field.default])).toEqual([
      ["id", ""],
      ["tags", "a,b"],
    ]);
  });

  it("skips mysqldump statements it does not model", async () => {
    const { fromMySQL } = await import("../src/data/importSQL/mysqlEnhanced.js");
    const result = fromMySQL(`
      DELIMITER //
      CREATE PROCEDURE noop() BEGIN END //
      DELIMITER ;
      CREATE TABLE \`a\` (\`id\` INT NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB;
      CREATE TABLE \`b\` (\`a_id\` INT REFERENCES \`a\` (\`id\`) ON UPDATE CASCADE);
    `);

    expect(result.tables.map((table) => table.name)).toEqual(["a", "b"]);
    expect(result.relationships).toEqual([
      expect.objectContaining({ name: "fk_b_a_id", updateConstraint: "CASCADE", deleteConstraint: "NO ACTION" }),
    ]);
  });

  it("reads index columns with sort order in PostgreSQL", async () => {
    const { fromPostgres } = await import("../src/data/importSQL/postgres.js");
    const result = fromPostgres(`
      CREATE TABLE "events" ("id" integer, "at" timestamp);
      CREATE INDEX "idx_events_at" ON "events" ("at" DESC, "id");
    `);

    expect(result.tables[0].indices).toEqual([
      { id: 0, name: "idx_events_at", fields: ["at", "id"], unique: false },
    ]);
  });
});
