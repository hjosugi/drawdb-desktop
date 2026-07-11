import { describe, expect, it } from "vitest";
import { fromOracle } from "../src/data/importSQL/oracle.js";
import { fromMySQL } from "../src/data/importSQL/mysqlEnhanced.js";
import { fromPostgres } from "../src/data/importSQL/postgres.js";

const cases = [
  {
    dialect: "MySQL",
    from: fromMySQL,
    tableName: "order_items",
    targetName: "products",
    deleteConstraint: "CASCADE",
    sql: `
      -- comments before table definitions should be ignored
      CREATE TABLE \`order_items\` (
        /* comments before columns should not hide the next column */
        \`order_id\` INT NOT NULL,
        -- second component of the composite primary key
        \`line_no\` INT NOT NULL,
        \`product_id\` INT NOT NULL REFERENCES \`products\`(\`id\`) ON DELETE CASCADE,
        PRIMARY KEY (\`order_id\`, \`line_no\`)
      );

      CREATE TABLE \`products\` (
        \`id\` INT PRIMARY KEY
      );
    `,
  },
  {
    dialect: "PostgreSQL",
    from: fromPostgres,
    tableName: "order_items",
    targetName: "products",
    deleteConstraint: "CASCADE",
    sql: `
      CREATE TABLE "order_items" (
        /* comments before columns should not hide the next column */
        "order_id" integer NOT NULL,
        -- second component of the composite primary key
        "line_no" integer NOT NULL,
        "product_id" integer REFERENCES "products"("id") ON DELETE CASCADE,
        PRIMARY KEY ("order_id", "line_no")
      );

      CREATE TABLE "products" (
        "id" integer PRIMARY KEY
      );
    `,
  },
  {
    dialect: "Oracle",
    from: fromOracle,
    tableName: "order_items",
    targetName: "products",
    deleteConstraint: "SET NULL",
    sql: `
      CREATE TABLE "order_items" (
        /* comments before columns should not hide the next column */
        "order_id" NUMBER(10) NOT NULL,
        -- second component of the composite primary key
        "line_no" NUMBER(10) NOT NULL,
        "product_id" NUMBER(10) REFERENCES "products"("id") ON DELETE SET NULL,
        PRIMARY KEY ("order_id", "line_no")
      );

      CREATE TABLE "products" (
        "id" NUMBER(10) PRIMARY KEY
      );
    `,
  },
];

function relationshipEndpoints(result) {
  const relationship = result.relationships[0];
  const sourceTable = result.tables.find((table) => table.id === relationship.startTableId);
  const targetTable = result.tables.find((table) => table.id === relationship.endTableId);

  return {
    relationship,
    sourceTable,
    sourceField: sourceTable.fields[relationship.startFieldId],
    targetTable,
    targetField: targetTable.fields[relationship.endFieldId],
  };
}

describe("importSQL parser edge cases", () => {
  it.each(cases)("handles comments, quoted identifiers, composite PKs, and inline FKs for $dialect", ({ from, sql, tableName, targetName, deleteConstraint }) => {
    const result = from(sql);
    const orderItems = result.tables.find((table) => table.name === tableName);

    expect(result.tables.map((table) => table.name).sort()).toEqual([tableName, targetName].sort());
    expect(orderItems.fields.map((field) => field.name)).toEqual(["order_id", "line_no", "product_id"]);
    expect(orderItems.fields.filter((field) => field.primary).map((field) => field.name)).toEqual(["order_id", "line_no"]);
    expect(result.relationships).toHaveLength(1);

    const endpoints = relationshipEndpoints(result);
    expect(endpoints.relationship.deleteConstraint).toBe(deleteConstraint);
    expect(endpoints.sourceTable.name).toBe(tableName);
    expect(endpoints.sourceField.name).toBe("product_id");
    expect(endpoints.targetTable.name).toBe(targetName);
    expect(endpoints.targetField.name).toBe("id");
  });

  it.each([
    ["MySQL", fromMySQL],
    ["PostgreSQL", fromPostgres],
    ["Oracle", fromOracle],
  ])("returns an empty diagram instead of throwing on invalid %s input", (_dialect, from) => {
    expect(() => from("this is not valid DDL;")).not.toThrow();
    expect(from("this is not valid DDL;")).toEqual({ tables: [], relationships: [] });
  });
});
