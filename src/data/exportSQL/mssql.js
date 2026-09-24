// @ts-check
// SQL Server (T-SQL) exporter for drawDB (dialect definition for core.js)
import {
  enumValues,
  generateDdl,
  generatedExpression,
  hasDefault,
  quoteWith,
  upperType,
} from "./core.js";

const SAFE = quoteWith("[", "]");
/** Unicode string literal (N'...'), matching the NVARCHAR column types. */
const SAFE_LIT = (s) => `N'${String(s).replace(/'/g, "''")}'`;
const SCHEMA = "dbo";
const MAX_NVARCHAR = 4000;
const MAX_VARBINARY = 8000;

const FIXED = {
  INT: "INT", INTEGER: "INT", MEDIUMINT: "INT", INT4: "INT",
  BIGINT: "BIGINT", INT8: "BIGINT",
  SMALLINT: "SMALLINT", INT2: "SMALLINT", YEAR: "SMALLINT",
  TINYINT: "TINYINT",
  FLOAT: "REAL", REAL: "REAL", FLOAT4: "REAL",
  DOUBLE: "FLOAT", "DOUBLE PRECISION": "FLOAT", FLOAT8: "FLOAT",
  BOOLEAN: "BIT", BOOL: "BIT", BIT: "BIT",
  DATE: "DATE", TIME: "TIME",
  DATETIME: "DATETIME2", TIMESTAMP: "DATETIME2", DATETIME2: "DATETIME2", SMALLDATETIME: "DATETIME2",
  TIMESTAMPTZ: "DATETIMEOFFSET", DATETIMEOFFSET: "DATETIMEOFFSET",
  UUID: "UNIQUEIDENTIFIER", UNIQUEIDENTIFIER: "UNIQUEIDENTIFIER",
  TEXT: "NVARCHAR(MAX)", TINYTEXT: "NVARCHAR(255)", MEDIUMTEXT: "NVARCHAR(MAX)", LONGTEXT: "NVARCHAR(MAX)",
  CLOB: "NVARCHAR(MAX)", NTEXT: "NVARCHAR(MAX)", JSON: "NVARCHAR(MAX)", JSONB: "NVARCHAR(MAX)",
  BLOB: "VARBINARY(MAX)", TINYBLOB: "VARBINARY(255)", MEDIUMBLOB: "VARBINARY(MAX)", LONGBLOB: "VARBINARY(MAX)",
  BYTEA: "VARBINARY(MAX)", IMAGE: "VARBINARY(MAX)",
  MONEY: "MONEY", XML: "XML",
  GEOMETRY: "GEOMETRY", POINT: "GEOMETRY", LINESTRING: "GEOMETRY", POLYGON: "GEOMETRY",
  MULTIPOINT: "GEOMETRY", MULTILINESTRING: "GEOMETRY", MULTIPOLYGON: "GEOMETRY",
  GEOMETRYCOLLECTION: "GEOMETRY", GEOGRAPHY: "GEOGRAPHY",
};

const sized = (base, size, max, fallback) => {
  const text = String(size ?? "").trim().toUpperCase();
  if (text === "MAX") return `${base}(MAX)`;
  const length = Number(text) || fallback;
  return length > max ? `${base}(MAX)` : `${base}(${length})`;
};

function mapType(f, context) {
  const upper = upperType(f, "NVARCHAR");
  const values = enumValues(f, context);
  if (values) {
    const length = Math.max(10, ...values.map((value) => String(value).length));
    return { type: `NVARCHAR(${length})`, check: `${SAFE(f.name)} IN (${values.map(SAFE_LIT).join(", ")})` };
  }
  if (["VARCHAR", "VARCHAR2", "NVARCHAR", "NVARCHAR2", "CHARACTER VARYING"].includes(upper)) {
    return { type: sized("NVARCHAR", f.size, MAX_NVARCHAR, 255) };
  }
  if (["CHAR", "NCHAR", "CHARACTER"].includes(upper)) {
    return { type: sized("NCHAR", f.size, MAX_NVARCHAR, 1) };
  }
  if (upper === "VARBINARY" || upper === "RAW") return { type: sized("VARBINARY", f.size, MAX_VARBINARY, 255) };
  if (upper === "BINARY") return { type: sized("BINARY", f.size, MAX_VARBINARY, 1) };
  if (["DECIMAL", "NUMERIC", "NUMBER"].includes(upper)) {
    return { type: `DECIMAL(${String(f.size || "18,0")})` };
  }
  return { type: FIXED[upper] || upper };
}

function formatDefault(f) {
  const v = String(f.default);
  if (/^(CURRENT_TIMESTAMP|now\(\)|GETDATE\(\)|SYSDATETIME\(\))$/i.test(v)) {
    return /^(GETDATE|SYSDATETIME)/i.test(v) ? v.toUpperCase() : "CURRENT_TIMESTAMP";
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === "true" ? "1" : "0";
  if (v.toUpperCase() === "NULL") return "NULL";
  if (/^NEWID\(\)$/i.test(v)) return "NEWID()";
  return SAFE_LIT(v);
}

/** MS_Description extended properties, the T-SQL equivalent of COMMENT ON. */
function descriptionStatements(table) {
  const describe = (value, column) => [
    "EXEC sp_addextendedproperty",
    `@name = N'MS_Description', @value = ${SAFE_LIT(value)},`,
    `@level0type = N'SCHEMA', @level0name = ${SAFE_LIT(SCHEMA)},`,
    `@level1type = N'TABLE', @level1name = ${SAFE_LIT(table.name)}`
      + (column ? `,\n  @level2type = N'COLUMN', @level2name = ${SAFE_LIT(column)};` : ";"),
  ].join("\n  ");
  const statements = [];
  if (table.comment) statements.push(describe(table.comment));
  (table.fields || []).forEach((field) => {
    if (field.comment) statements.push(describe(field.comment, field.name));
  });
  return statements;
}

export const mssqlDialect = Object.freeze({
  id: "mssql",
  label: "SQL Server (T-SQL) dialect",
  quoteIdent: SAFE,
  quoteLiteral: SAFE_LIT,
  column(f, t, context) {
    const checks = [];
    const expression = generatedExpression(f);
    let sql;
    if (expression) {
      // Computed columns have no data type; only persisted ones can be NOT NULL.
      sql = `AS (${expression})`;
      if (f.generated?.stored) sql += f.notNull ? " PERSISTED NOT NULL" : " PERSISTED";
    } else {
      const m = mapType(f, context);
      sql = m.type;
      if (f.increment) sql += " IDENTITY(1,1)";
      if (f.notNull) sql += " NOT NULL";
      if (hasDefault(f) && !f.increment) sql += ` DEFAULT ${formatDefault(f)}`;
      if (m.check) checks.push(`CONSTRAINT ${SAFE(`CK_${t.name}_${f.name}_enum`)} CHECK (${m.check})`);
    }
    if (f.unique && !f.primary) sql += " UNIQUE";
    if (f.check) checks.push(`CONSTRAINT ${SAFE(`CK_${t.name}_${f.name}`)} CHECK (${f.check})`);
    return { sql, checks };
  },
  primaryKey: (t, columns) => `CONSTRAINT ${SAFE("PK_" + t.name)} PRIMARY KEY (${columns.join(", ")})`,
  indexes: "statements",
  comments: "statements",
  commentStatements: descriptionStatements,
  foreignKeyName: (source, target, index) => `FK_${source.name}_${target.name}_${index + 1}`,
  // SQL Server has no RESTRICT; NO ACTION is the default.
  foreignKeyActions: {
    onDelete: ["CASCADE", "SET NULL", "SET DEFAULT"],
    onUpdate: ["CASCADE", "SET NULL", "SET DEFAULT"],
  },
  trailer: [],
});

/**
 * @param {import("../../types/drawdb").Diagram} diagram
 * @returns {string} DDL script
 */
export function toMSSQL(diagram) {
  return generateDdl(diagram, mssqlDialect);
}
