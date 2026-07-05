import { describe, expect, it } from "vitest";
import { toOracle } from "../overlay/src/data/exportSQL/oracle.js";
import { toMySQL } from "../overlay/src/data/exportSQL/mysqlEnhanced.js";
import { toPostgres } from "../overlay/src/data/exportSQL/postgres.js";
import { fromOracle } from "../overlay/src/data/importSQL/oracle.js";
import { fromMySQL } from "../overlay/src/data/importSQL/mysqlEnhanced.js";
import { fromPostgres } from "../overlay/src/data/importSQL/postgres.js";
import { makeShopDiagram } from "./fixtures/shopDiagram.mjs";

describe("SQL dialect smoke tests", () => {
  const diagram = makeShopDiagram();
  const oracleSql = toOracle(diagram);
  const mysqlSql = toMySQL(diagram);
  const postgresSql = toPostgres(diagram);

  it.each([
    ["Oracle", fromOracle, oracleSql],
    ["MySQL", fromMySQL, mysqlSql],
    ["PostgreSQL", fromPostgres, postgresSql],
  ])("round-trips table and relationship counts for %s", (_name, from, sql) => {
    const result = from(sql);

    expect(result.tables).toHaveLength(2);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].deleteConstraint).toBe("CASCADE");
  });

  it("emits and imports PostgreSQL dialect-specific details", () => {
    expect(postgresSql).toMatch(/CREATE TYPE "users_status" AS ENUM \('active', 'banned'\)/);
    expect(postgresSql).toMatch(/"id" SERIAL/);
    expect(postgresSql).toMatch(/"id" BIGSERIAL/);
    expect(postgresSql).toMatch(/"amount" NUMERIC\(12,2\)/);
    expect(postgresSql).toMatch(/ON DELETE CASCADE/);

    const roundTrip = fromPostgres(postgresSql);
    const statusField = roundTrip.tables[0].fields.find((field) => field.name === "status");
    const idField = roundTrip.tables[0].fields.find((field) => field.name === "id");
    const amount = roundTrip.tables[1].fields.find((field) => field.name === "amount");

    expect(statusField).toMatchObject({ type: "ENUM", values: ["active", "banned"] });
    expect(idField).toMatchObject({ increment: true, primary: true });
    expect(amount).toMatchObject({ type: "DECIMAL", size: "12,2" });
  });
});
