import { describe, expect, it } from "vitest";
import { toOracle } from "../src/data/exportSQL/oracle.js";
import { toMySQL } from "../src/data/exportSQL/mysqlEnhanced.js";
import { toPostgres } from "../src/data/exportSQL/postgres.js";
import { fromOracle } from "../src/data/importSQL/oracle.js";
import { fromMySQL } from "../src/data/importSQL/mysqlEnhanced.js";
import { fromPostgres } from "../src/data/importSQL/postgres.js";
import { makeSqlRegressionDiagram } from "./fixtures/sqlRegressionDiagram.mjs";
import { makeShopDiagram } from "./fixtures/shopDiagram.mjs";

// Golden parse results guard the shared import helpers in importSQL/common.js.
describe("SQL importer regression goldens", () => {
  it.each([
    ["Oracle", toOracle, fromOracle],
    ["MySQL", toMySQL, fromMySQL],
    ["PostgreSQL", toPostgres, fromPostgres],
  ])("parses exported %s DDL identically", (_name, exporter, importer) => {
    expect(importer(exporter(makeSqlRegressionDiagram()))).toMatchSnapshot();
    expect(importer(exporter(makeShopDiagram()))).toMatchSnapshot();
  });
});
