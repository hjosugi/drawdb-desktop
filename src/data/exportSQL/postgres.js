// @ts-check
// PostgreSQL SQL exporter for drawDB
import {
  commentOnStatements,
  generateDdl,
  generatedExpression,
  hasDefault,
  quoteWith,
  sqlStringLiteral,
  upperType,
} from "./core.js";

// Mirrors the Oracle / MySQL exporters but emits idiomatic PostgreSQL:
//   - native ENUM types (CREATE TYPE ... AS ENUM)
//   - SERIAL / BIGSERIAL / SMALLSERIAL for auto-increment columns
//   - NUMERIC / BYTEA / JSONB / UUID / DOUBLE PRECISION
//   - COMMENT ON TABLE/COLUMN, CREATE [UNIQUE] INDEX, ALTER TABLE ... FK
const SAFE = quoteWith('"');
const SAFE_LIT = sqlStringLiteral;

const INT_TYPES = {
  INT: "INTEGER", INTEGER: "INTEGER", INT4: "INTEGER", MEDIUMINT: "INTEGER",
  BIGINT: "BIGINT", INT8: "BIGINT",
  SMALLINT: "SMALLINT", INT2: "SMALLINT", TINYINT: "SMALLINT", YEAR: "SMALLINT",
};
const SERIAL_FOR = { INTEGER: "SERIAL", BIGINT: "BIGSERIAL", SMALLINT: "SMALLSERIAL" };

const TYPE_MAP = {
  FLOAT: "REAL", REAL: "REAL", DOUBLE: "DOUBLE PRECISION", "DOUBLE PRECISION": "DOUBLE PRECISION",
  VARCHAR: "VARCHAR", VARCHAR2: "VARCHAR", CHAR: "CHAR", CHARACTER: "CHAR",
  TEXT: "TEXT", CLOB: "TEXT", LONGTEXT: "TEXT", MEDIUMTEXT: "TEXT", TINYTEXT: "VARCHAR(255)",
  BLOB: "BYTEA", LONGBLOB: "BYTEA", MEDIUMBLOB: "BYTEA", TINYBLOB: "BYTEA",
  BINARY: "BYTEA", VARBINARY: "BYTEA", RAW: "BYTEA", BYTEA: "BYTEA",
  DATE: "DATE", TIME: "TIME", DATETIME: "TIMESTAMP", TIMESTAMP: "TIMESTAMP",
  TIMESTAMPTZ: "TIMESTAMPTZ",
  BOOLEAN: "BOOLEAN", BOOL: "BOOLEAN", BIT: "BOOLEAN",
  JSON: "JSONB", JSONB: "JSONB", UUID: "UUID",
};

const enumTypeName = (table, field) => `${table}_${field}`;

function columnType(f) {
  const upper = upperType(f, "VARCHAR");
  if (["DECIMAL", "NUMERIC", "NUMBER"].includes(upper)) {
    const s = String(f.size ?? "").trim();
    return s ? `NUMERIC(${s})` : "NUMERIC";
  }
  if (INT_TYPES[upper]) {
    const base = INT_TYPES[upper];
    if (f.increment && SERIAL_FOR[base]) return SERIAL_FOR[base];
    return base;
  }
  const mapped = TYPE_MAP[upper];
  if (mapped) {
    if (mapped === "VARCHAR" || mapped === "CHAR") {
      const sz = Number(f.size) || 255;
      return `${mapped}(${sz})`;
    }
    return mapped;
  }
  return upper;
}

export const postgresDialect = Object.freeze({
  id: "postgres",
  label: "PostgreSQL dialect",
  quoteIdent: SAFE,
  quoteLiteral: SAFE_LIT,
  compositeType: (t) => {
    const cols = (t.fields || [])
      .map((f) => `  ${SAFE(f.name)} ${columnType(f)}`)
      .join(",\n");
    return `CREATE TYPE ${SAFE(t.name)} AS (\n${cols}\n);`;
  },
  // ENUM types: named enums first, then per-column inline enums.
  typeDefinitions(diagram) {
    const statements = [];
    const definedEnums = new Set();
    (diagram.enums || []).forEach((e) => {
      if (!e || !e.name || !Array.isArray(e.values) || !e.values.length) return;
      const key = String(e.name).toLowerCase();
      if (definedEnums.has(key)) return;
      definedEnums.add(key);
      statements.push(`CREATE TYPE ${SAFE(e.name)} AS ENUM (${e.values.map(SAFE_LIT).join(", ")});`);
    });
    (diagram.tables || []).forEach((t) => {
      (t.fields || []).forEach((f) => {
        if (upperType(f, "") === "ENUM" && Array.isArray(f.values) && f.values.length) {
          const name = enumTypeName(t.name, f.name);
          const key = name.toLowerCase();
          if (definedEnums.has(key)) return;
          definedEnums.add(key);
          statements.push(`CREATE TYPE ${SAFE(name)} AS ENUM (${f.values.map(SAFE_LIT).join(", ")});`);
        }
      });
    });
    if (definedEnums.size || (diagram.types || []).length) statements.push("");
    return statements;
  },
  column(f, t, { namedEnums }) {
    const upper = upperType(f, "");
    let typeStr;
    if (namedEnums.has(upper.toLowerCase())) {
      typeStr = SAFE(f.type);
    } else if (upper === "ENUM" && Array.isArray(f.values) && f.values.length) {
      typeStr = SAFE(enumTypeName(t.name, f.name));
    } else {
      typeStr = columnType(f);
    }
    const expression = generatedExpression(f);
    // Generated columns cannot be SERIAL or carry a DEFAULT. STORED is the
    // form supported by every PostgreSQL release with generated columns (12+).
    if (expression) typeStr = typeStr.replace(/^(SMALL|BIG)?SERIAL$/, (_m, size) =>
      size === "SMALL" ? "SMALLINT" : size === "BIG" ? "BIGINT" : "INTEGER");
    const serial = /SERIAL$/.test(typeStr);
    let sql = typeStr;
    if (expression) {
      sql += ` GENERATED ALWAYS AS (${expression}) STORED`;
      if (f.notNull) sql += " NOT NULL";
    } else if (!serial) {
      if (hasDefault(f)) sql += ` DEFAULT ${formatDefault(f)}`;
      if (f.notNull) sql += " NOT NULL";
    }
    if (f.unique && !f.primary) sql += " UNIQUE";
    const checks = f.check
      ? [`CONSTRAINT ${SAFE("chk_" + t.name + "_" + f.name)} CHECK (${f.check})`]
      : [];
    return { sql, checks, serial };
  },
  primaryKey: (t, columns) => `CONSTRAINT ${SAFE("pk_" + t.name)} PRIMARY KEY (${columns.join(", ")})`,
  indexes: "statements",
  comments: "statements",
  commentStatements: commentOnStatements(SAFE, SAFE_LIT),
  foreignKeyName: (source, target, index) => `fk_${source.name}_${target.name}_${index + 1}`,
  foreignKeyActions: { onDelete: "all", onUpdate: "all" },
  trailer: [],
});

/**
 * @param {import("../../types/drawdb").Diagram} diagram
 * @returns {string} DDL script
 */
export function toPostgres(diagram) {
  return generateDdl(diagram, postgresDialect);
}

function formatDefault(f) {
  const v = String(f.default);
  if (/^(CURRENT_TIMESTAMP|now\(\))$/i.test(v)) return "CURRENT_TIMESTAMP";
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  if (/^(true|false)$/i.test(v)) return v.toLowerCase();
  if (v.toUpperCase() === "NULL") return "NULL";
  return SAFE_LIT(v);
}
