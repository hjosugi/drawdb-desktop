// Applies generated migration SQL to real PostgreSQL and MySQL servers and
// checks that the migrated schema equals the target schema. Runs in the CI
// "Migration SQL" job (service containers) or locally when the environment
// variables below point at disposable servers; otherwise it is skipped.
//
//   DRAWDB_TEST_POSTGRES=1  PGHOST/PGPORT/PGUSER/PGPASSWORD for psql
//   DRAWDB_TEST_MYSQL=1     MYSQL_HOST/MYSQL_TCP_PORT/MYSQL_USER/MYSQL_PWD for mysql
//
// DRAWDB_PSQL_CMD / DRAWDB_MYSQL_CMD override the client command, e.g.
// "docker exec -i drawdb-pg psql -U postgres" when no client is installed.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { compareDiagrams } from "../src/desktop/schemaDiff.js";
import { toPostgres } from "../src/data/exportSQL/postgres.js";
import { toMySQL } from "../src/data/exportSQL/mysqlEnhanced.js";
import { makeShopDiagram } from "./fixtures/shopDiagram.mjs";

const field = (id, name, type, extra = {}) => ({
  id, name, type, size: "", notNull: false, primary: false, unique: false,
  increment: false, default: "", comment: "", check: "", ...extra,
});

function evolvedShop() {
  const next = structuredClone(makeShopDiagram());
  next.tables[0].fields.push(field(4, "nickname", "VARCHAR", { size: 30 }));
  next.tables[0].fields[1].size = 100; // shrink users.email, keep NOT NULL
  next.tables[1].fields.splice(2, 1); // drop orders.amount
  next.tables[1].fields.push(field(3, "note", "TEXT", { comment: "free" }));
  next.tables[1].fields[1].name = "customer_id"; // rename with a FK on it
  next.tables.push({
    id: 2,
    name: "tags",
    fields: [
      field(0, "id", "INT", { primary: true, notNull: true }),
      field(1, "label", "VARCHAR", { size: 40, notNull: true, unique: true }),
    ],
    indices: [],
  });
  return next;
}

const suffix = `${process.pid}_${Date.now().toString(36)}`;

function command(variable, fallback) {
  const [program, ...args] = (process.env[variable] || fallback).split(/\s+/).filter(Boolean);
  return { program, args };
}

function psql(database, sql) {
  const { program, args } = command("DRAWDB_PSQL_CMD", "psql");
  return execFileSync(program, [...args, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", database], {
    input: sql,
    encoding: "utf8",
  });
}

function mysql(database, sql) {
  const { program, args } = command("DRAWDB_MYSQL_CMD", "mysql --protocol=TCP");
  return execFileSync(program, [...args, "-N", "-B", ...(database ? [database] : [])], {
    input: sql,
    encoding: "utf8",
  });
}

const PG_COLUMNS = `SELECT table_name, column_name, data_type, character_maximum_length,
  numeric_precision, numeric_scale, is_nullable
  FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2;`;
const PG_CONSTRAINTS = `SELECT tc.table_name, tc.constraint_type, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public' ORDER BY 1, 2, 3;`;
const MY_COLUMNS = `SELECT table_name, column_name, column_type, is_nullable, column_default,
  column_key, column_comment FROM information_schema.columns
  WHERE table_schema = DATABASE() ORDER BY 1, 2;`;
const MY_CONSTRAINTS = `SELECT table_name, constraint_type FROM information_schema.table_constraints
  WHERE table_schema = DATABASE() ORDER BY 1, 2;`;

describe.skipIf(!process.env.DRAWDB_TEST_POSTGRES)("migration SQL on PostgreSQL", () => {
  it("migrates the old schema to the new one and back", () => {
    const before = makeShopDiagram();
    const after = evolvedShop();
    const { sql } = compareDiagrams(before, after, { database: "postgresql" });
    const [migrated, target, reverted, original] = ["up", "new", "down", "old"]
      .map((name) => `drawdb_${name}_${suffix}`);
    for (const name of [migrated, target, reverted, original]) psql("postgres", `CREATE DATABASE ${name};`);

    psql(migrated, `${toPostgres(before)}\n${sql.up}`);
    psql(target, toPostgres(after));
    psql(reverted, `${toPostgres(before)}\n${sql.up}\n${sql.down}`);
    psql(original, toPostgres(before));

    expect(psql(migrated, PG_COLUMNS)).toBe(psql(target, PG_COLUMNS));
    expect(psql(migrated, PG_CONSTRAINTS)).toBe(psql(target, PG_CONSTRAINTS));
    expect(psql(reverted, PG_COLUMNS)).toBe(psql(original, PG_COLUMNS));
  });
});

describe.skipIf(!process.env.DRAWDB_TEST_MYSQL)("migration SQL on MySQL", () => {
  it("migrates the old schema to the new one and back", () => {
    const before = makeShopDiagram();
    const after = evolvedShop();
    const { sql } = compareDiagrams(before, after, { database: "mysql" });
    const [migrated, target, reverted, original] = ["up", "new", "down", "old"]
      .map((name) => `drawdb_${name}_${suffix}`);
    mysql("", [migrated, target, reverted, original].map((name) => `CREATE DATABASE ${name};`).join("\n"));

    mysql(migrated, `${toMySQL(before)}\n${sql.up}`);
    mysql(target, toMySQL(after));
    mysql(reverted, `${toMySQL(before)}\n${sql.up}\n${sql.down}`);
    mysql(original, toMySQL(before));

    expect(mysql(migrated, MY_COLUMNS)).toBe(mysql(target, MY_COLUMNS));
    expect(mysql(migrated, MY_CONSTRAINTS)).toBe(mysql(target, MY_CONSTRAINTS));
    expect(mysql(reverted, MY_COLUMNS)).toBe(mysql(original, MY_COLUMNS));
  });
});
