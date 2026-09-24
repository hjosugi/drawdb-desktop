import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toOracle } from "../src/data/exportSQL/oracle.js";
import { toMySQL } from "../src/data/exportSQL/mysqlEnhanced.js";
import { toPostgres } from "../src/data/exportSQL/postgres.js";
import { toMSSQL } from "../src/data/exportSQL/mssql.js";
import { makeSqlRegressionDiagram } from "./fixtures/sqlRegressionDiagram.mjs";

describe("SQL exporter regression goldens", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-02T03:04:05.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["Oracle", toOracle],
    ["MySQL", toMySQL],
    ["PostgreSQL", toPostgres],
    ["SQL Server", toMSSQL],
  ])("keeps %s output byte-identical", (_name, exporter) => {
    expect(exporter(makeSqlRegressionDiagram())).toMatchSnapshot();
  });
});
