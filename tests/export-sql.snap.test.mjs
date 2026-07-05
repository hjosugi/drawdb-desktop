import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toOracle } from "../overlay/src/data/exportSQL/oracle.js";
import { toMySQL } from "../overlay/src/data/exportSQL/mysqlEnhanced.js";
import { toPostgres } from "../overlay/src/data/exportSQL/postgres.js";
import { makeShopDiagram } from "./fixtures/shopDiagram.mjs";

describe("SQL exporter snapshots", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-02T03:04:05.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches the Oracle golden output", () => {
    expect(toOracle(makeShopDiagram())).toMatchSnapshot();
  });

  it("matches the MySQL golden output", () => {
    expect(toMySQL(makeShopDiagram())).toMatchSnapshot();
  });

  it("matches the PostgreSQL golden output", () => {
    expect(toPostgres(makeShopDiagram())).toMatchSnapshot();
  });
});
