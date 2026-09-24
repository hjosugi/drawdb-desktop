// @ts-check
// Enhanced MySQL SQL exporter for drawDB (dialect definition for core.js)
import { enumValues, generateDdl, hasDefault, quoteWith, upperType } from "./core.js";

const SAFE = quoteWith("`");
const SAFE_LIT = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
const TYPE_PASSTHRU = new Set([
  "INT","INTEGER","BIGINT","SMALLINT","TINYINT","MEDIUMINT",
  "DECIMAL","NUMERIC","FLOAT","DOUBLE","REAL",
  "VARCHAR","CHAR","TEXT","LONGTEXT","MEDIUMTEXT","TINYTEXT",
  "BLOB","LONGBLOB","MEDIUMBLOB","TINYBLOB","BINARY","VARBINARY",
  "DATE","TIME","DATETIME","TIMESTAMP","YEAR",
  "JSON","BIT","BOOLEAN","BOOL","ENUM","SET","GEOMETRY","POINT",
]);
const TYPE_MAP = { VARCHAR2: "VARCHAR", NUMBER: "DECIMAL", CLOB: "LONGTEXT", BLOB: "LONGBLOB", UUID: "CHAR(36)" };

function mapType(f, context) {
  const upper = upperType(f, "VARCHAR");
  let base = TYPE_MAP[upper] || upper;
  const values = enumValues(f, context);
  if (values) return `ENUM(${values.map(SAFE_LIT).join(",")})`;
  if (base === "SET"  && Array.isArray(f.values)) return `SET(${f.values.map(SAFE_LIT).join(",")})`;
  if (!TYPE_PASSTHRU.has(base) && !["VARCHAR2","NUMBER","CLOB","BLOB","UUID"].includes(upper)) base = "VARCHAR";
  if (["VARCHAR","CHAR","BINARY","VARBINARY"].includes(base)) return `${base}(${Number(f.size) || 255})`;
  if (["DECIMAL","NUMERIC"].includes(base)) return `${base}(${f.size || "10,0"})`;
  if (["INT","BIGINT","SMALLINT","TINYINT","MEDIUMINT"].includes(base) && f.size) return `${base}(${f.size})`;
  return base;
}

function formatDefault(f) {
  const v = String(f.default);
  if (/^(CURRENT_TIMESTAMP|now\(\))$/i.test(v)) return "CURRENT_TIMESTAMP";
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  if (/^(true|false)$/i.test(v)) return v.toLowerCase();
  if (v.toUpperCase() === "NULL") return "NULL";
  return SAFE_LIT(v);
}

export const mysqlDialect = Object.freeze({
  id: "mysql",
  label: "MySQL Enhanced",
  quoteIdent: SAFE,
  quoteLiteral: SAFE_LIT,
  preamble: ["SET FOREIGN_KEY_CHECKS=0;", ""],
  trailer: ["", "SET FOREIGN_KEY_CHECKS=1;"],
  column(f, _table, context) {
    let sql = mapType(f, context);
    if (f.notNull) sql += " NOT NULL";
    if (hasDefault(f)) sql += ` DEFAULT ${formatDefault(f)}`;
    if (f.increment) sql += " AUTO_INCREMENT";
    if (f.unique && !f.primary) sql += " UNIQUE";
    if (f.onUpdate) sql += ` ON UPDATE ${f.onUpdate}`;
    if (f.comment) sql += ` COMMENT ${SAFE_LIT(f.comment)}`;
    if (f.check) sql += ` CHECK (${f.check})`;
    return { sql };
  },
  primaryKey: (_table, columns) => `PRIMARY KEY (${columns.join(", ")})`,
  indexes: "inline",
  comments: "inline",
  tableSuffix: (t) => " " + [
    "ENGINE=InnoDB",
    "DEFAULT CHARSET=utf8mb4",
    "COLLATE=utf8mb4_unicode_ci",
    t.comment ? `COMMENT=${SAFE_LIT(t.comment)}` : "",
  ].filter(Boolean).join(" "),
  foreignKeyName: (source, target, index) => `fk_${source.name}_${target.name}_${index + 1}`,
  foreignKeyActions: { onDelete: "all", onUpdate: "all" },
});

/**
 * @param {import("../../types/drawdb").Diagram} diagram
 * @returns {string} DDL script
 */
export function toMySQL(diagram) {
  return generateDdl(diagram, mysqlDialect);
}
